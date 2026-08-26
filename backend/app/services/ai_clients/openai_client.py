"""OpenAI 客户端"""
import json
from typing import Any, AsyncGenerator, Dict, Optional

from app.logger import get_logger, summarize_log_value
from app.services.ai_config import AIClientConfig
from app.utils.reasoning_text import (
    split_content_and_reasoning,
    sse_data_payload,
    strip_think_tags,
    uses_minimax_api,
)
from .base_client import BaseAIClient

logger = get_logger(__name__)


def _message_content_length(content: Any) -> int:
    if content is None:
        return 0
    if isinstance(content, str):
        return len(content)
    return len(json.dumps(content, ensure_ascii=False, default=str))


def _log_request_summary(payload: Dict[str, Any]) -> None:
    messages = payload.get("messages") or []
    message_chars = sum(_message_content_length(message.get("content")) for message in messages if isinstance(message, dict))
    logger.debug(
        "📤 OpenAI 请求摘要: model=%s, messages=%s, message_chars=%s, tools=%s, stream=%s, max_tokens=%s",
        payload.get("model"),
        len(messages),
        message_chars,
        len(payload.get("tools") or []),
        bool(payload.get("stream")),
        payload.get("max_tokens"),
    )


def _log_response_summary(data: Dict[str, Any]) -> None:
    choices = data.get("choices") or []
    first_choice = choices[0] if choices else {}
    message = first_choice.get("message") or {}
    content = message.get("content") or ""
    tool_calls = message.get("tool_calls") or []
    usage = data.get("usage") or {}
    logger.debug(
        "📥 OpenAI 响应摘要: choices=%s, finish_reason=%s, content_length=%s, tool_calls=%s, usage=%s",
        len(choices),
        first_choice.get("finish_reason"),
        len(content) if isinstance(content, str) else _message_content_length(content),
        len(tool_calls),
        summarize_log_value(usage),
    )


class OpenAIClient(BaseAIClient):
    """OpenAI API 客户端"""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        config: Optional[AIClientConfig] = None,
        extra_body: Optional[Dict[str, Any]] = None,
    ):
        """
        Args:
            extra_body: 额外合并到请求体顶层的参数（如 vLLM 的 chat_template_kwargs），
                        仅对支持这些字段的 OpenAI 兼容服务端生效
        """
        super().__init__(api_key, base_url, config)
        self.extra_body = extra_body or {}

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
        stream: bool = False,
    ) -> Dict[str, Any]:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        # 合并额外请求体参数（如关闭思考: chat_template_kwargs={"enable_thinking": False}）
        if self.extra_body:
            payload.update(self.extra_body)
        if stream:
            payload["stream"] = True
        if uses_minimax_api(model, self.base_url):
            # MiniMax otherwise embeds <think> in the visible chapter text.
            # extra_body is the SDK name; the HTTP JSON body uses the raw field.
            payload["reasoning_split"] = False
        if tools:
            # 清理 $schema 字段
            cleaned = []
            for t in tools:
                tc = t.copy()
                if "function" in tc and "parameters" in tc["function"]:
                    tc["function"]["parameters"] = {
                        k: v for k, v in tc["function"]["parameters"].items() if k != "$schema"
                    }
                cleaned.append(tc)
            payload["tools"] = cleaned
            if tool_choice:
                payload["tool_choice"] = tool_choice
        return payload

    async def chat_completion(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = self._build_payload(messages, model, temperature, max_tokens, tools, tool_choice)
        
        _log_request_summary(payload)
        
        data = await self._request_with_retry("POST", "/chat/completions", payload)
        
        _log_response_summary(data)

        choices = data.get("choices", [])
        if not choices or len(choices) == 0:
            raise ValueError("API 返回空 choices 或 choices 为空列表")

        choice = choices[0]
        message = choice.get("message", {})
        usage = data.get("usage") or {}
        content, reasoning = split_content_and_reasoning(message)
        content = strip_think_tags(content)
        if not content and reasoning:
            logger.warning(
                "非流式响应正文为空，已丢弃推理内容以免污染 JSON: model=%s reasoning_chars=%s finish_reason=%s",
                model,
                len(reasoning),
                choice.get("finish_reason"),
            )
        return {
            "content": content,
            "tool_calls": message.get("tool_calls"),
            "finish_reason": choice.get("finish_reason"),
            "usage": {
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
        }

    async def chat_completion_stream(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成，支持工具调用
        
        Yields:
            Dict with keys:
            - content: str - 文本内容块
            - tool_calls: list - 工具调用列表（如果有）
            - done: bool - 是否结束
        """
        payload = self._build_payload(messages, model, temperature, max_tokens, tools, tool_choice, stream=True)
        
        tool_calls_buffer = {}  # 收集工具调用块
        content_chars = 0
        reasoning_chars = 0
        finish_reason = None
        
        try:
            async with await self._request_with_retry("POST", "/chat/completions", payload, stream=True) as response:
                response.raise_for_status()
                try:
                    async for line in response.aiter_lines():
                        data_str = sse_data_payload(line)
                        if data_str is None:
                            continue
                        if data_str == "[DONE]":
                            if tool_calls_buffer:
                                yield {"tool_calls": list(tool_calls_buffer.values()), "done": True}
                            if not content_chars:
                                logger.warning(
                                    "流式响应结束但正文为空: model=%s reasoning_chars=%s finish_reason=%s tool_calls=%s",
                                    model,
                                    reasoning_chars,
                                    finish_reason,
                                    bool(tool_calls_buffer),
                                )
                            yield {"done": True, "finish_reason": finish_reason}
                            break
                        try:
                            data = json.loads(data_str)
                            choices = data.get("choices", [])
                            if choices and len(choices) > 0:
                                choice = choices[0]
                                finish_reason = choice.get("finish_reason") or finish_reason
                                delta = choice.get("delta") or {}
                                content, reasoning = split_content_and_reasoning(delta)
                                if not content:
                                    content = ""
                                
                                # 检查工具调用
                                tc_list = delta.get("tool_calls")
                                if tc_list:
                                    for tc in tc_list:
                                        index = tc.get("index", 0)
                                        if index not in tool_calls_buffer:
                                            tool_calls_buffer[index] = tc
                                        else:
                                            existing = tool_calls_buffer[index]
                                            # 合并 function.arguments
                                            if "function" in tc and "function" in existing:
                                                if tc["function"].get("arguments"):
                                                    existing["function"]["arguments"] = (
                                                        existing["function"].get("arguments", "") +
                                                        tc["function"]["arguments"]
                                                    )

                                usage = data.get("usage")
                                if usage:
                                    yield {
                                        "usage": {
                                            "prompt_tokens": usage.get("prompt_tokens"),
                                            "completion_tokens": usage.get("completion_tokens"),
                                            "total_tokens": usage.get("total_tokens"),
                                        }
                                    }

                                if reasoning:
                                    reasoning_chars += len(reasoning)
                                    logger.debug(
                                        "丢弃推理增量以免混入正文: model=%s reasoning_chars=%s",
                                        model,
                                        len(reasoning),
                                    )

                                if content:
                                    content = strip_think_tags(content)
                                    if content:
                                        content_chars += len(content)
                                        yield {"content": content}
                                        
                        except json.JSONDecodeError:
                            continue
                except GeneratorExit:
                    # 生成器被关闭，这是正常的清理过程
                    logger.debug("流式响应生成器被关闭(GeneratorExit)")
                    raise
                except Exception as iter_error:
                    logger.error(f"流式响应迭代出错: {str(iter_error)}")
                    raise
        except GeneratorExit:
            # 重新抛出GeneratorExit，让调用方处理
            raise
        except Exception as e:
            logger.error(f"流式请求出错: {str(e)}")
            raise
