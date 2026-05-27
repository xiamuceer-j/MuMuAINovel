"""项目自动推进计划数据模型"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class ProjectGenerationSchedule(Base):
    """项目自动推进计划表"""

    __tablename__ = "project_generation_schedules"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), nullable=False, unique=True, comment="项目ID")
    user_id = Column(String(100), nullable=False, index=True, comment="用户ID")

    enabled = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用自动推进")
    cron_expr = Column(String(100), default="0 9 * * *", server_default="0 9 * * *", nullable=False, comment="Cron表达式")
    timezone = Column(String(100), default="Asia/Shanghai", server_default="Asia/Shanghai", nullable=False, comment="时区")
    chapters_per_run = Column(Integer, default=1, server_default="1", nullable=False, comment="每次触发生成章节数")
    target_word_count = Column(Integer, default=3000, server_default="3000", nullable=False, comment="目标字数")
    enable_analysis = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用同步分析")
    enable_mcp = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用MCP增强")
    max_retries = Column(Integer, default=3, server_default="3", nullable=False, comment="最大重试次数")
    model = Column(String(100), comment="指定使用的模型")
    min_ready_chapters = Column(Integer, default=3, server_default="3", nullable=False, comment="最少待写章节缓冲数")
    outline_batch_size = Column(Integer, default=1, server_default="1", nullable=False, comment="每次补充大纲数量")
    chapters_per_outline = Column(Integer, default=3, server_default="3", nullable=False, comment="每个大纲默认展开章节数")
    expansion_strategy = Column(String(50), default="balanced", server_default="balanced", nullable=False, comment="展开策略")
    enable_scene_analysis = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用场景分析")

    last_pipeline_stage = Column(String(50), comment="最近一次执行到的流水线阶段")
    next_run_at = Column(DateTime, comment="下一次执行时间")
    last_triggered_at = Column(DateTime, comment="最近触发时间")
    last_finished_at = Column(DateTime, comment="最近完成时间")
    last_run_status = Column(String(50), comment="最近运行状态")
    last_error = Column(Text, comment="最近错误信息")
    current_batch_task_id = Column(String(36), comment="当前关联的批量任务ID")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("idx_project_generation_schedules_enabled_next_run_at", "enabled", "next_run_at"),
    )

    def __repr__(self) -> str:
        return f"<ProjectGenerationSchedule(id={self.id}, project_id={self.project_id}, enabled={self.enabled})>"
