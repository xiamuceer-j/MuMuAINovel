"""章节重新生成相关的Schema定义"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class PreserveElementsConfig(BaseModel):
    """保留元素配置"""
    preserve_structure: bool = Field(False, description="是否保留整体结构")
    preserve_dialogues: List[str] = Field(default_factory=list, description="需要保留的对话片段关键词")
    preserve_plot_points: List[str] = Field(default_factory=list, description="需要保留的情节点关键词")
    preserve_character_traits: bool = Field(True, description="保持角色性格一致")


class ChapterRegenerateRequest(BaseModel):
    """章节重新生成请求"""
    
    # 修改来源
    modification_source: str = Field("custom", description="修改来源: custom/analysis_suggestions/mixed")
    
    # 基于分析建议
    selected_suggestion_indices: Optional[List[int]] = Field(None, description="选中的建议索引列表")
    
    # 自定义修改指令
    custom_instructions: Optional[str] = Field(None, description="用户自定义的修改要求")
    
    # 保留配置
    preserve_elements: Optional[PreserveElementsConfig] = Field(None, description="保留元素配置")
    
    # 生成参数
    style_id: Optional[int] = Field(None, description="写作风格ID")
    target_word_count: int = Field(3000, description="目标字数", ge=500, le=10000)
    focus_areas: List[str] = Field(default_factory=list, description="重点优化方向")
    model: Optional[str] = Field(None, description="自定义AI模型")
    
    # 版本管理
    save_as_version: bool = Field(True, description="是否保存为新版本")
    version_note: Optional[str] = Field(None, description="版本说明", max_length=500)
    auto_apply: bool = Field(False, description="是否自动应用（替换当前内容）")


class RegenerationTaskResponse(BaseModel):
    """重新生成任务响应"""
    task_id: str
    chapter_id: str
    status: str
    message: str
    estimated_time_seconds: int = 120


class RegenerationTaskStatus(BaseModel):
    """重新生成任务状态"""
    task_id: str
    chapter_id: str
    status: str
    progress: int
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    # 结果信息
    original_word_count: Optional[int] = None
    regenerated_word_count: Optional[int] = None
    version_number: Optional[int] = None

