"""公告 Pydantic Schema"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class AnnouncementCreate(BaseModel):
    """创建公告请求"""
    title: str = Field(..., max_length=120, description="公告标题")
    content: str = Field(..., description="公告正文")
    summary: Optional[str] = Field(None, max_length=255, description="公告摘要")
    level: str = Field(default="info", pattern="^(info|success|warning|error)$", description="公告级别")
    status: str = Field(default="published", pattern="^(draft|published|hidden)$", description="公告状态")
    pinned: bool = Field(default=False, description="是否置顶")
    publish_at: Optional[datetime] = Field(None, description="发布时间")
    expire_at: Optional[datetime] = Field(None, description="过期时间")


class AnnouncementUpdate(BaseModel):
    """更新公告请求"""
    title: Optional[str] = Field(None, max_length=120, description="公告标题")
    content: Optional[str] = Field(None, description="公告正文")
    summary: Optional[str] = Field(None, max_length=255, description="公告摘要")
    level: Optional[str] = Field(None, pattern="^(info|success|warning|error)$", description="公告级别")
    status: Optional[str] = Field(None, pattern="^(draft|published|hidden)$", description="公告状态")
    pinned: Optional[bool] = Field(None, description="是否置顶")
    publish_at: Optional[datetime] = Field(None, description="发布时间")
    expire_at: Optional[datetime] = Field(None, description="过期时间")


class AnnouncementResponse(BaseModel):
    """公告响应"""
    id: str
    title: str
    content: str
    summary: Optional[str] = None
    level: str
    status: Optional[str] = None
    pinned: bool
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    publish_at: Optional[datetime] = None
    expire_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AnnouncementListData(BaseModel):
    """公告列表数据"""
    total: int
    page: int = 1
    limit: int = 20
    items: List[AnnouncementResponse]
    latest_updated_at: Optional[datetime] = None
    server_time: datetime


class AnnouncementListResponse(BaseModel):
    """公告列表响应"""
    success: bool = True
    data: AnnouncementListData


class AnnouncementStatusResponse(BaseModel):
    """公告服务状态响应"""
    mode: str
    instance_id: str
    cloud_url: Optional[str] = None
    cloud_connected: Optional[bool] = None
