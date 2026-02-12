from sqlalchemy import Column, String, Text, DateTime, Boolean, Index
from sqlalchemy.sql import func
from app.database import Base
import uuid


class SkillSpec(Base):
    __tablename__ = "skill_specs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    skill_key = Column(String(64), nullable=False, comment="技能唯一标识")
    name = Column(String(128), nullable=False, comment="技能名称")
    description = Column(Text, nullable=True, comment="技能描述")
    content = Column(Text, nullable=False, comment="技能内容（Markdown）")
    allowed_tools = Column(Text, nullable=True, comment="允许的工具列表（逗号分隔）")
    api_provider_override = Column(String(32), nullable=True, comment="AI提供商覆盖")
    model_override = Column(String(128), nullable=True, comment="模型覆盖")
    temperature_override = Column(String(32), nullable=True, comment="温度覆盖")
    max_tokens_override = Column(String(32), nullable=True, comment="最大tokens覆盖")
    source_path = Column(String(255), nullable=True, comment="来源路径")
    is_builtin = Column(Boolean(), nullable=True, comment="是否内置")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("ux_skill_specs_key", "skill_key", unique=True),
    )
