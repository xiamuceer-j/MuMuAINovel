"""AI 客户端基类"""
import asyncio
import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from app.logger import get_logger
from app.services.ai_config import AIClientConfig, default_config

logger = get_logger(__name__)

# 全局 HTTP 客户端池
_http_client_pool: Dict[str, httpx.AsyncClient] = {}
_global_semaphore: Optional[asyncio.Semaphore] = None


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
                    response.raise_for_status()
                    
                    try:
                        return response.json()
                    except json.JSONDecodeError as e:
                        logger.error(f"❌ JSON 解析失败: {e}")
                        logger.error(f"📄 响应状态码: {response.status_code}")
                        logger.error(f"📄 响应内容: {response.text[:500]}")  # 只记录前500字符
                        raise ValueError(f"API 返回了非 JSON 响应 (状态码: {response.status_code})")

                except httpx.HTTPStatusError as e:
                    if e.response.status_code in retry_cfg.non_retryable_status_codes:
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