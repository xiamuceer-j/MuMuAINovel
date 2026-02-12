from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.database import get_db
from app.user_manager import User
from app.logger import get_logger
from app.models.settings import Settings
from app.models.skill_spec import SkillSpec
from app.api.settings import require_login
from app.schemas.skills import SkillListResponse, SkillSpecResponse, SkillSyncResponse, SkillActivateRequest
from app.services.skills_service import upsert_builtin_skills, parse_preferences, dump_preferences


logger = get_logger(__name__)
router = APIRouter(prefix="/skills", tags=["技能管理"])


@router.post("/sync", response_model=SkillSyncResponse)
async def sync_skills(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    discovered, upserted, skipped, errors, error_messages = await upsert_builtin_skills(db)
    logger.info(f"用户 {user.user_id} 同步技能: discovered={discovered} upserted={upserted} errors={errors}")
    return SkillSyncResponse(
        discovered=discovered,
        upserted=upserted,
        skipped=skipped,
        errors=errors,
        error_messages=error_messages,
    )


@router.get("", response_model=SkillListResponse)
async def list_skills(
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SkillSpec).order_by(SkillSpec.updated_at.desc()))
    items = result.scalars().all()
    return SkillListResponse(
        items=[
            SkillSpecResponse(
                skill_key=i.skill_key,
                name=i.name,
                description=i.description,
                allowed_tools=i.allowed_tools,
                api_provider_override=i.api_provider_override,
                model_override=i.model_override,
                temperature_override=i.temperature_override,
                max_tokens_override=i.max_tokens_override,
                is_builtin=i.is_builtin,
                updated_at=i.updated_at,
            )
            for i in items
        ]
    )


@router.post("/activate")
async def activate_skill(
    data: SkillActivateRequest,
    user: User = Depends(require_login),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Settings).where(Settings.user_id == user.user_id))
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=404, detail="未找到用户设置")

    if data.skill_key:
        s = await db.execute(select(SkillSpec).where(SkillSpec.skill_key == data.skill_key))
        if not s.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="技能不存在")

    prefs = parse_preferences(settings.preferences)
    if data.skill_key:
        prefs["active_skill_key"] = data.skill_key
    else:
        prefs.pop("active_skill_key", None)
    settings.preferences = dump_preferences(prefs)
    await db.commit()
    return {"success": True, "active_skill_key": prefs.get("active_skill_key")}
