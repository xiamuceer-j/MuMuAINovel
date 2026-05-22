"""云端公告 API 客户端（client 模式使用）"""
import httpx
from typing import Optional, Dict, Any
from app.config import settings, INSTANCE_ID
from app.logger import get_logger

logger = get_logger(__name__)


class AnnouncementClientError(Exception):
    """公告客户端错误"""
    pass


class AnnouncementClient:
    """云端公告 API 客户端"""

    def __init__(self):
        self.base_url = settings.WORKSHOP_CLOUD_URL
        self.timeout = settings.WORKSHOP_API_TIMEOUT

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """发送请求到云端公告服务"""
        headers = {
            "X-Instance-ID": INSTANCE_ID,
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/api/announcements{path}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json,
                    headers=headers,
                )
                response.raise_for_status()
                return response.json()
        except httpx.ConnectError as e:
            logger.error(f"无法连接到云端公告服务: {self.base_url}, 错误: {e}")
            raise AnnouncementClientError("无法连接到云端公告服务，请检查网络连接")
        except httpx.TimeoutException:
            logger.error(f"云端公告服务请求超时: {url}")
            raise AnnouncementClientError("云端公告服务请求超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            logger.error(f"云端公告服务返回错误: {e.response.status_code}, {e.response.text}")
            raise AnnouncementClientError(f"云端公告服务错误: {e.response.status_code}")
        except Exception as e:
            logger.error(f"请求云端公告服务异常: {e}")
            raise AnnouncementClientError(f"请求云端公告服务失败: {str(e)}")

    async def check_connection(self) -> bool:
        """检查云端连接状态"""
        try:
            await self._request("GET", "/status")
            return True
        except Exception as e:
            logger.warning(f"云端公告连接检查失败: {e}")
            return False

    async def get_announcements(self, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        """获取公告列表"""
        return await self._request("GET", "", params={"page": page, "limit": limit})

    async def sync(self, since: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
        """同步公告"""
        params: Dict[str, Any] = {"limit": limit}
        if since:
            params["since"] = since
        return await self._request("GET", "/sync", params=params)


announcement_client = AnnouncementClient()
