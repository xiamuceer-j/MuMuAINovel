"""公告 API"""
from datetime import datetime, timezone
from typing import Optional, AsyncGenerator
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import INSTANCE_ID, is_workshop_server, settings
from app.database import get_engine
from app.models.announcement import Announcement
from app.models.user import User
from app.schemas.announcement import AnnouncementCreate, AnnouncementUpdate
from app.services.announcement_client import announcement_client, AnnouncementClientError
from app.logger import get_logger

router = APIRouter(prefix="/announcements", tags=["announcements"])
logger = get_logger(__name__)


async def get_global_db() -> AsyncGenerator[AsyncSession, None]:
    """获取不依赖登录态的全局数据库会话"""
    engine = await get_engine("_announcements_")
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        try:
            yield session
            if session.in_transaction():
                await session.rollback()
        except Exception:
            if session.in_transaction():
                await session.rollback()
            raise


async def check_announcement_admin(request: Request) -> User:
    """检查公告管理员权限：仅云端服务端管理员可管理公告"""
    if not is_workshop_server():
        raise HTTPException(status_code=403, detail="公告发布仅在云端服务端可用")

    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")

    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")

    return user


def _announcement_to_dict(announcement: Announcement, include_status: bool = False) -> dict:
    """公告模型转字典"""
    data = {
        "id": announcement.id,
        "title": announcement.title,
        "content": announcement.content,
        "summary": announcement.summary,
        "level": announcement.level,
        "pinned": announcement.pinned,
        "author_name": announcement.author_name,
        "publish_at": announcement.publish_at.isoformat() if announcement.publish_at else None,
        "expire_at": announcement.expire_at.isoformat() if announcement.expire_at else None,
        "created_at": announcement.created_at.isoformat() if announcement.created_at else None,
        "updated_at": announcement.updated_at.isoformat() if announcement.updated_at else None,
    }
    if include_status:
        data["status"] = announcement.status
        data["author_id"] = announcement.author_id
    return data


def _active_announcement_filter(now: datetime):
    """有效公告过滤条件"""
    return (
        Announcement.status == "published",
        or_(Announcement.publish_at == None, Announcement.publish_at <= now),
        or_(Announcement.expire_at == None, Announcement.expire_at > now),
    )


def _keyword_filter(keyword: Optional[str]):
    """公告关键字搜索条件"""
    if not keyword or not keyword.strip():
        return None

    like_value = f"%{keyword.strip()}%"
    return or_(
        Announcement.title.ilike(like_value),
        Announcement.summary.ilike(like_value),
        Announcement.content.ilike(like_value),
    )


async def _get_active_announcement_ids(db: AsyncSession, now: datetime) -> list[str]:
    """获取当前仍有效的公告 ID，用于客户端清理已隐藏、删除或过期的公告"""
    result = await db.execute(
        select(Announcement.id).where(*_active_announcement_filter(now))
    )
    return list(result.scalars().all())


def _to_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """将前端 ISO 时间统一转换为 PostgreSQL TIMESTAMP WITHOUT TIME ZONE 可接受的 UTC 无时区时间"""
    if value is None:
        return None
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _validate_announcement_window(publish_at: Optional[datetime], expire_at: Optional[datetime]):
    """校验公告发布时间窗口"""
    publish_at = _to_naive_utc(publish_at)
    expire_at = _to_naive_utc(expire_at)
    if publish_at and expire_at and expire_at <= publish_at:
        raise HTTPException(status_code=400, detail="过期时间必须晚于发布时间")


def _clean_required_text(value: Optional[str], field_name: str, max_length: Optional[int] = None) -> str:
    """清理并校验必填文本"""
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{field_name}不能为空")
    if max_length and len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"{field_name}不能超过 {max_length} 个字符")
    return cleaned


def _clean_optional_text(value: Optional[str], field_name: str, max_length: int) -> Optional[str]:
    """清理并校验可选文本"""
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"{field_name}不能超过 {max_length} 个字符")
    return cleaned


async def _get_announcements_local(
    db: AsyncSession,
    page: int,
    limit: int,
    include_status: bool = False,
    status: Optional[str] = None,
    include_expired: bool = False,
    q: Optional[str] = None,
) -> dict:
    """本地查询公告列表"""
    now = datetime.utcnow()

    query = select(Announcement)
    count_query = select(func.count(Announcement.id))

    if status and status != "all":
        query = query.where(Announcement.status == status)
        count_query = count_query.where(Announcement.status == status)
    elif not include_status:
        filters = _active_announcement_filter(now)
        query = query.where(*filters)
        count_query = count_query.where(*filters)
    elif not include_expired:
        query = query.where(or_(Announcement.expire_at == None, Announcement.expire_at > now))
        count_query = count_query.where(or_(Announcement.expire_at == None, Announcement.expire_at > now))

    keyword_condition = _keyword_filter(q)
    if keyword_condition is not None:
        query = query.where(keyword_condition)
        count_query = count_query.where(keyword_condition)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = query.order_by(
        Announcement.pinned.desc(),
        Announcement.publish_at.desc(),
        Announcement.created_at.desc(),
    ).offset((page - 1) * limit).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    latest_updated_at = None
    if items:
        latest_updated_at = max((item.updated_at or item.created_at for item in items if item.updated_at or item.created_at), default=None)

    return {
        "success": True,
        "data": {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_announcement_to_dict(item, include_status=include_status) for item in items],
            "active_ids": await _get_active_announcement_ids(db, now),
            "latest_updated_at": latest_updated_at.isoformat() if latest_updated_at else None,
            "server_time": now.isoformat(),
        },
    }


async def _sync_announcements_local(db: AsyncSession, since: Optional[str], limit: int) -> dict:
    """本地同步公告"""
    now = datetime.utcnow()
    query = select(Announcement).where(*_active_announcement_filter(now))

    if since:
        try:
            since_dt = _to_naive_utc(datetime.fromisoformat(since.replace("Z", "+00:00")))
            query = query.where(
                or_(
                    Announcement.updated_at > since_dt,
                    Announcement.created_at > since_dt,
                    Announcement.publish_at > since_dt,
                )
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="since 时间格式无效")

    query = query.order_by(
        Announcement.updated_at.asc(),
        Announcement.publish_at.asc(),
        Announcement.created_at.asc(),
    ).limit(limit)

    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "success": True,
        "data": {
            "total": len(items),
            "page": 1,
            "limit": limit,
            "items": [_announcement_to_dict(item) for item in items],
            "active_ids": await _get_active_announcement_ids(db, now),
            "latest_updated_at": now.isoformat(),
            "server_time": now.isoformat(),
        },
    }


@router.get("/status")
async def get_status():
    """获取公告服务状态"""
    result = {
        "mode": settings.WORKSHOP_MODE,
        "instance_id": INSTANCE_ID,
    }

    if not is_workshop_server():
        result["cloud_url"] = settings.WORKSHOP_CLOUD_URL
        result["cloud_connected"] = await announcement_client.check_connection()

    return result


@router.get("")
async def get_announcements(
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_global_db),
):
    """获取公告列表（公开接口）"""
    if is_workshop_server():
        return await _get_announcements_local(db, page=page, limit=limit)

    try:
        return await announcement_client.get_announcements(page=page, limit=limit)
    except AnnouncementClientError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/sync")
async def sync_announcements(
    since: Optional[str] = Query(None, description="上次同步时间"),
    limit: int = Query(50, ge=1, le=100, description="同步数量"),
    db: AsyncSession = Depends(get_global_db),
):
    """同步公告（公开接口）"""
    if is_workshop_server():
        return await _sync_announcements_local(db, since=since, limit=limit)

    try:
        return await announcement_client.sync(since=since, limit=limit)
    except AnnouncementClientError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/admin/items")
async def admin_get_announcements(
    request: Request,
    status: Optional[str] = Query(None, description="公告状态"),
    q: Optional[str] = Query(None, description="标题、摘要或正文关键字"),
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    include_expired: bool = Query(True, description="是否包含过期公告"),
    db: AsyncSession = Depends(get_global_db),
):
    """管理员获取公告列表"""
    await check_announcement_admin(request)
    return await _get_announcements_local(
        db,
        page=page,
        limit=limit,
        include_status=True,
        status=status,
        include_expired=include_expired,
        q=q,
    )


@router.post("/admin/items")
async def admin_create_announcement(
    data: AnnouncementCreate,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """管理员创建公告"""
    admin = await check_announcement_admin(request)
    now = datetime.utcnow()
    publish_at = _to_naive_utc(data.publish_at) or now
    expire_at = _to_naive_utc(data.expire_at)
    _validate_announcement_window(publish_at, expire_at)

    announcement = Announcement(
        id=str(uuid.uuid4()),
        title=_clean_required_text(data.title, "公告标题", 120),
        content=_clean_required_text(data.content, "公告正文"),
        summary=_clean_optional_text(data.summary, "公告摘要", 255),
        level=data.level,
        status=data.status,
        pinned=data.pinned,
        author_id=admin.user_id,
        author_name=getattr(admin, "display_name", None) or getattr(admin, "username", None) or "管理员",
        publish_at=publish_at,
        expire_at=expire_at,
    )
    db.add(announcement)
    await db.commit()
    await db.refresh(announcement)

    return {"success": True, "item": _announcement_to_dict(announcement, include_status=True)}


@router.put("/admin/items/{announcement_id}")
async def admin_update_announcement(
    announcement_id: str,
    data: AnnouncementUpdate,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """管理员更新公告"""
    await check_announcement_admin(request)

    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")

    update_data = data.model_dump(exclude_unset=True)
    if "publish_at" in update_data:
        update_data["publish_at"] = _to_naive_utc(update_data.get("publish_at"))
    if "expire_at" in update_data:
        update_data["expire_at"] = _to_naive_utc(update_data.get("expire_at"))
    if "title" in update_data:
        update_data["title"] = _clean_required_text(update_data.get("title"), "公告标题", 120)
    if "content" in update_data:
        update_data["content"] = _clean_required_text(update_data.get("content"), "公告正文")
    if "summary" in update_data:
        update_data["summary"] = _clean_optional_text(update_data.get("summary"), "公告摘要", 255)

    next_publish_at = update_data.get("publish_at", announcement.publish_at)
    next_expire_at = update_data.get("expire_at", announcement.expire_at)
    _validate_announcement_window(next_publish_at, next_expire_at)

    for key, value in update_data.items():
        setattr(announcement, key, value)
    announcement.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(announcement)

    return {"success": True, "item": _announcement_to_dict(announcement, include_status=True)}


@router.delete("/admin/items/{announcement_id}")
async def admin_delete_announcement(
    announcement_id: str,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """管理员删除公告"""
    await check_announcement_admin(request)

    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")

    await db.delete(announcement)
    await db.commit()

    return {"success": True, "message": "删除成功"}


@router.post("/admin/items/{announcement_id}/publish")
async def admin_publish_announcement(
    announcement_id: str,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """管理员发布公告"""
    await check_announcement_admin(request)

    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")

    announcement.status = "published"
    if not announcement.publish_at:
        announcement.publish_at = datetime.utcnow()
    _validate_announcement_window(announcement.publish_at, announcement.expire_at)
    announcement.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(announcement)

    return {"success": True, "item": _announcement_to_dict(announcement, include_status=True)}


@router.post("/admin/items/{announcement_id}/hide")
async def admin_hide_announcement(
    announcement_id: str,
    request: Request,
    db: AsyncSession = Depends(get_global_db),
):
    """管理员隐藏公告"""
    await check_announcement_admin(request)

    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    announcement = result.scalar_one_or_none()
    if not announcement:
        raise HTTPException(status_code=404, detail="公告不存在")

    announcement.status = "hidden"
    announcement.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(announcement)

    return {"success": True, "item": _announcement_to_dict(announcement, include_status=True)}
