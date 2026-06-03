"""OpenAI 客户端"""
import json
from typing import Any, AsyncGenerator, Dict, Optional

from app.logger import get_logger, summarize_log_value
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
        reasoning_effort: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        # 思考模式：用户自己选择，不支持的话关掉就好
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
            payload["enable_thinking"] = True
            logger.info(f"🧠 思考模式: reasoning_effort={reasoning_effort}")
        else:
            payload["temperature"] = temperature
        if stream:
            payload["stream"] = True
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
        return {
            "content": message.get("content", ""),
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
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式生成，支持工具调用
        
        Yields:
            Dict with keys:
            - content: str - 文本内容块
            - tool_calls: list - 工具调用列表（如果有）
            - done: bool - 是否结束
        """
        payload = self._build_payload(messages, model, temperature, max_tokens, tools, tool_choice, stream=True, reasoning_effort=reasoning_effort)
        
        tool_calls_buffer = {}  # 收集工具调用块
        
        try:
            async with await self._request_with_retry("POST", "/chat/completions", payload, stream=True) as response:
                response.raise_for_status()
                try:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                # 流结束，检查是否有工具调用需要处理
                                if tool_calls_buffer:
                                    yield {"tool_calls": list(tool_calls_buffer.values()), "done": True}
                                yield {"done": True}
                                break
                            try:
                                data = json.loads(data_str)
                                choices = data.get("choices", [])
                                if choices and len(choices) > 0:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    
                                    # 检查思考内容（DeepSeek R1 / Qwen 等推理模型）
                                    reasoning_content = delta.get("reasoning_content", "")
                                    if reasoning_content:
                                        yield {"reasoning_content": reasoning_content}
                                    
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
                                    
                                    if content:
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
