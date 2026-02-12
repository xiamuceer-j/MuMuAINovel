"""项目相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Literal
from datetime import datetime


class ProjectBase(BaseModel):
    """项目基础模型"""
    title: str = Field(..., description="项目标题")
    description: Optional[str] = Field(None, description="项目描述")
    theme: Optional[str] = Field(None, description="主题")
    genre: Optional[str] = Field(None, description="小说类型")
    target_words: Optional[int] = Field(None, description="目标字数")
    outline_mode: Literal["one-to-one", "one-to-many"] = Field(
        default="one-to-many",
        description="大纲章节模式: one-to-one(传统模式,1大纲→1章节) 或 one-to-many(细化模式,1大纲→N章节)"
    )


class ProjectCreate(ProjectBase):
    """创建项目的请求模型"""
    pass


class ProjectUpdate(BaseModel):
    """更新项目的请求模型"""
    title: Optional[str] = None
    description: Optional[str] = None
    theme: Optional[str] = None
    genre: Optional[str] = None
    target_words: Optional[int] = None
    status: Optional[str] = None
    # wizard_status 和 wizard_step 只能通过向导API修改，普通更新不允许
    world_time_period: Optional[str] = None
    world_location: Optional[str] = None
    world_atmosphere: Optional[str] = None
    world_rules: Optional[str] = None
    chapter_count: Optional[int] = None
    narrative_perspective: Optional[str] = None
    character_count: Optional[int] = None
    active_skill_key: Optional[str] = None
    # current_words 由章节内容自动计算，不允许手动修改


class ProjectResponse(ProjectBase):
    """项目响应模型"""
    id: str  # UUID字符串
    status: str
    current_words: int
    wizard_status: Optional[str] = None
    wizard_step: Optional[int] = None
    world_time_period: Optional[str] = None
    world_location: Optional[str] = None
    world_atmosphere: Optional[str] = None
    world_rules: Optional[str] = None
    chapter_count: Optional[int] = None
    narrative_perspective: Optional[str] = None
    character_count: Optional[int] = None
    active_skill_key: Optional[str] = None
    outline_mode: Literal["one-to-one", "one-to-many"]
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class ProjectListResponse(BaseModel):
    """项目列表响应模型"""
    total: int
    items: list[ProjectResponse]


class ProjectWizardRequest(BaseModel):
    """项目创建向导请求模型"""
    title: str = Field(..., description="书名")
    theme: str = Field(..., description="主题")
    genre: Optional[str] = Field(None, description="类型")
    chapter_count: int = Field(..., ge=1, description="章节数量")
    narrative_perspective: str = Field(..., description="叙事视角")
    character_count: int = Field(5, ge=5, description="角色数量（至少5个）")
    target_words: Optional[int] = Field(None, description="目标字数")
    outline_mode: Literal["one-to-one", "one-to-many"] = Field(
        default="one-to-many",
        description="大纲章节模式"
    )


class WorldBuildingResponse(BaseModel):
    """世界构建响应模型"""
    time_period: str = Field(..., description="时间背景")
    location: str = Field(..., description="地理位置")
    atmosphere: str = Field(..., description="氛围基调")
    rules: str = Field(..., description="世界规则")
