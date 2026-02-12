from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SkillSpecResponse(BaseModel):
    skill_key: str
    name: str
    description: Optional[str] = None
    allowed_tools: Optional[str] = None
    api_provider_override: Optional[str] = None
    model_override: Optional[str] = None
    temperature_override: Optional[str] = None
    max_tokens_override: Optional[str] = None
    is_builtin: Optional[bool] = None
    updated_at: Optional[datetime] = None


class SkillListResponse(BaseModel):
    items: List[SkillSpecResponse]


class SkillSyncResponse(BaseModel):
    discovered: int
    upserted: int
    skipped: int
    errors: int
    error_messages: List[str]


class SkillActivateRequest(BaseModel):
    skill_key: Optional[str] = None
