"""公告数据模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base


class Announcement(Base):
    """系统公告"""
    __tablename__ = "announcements"

    id = Column(String(36), primary_key=True, comment="UUID")
    title = Column(String(120), nullable=False, comment="公告标题")
    content = Column(Text, nullable=False, comment="公告正文")
    summary = Column(String(255), comment="公告摘要")
    level = Column(String(20), default="info", nullable=False, comment="级别：info/success/warning/error")
    status = Column(String(20), default="published", nullable=False, comment="状态：draft/published/hidden")
    pinned = Column(Boolean, default=False, nullable=False, comment="是否置顶")
    author_id = Column(String(100), comment="发布管理员ID")
    author_name = Column(String(100), comment="发布管理员显示名")
    publish_at = Column(DateTime, server_default=func.now(), comment="发布时间")
    expire_at = Column(DateTime, comment="过期时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("idx_announcements_status", "status"),
        Index("idx_announcements_publish_at", "publish_at"),
        Index("idx_announcements_updated_at", "updated_at"),
        Index("idx_announcements_pinned", "pinned"),
    )

    def __repr__(self):
        return f"<Announcement(id={self.id}, title={self.title})>"
