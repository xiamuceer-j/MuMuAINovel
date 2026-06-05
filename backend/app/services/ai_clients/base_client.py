"""AI 客户端基类"""
import asyncio
import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from app.logger import get_logger, safe_preview
from app.services.ai_config import AIClientConfig, default_config

logger = get_logger(__name__)

# 全局 HTTP 客户端池
_http_client_pool: Dict[str, httpx.AsyncClient] = {}
_global_semaphore: Optional[asyncio.Semaphore] = None


DEBUG_RESPONSE_HEADER_KEYS = (
    "content-type",
    "content-length",
    "x-request-id",
    "request-id",
    "cf-ray",
    "openai-processing-ms",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
)
RAW_RESPONSE_LOG_CHUNK_CHARS = 1200
RAW_RESPONSE_LOG_MAX_CHARS = 20000


def _debug_response_headers(response: httpx.Response) -> Dict[str, Optional[str]]:
    """提取排查上游响应问题所需的安全响应头。"""
    return {
        key: response.headers.get(key)
        for key in DEBUG_RESPONSE_HEADER_KEYS
        if response.headers.get(key) is not None
    }


def _classify_json_decode_failure(response: httpx.Response) -> str:
    """根据响应体和 Content-Type 粗略判断 JSON 解析失败原因。"""
    body = response.text or ""
    content_type = response.headers.get("content-type") or ""
    stripped_body = body.strip()

    if not stripped_body:
        return "响应体为空或仅包含空白字符"
    if "json" not in content_type.lower():
        return f"响应 Content-Type 非 JSON: {content_type or '未提供'}"
    return "响应体不是合法 JSON"


def _log_raw_response_body(response: httpx.Response, reason: str) -> None:
    """失败时分片输出上游原始响应，避免单条日志被截断。"""
    body = response.text or ""
    total_chars = len(body)
    total_bytes = len(response.content or b"")

    logger.error(
        "AI HTTP 原始响应体开始: reason=%s status=%s total_bytes=%s total_chars=%s log_max_chars=%s",
        reason,
        response.status_code,
        total_bytes,
        total_chars,
        RAW_RESPONSE_LOG_MAX_CHARS,
    )

    if not body:
        logger.error("AI HTTP 原始响应体[empty]: ''")
        return

    logged_body = body[:RAW_RESPONSE_LOG_MAX_CHARS]
    chunk_total = (len(logged_body) + RAW_RESPONSE_LOG_CHUNK_CHARS - 1) // RAW_RESPONSE_LOG_CHUNK_CHARS
    for index in range(chunk_total):
        start = index * RAW_RESPONSE_LOG_CHUNK_CHARS
        end = start + RAW_RESPONSE_LOG_CHUNK_CHARS
        logger.error(
            "AI HTTP 原始响应体[%s/%s]: %r",
            index + 1,
            chunk_total,
            logged_body[start:end],
        )

    if total_chars > RAW_RESPONSE_LOG_MAX_CHARS:
        logger.error(
            "AI HTTP 原始响应体已截断: logged_chars=%s total_chars=%s",
            RAW_RESPONSE_LOG_MAX_CHARS,
            total_chars,
        )


def _is_sse_response(response: httpx.Response) -> bool:
    """判断响应是否为 Server-Sent Events 格式。"""
    content_type = (response.headers.get("content-type") or "").lower()
    return "text/event-stream" in content_type or (response.text or "").lstrip().startswith("data:")


def _merge_tool_call_delta(tool_calls: Dict[int, Dict[str, Any]], delta: Dict[str, Any]) -> None:
    """合并 OpenAI 流式 tool_call 增量。"""
    index = delta.get("index", len(tool_calls))
    current = tool_calls.setdefault(
        index,
        {
            "id": delta.get("id"),
            "type": delta.get("type") or "function",
            "function": {"name": "", "arguments": ""},
        },
    )

    if delta.get("id"):
        current["id"] = delta.get("id")
    if delta.get("type"):
        current["type"] = delta.get("type")

    function_delta = delta.get("function") or {}
    current_function = current.setdefault("function", {"name": "", "arguments": ""})
    if function_delta.get("name"):
        current_function["name"] = function_delta.get("name")
    if function_delta.get("arguments"):
        current_function["arguments"] = (
            current_function.get("arguments", "") + function_delta.get("arguments", "")
        )


def _parse_sse_chat_completion_response(response: httpx.Response) -> Dict[str, Any]:
    """将已完整返回的 OpenAI SSE 响应聚合为非流式 chat completion 格式。"""
    content_parts = []
    tool_calls: Dict[int, Dict[str, Any]] = {}
    role = "assistant"
    finish_reason = None
    usage = None
    response_id = None
    created = None
    model = None

    for line in (response.text or "").splitlines():
        line = line.strip()
        if not line or not line.startswith("data:"):
            continue

        data_str = line[len("data:"):].strip()
        if data_str == "[DONE]":
            break

        try:
            chunk = json.loads(data_str)
        except json.JSONDecodeError:
            logger.debug("跳过无法解析的 SSE 数据行: %s", safe_preview(data_str, 300))
            continue

        response_id = response_id or chunk.get("id")
        created = created or chunk.get("created")
        model = model or chunk.get("model")
        usage = chunk.get("usage") or usage

        choices = chunk.get("choices") or []
        if not choices:
            continue

        choice = choices[0]
        finish_reason = choice.get("finish_reason") or finish_reason
        delta = choice.get("delta") or {}

        if delta.get("role"):
            role = delta.get("role")
        if delta.get("content"):
            content_parts.append(delta.get("content"))
        for tool_call_delta in delta.get("tool_calls") or []:
            _merge_tool_call_delta(tool_calls, tool_call_delta)

    message: Dict[str, Any] = {"role": role, "content": "".join(content_parts)}
    if tool_calls:
        message["tool_calls"] = [tool_calls[index] for index in sorted(tool_calls)]

    logger.debug(
        "AI HTTP SSE 响应已聚合为非流式结果: chunks_content_length=%s tool_calls=%s finish_reason=%s usage=%s",
        len(message["content"]),
        len(tool_calls),
        finish_reason,
        bool(usage),
    )

    return {
        "id": response_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": usage or {},
    }


def _get_semaphore(max_concurrent: int) -> asyncio.Semaphore:
    """获取全局信号量"""
    global _global_semaphore
    if _global_semaphore is None:
        _global_semaphore = asyncio.Semaphore(max_concurrent)
    return _global_semaphore


class BaseAIClient(ABC):
    """AI HTTP 客户端基类"""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        config: Optional[AIClientConfig] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.config = config or default_config
        self.http_client = self._get_or_create_client()

    def _get_client_key(self) -> str:
        """生成客户端唯一键"""
        key_hash = hashlib.md5(self.api_key.encode()).hexdigest()[:8]
        return f"{self.__class__.__name__}_{self.base_url}_{key_hash}"

    def _get_or_create_client(self) -> httpx.AsyncClient:
        """获取或创建 HTTP 客户端"""
        client_key = self._get_client_key()

        if client_key in _http_client_pool:
            client = _http_client_pool[client_key]
            if not client.is_closed:
                return client
            del _http_client_pool[client_key]

        http_cfg = self.config.http
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=http_cfg.connect_timeout,
                read=http_cfg.read_timeout,
                write=http_cfg.write_timeout,
                pool=http_cfg.pool_timeout,
            ),
            limits=httpx.Limits(
                max_keepalive_connections=http_cfg.max_keepalive_connections,
                max_connections=http_cfg.max_connections,
                keepalive_expiry=http_cfg.keepalive_expiry,
            ),
        )
        _http_client_pool[client_key] = client
        logger.info(f"✅ 创建 HTTP 客户端: {client_key}")
        return client

    @abstractmethod
    def _build_headers(self) -> Dict[str, str]:
        """构建请求头"""
        pass

    async def _request_with_retry(
        self,
        method: str,
        endpoint: str,
        payload: Dict[str, Any],
        stream: bool = False,
    ) -> Any:
        """带重试的 HTTP 请求"""
        url = f"{self.base_url}{endpoint}"
        headers = self._build_headers()
        retry_cfg = self.config.retry
        rate_cfg = self.config.rate_limit

        semaphore = _get_semaphore(rate_cfg.max_concurrent_requests)

        async with semaphore:
            await asyncio.sleep(rate_cfg.request_delay)

            for attempt in range(retry_cfg.max_retries):
                try:
                    if attempt > 0:
                        delay = min(
                            retry_cfg.base_delay * (retry_cfg.exponential_base ** attempt),
                            retry_cfg.max_delay,
                        )
                        logger.warning(f"⚠️ 重试 {attempt + 1}/{retry_cfg.max_retries}，等待 {delay}s")
                        await asyncio.sleep(delay)

                    if stream:
                        return self.http_client.stream(method, url, headers=headers, json=payload)

                    response = await self.http_client.request(method, url, headers=headers, json=payload)
                    logger.debug(
                        "AI HTTP 响应: method=%s endpoint=%s status=%s elapsed=%.2fs headers=%s body_bytes=%s body_chars=%s",
                        method,
                        endpoint,
                        response.status_code,
                        response.elapsed.total_seconds(),
                        _debug_response_headers(response),
                        len(response.content or b""),
                        len(response.text or ""),
                    )
                    response.raise_for_status()
                    if _is_sse_response(response):
                        return _parse_sse_chat_completion_response(response)

                    try:
                        return response.json()
                    except ValueError:
                        parse_failure_reason = _classify_json_decode_failure(response)
                        logger.error(
                            "AI HTTP 响应 JSON 解析失败: method=%s endpoint=%s status=%s reason=%s headers=%s body_preview=%s",
                            method,
                            endpoint,
                            response.status_code,
                            parse_failure_reason,
                            _debug_response_headers(response),
                            safe_preview(response.text, 1000),
                            exc_info=True,
                        )
                        _log_raw_response_body(response, f"json_decode_failed:{parse_failure_reason}")
                        raise

                except httpx.HTTPStatusError as e:
                    status_code = e.response.status_code if e.response is not None else None
                    logger.error(
                        "AI HTTP 状态错误: method=%s endpoint=%s status=%s headers=%s body_preview=%s",
                        method,
                        endpoint,
                        status_code,
                        _debug_response_headers(e.response) if e.response is not None else {},
                        safe_preview(e.response.text, 1000) if e.response is not None else None,
                    )
                    if e.response is not None:
                        _log_raw_response_body(e.response, "http_status_error")
                    if status_code in retry_cfg.non_retryable_status_codes:
                        raise
                    if attempt == retry_cfg.max_retries - 1:
                        raise
                except (httpx.ConnectError, httpx.TimeoutException):
                    if attempt == retry_cfg.max_retries - 1:
                        raise

    @abstractmethod
    async def chat_completion(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
        tools: Optional[list] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        """聊天补全"""
        pass

    @abstractmethod
    async def chat_completion_stream(
        self,
        messages: list,
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        """流式聊天补全"""
        pass


async def cleanup_all_clients():
    """清理所有 HTTP 客户端"""
    for key, client in list(_http_client_pool.items()):
        if not client.is_closed:
            await client.aclose()
    _http_client_pool.clear()
    logger.info("✅ HTTP 客户端池已清理")
