"""项目自动推进计划相关的 Pydantic 模型"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProjectGenerationScheduleBase(BaseModel):
    """项目自动推进计划基础模型"""

    model_config = ConfigDict(protected_namespaces=())

    enabled: bool = Field(default=False, description="是否启用自动推进")
    cron_expr: str = Field(default="0 9 * * *", min_length=1, max_length=100, description="Cron 表达式")
    timezone: str = Field(default="Asia/Shanghai", min_length=1, max_length=100, description="时区")
    chapters_per_run: int = Field(default=1, ge=1, le=20, description="每次触发生成章节数")
    target_word_count: int = Field(default=3000, ge=100, le=50000, description="目标字数")
    enable_analysis: bool = Field(default=False, description="是否启用同步分析")
    enable_mcp: bool = Field(default=False, description="是否启用 MCP 增强")
    max_retries: int = Field(default=3, ge=0, le=10, description="最大重试次数")
    model: Optional[str] = Field(default=None, max_length=100, description="指定使用的模型")
    min_ready_chapters: int = Field(default=3, ge=1, le=50, description="最少待写章节缓冲数")
    outline_batch_size: int = Field(default=1, ge=1, le=10, description="每次补充大纲数量")
    chapters_per_outline: int = Field(default=3, ge=1, le=10, description="每个大纲默认展开章节数")
    expansion_strategy: Literal["balanced", "climax", "detail"] = Field(
        default="balanced", description="展开策略：balanced=均衡展开，climax=高潮优先，detail=细节展开"
    )
    enable_scene_analysis: bool = Field(default=False, description="是否启用场景分析")


class ProjectGenerationScheduleUpdate(ProjectGenerationScheduleBase):
    """项目自动推进计划更新模型"""


class ProjectGenerationScheduleResponse(ProjectGenerationScheduleBase):
    """项目自动推进计划响应模型"""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    project_id: str
    user_id: str
    outline_mode: Optional[Literal["one-to-one", "one-to-many"]] = None
    last_pipeline_stage: Optional[str] = None
    next_run_at: Optional[datetime] = None
    last_triggered_at: Optional[datetime] = None
    last_finished_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_error: Optional[str] = None
    current_batch_task_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
