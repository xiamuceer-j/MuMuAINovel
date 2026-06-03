"""章节相关的Pydantic模型"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class ChapterBase(BaseModel):
    """章节基础模型"""
    title: str = Field(..., description="章节标题")
    chapter_number: int = Field(..., description="章节序号")
    content: Optional[str] = Field(None, description="章节内容")
    summary: Optional[str] = Field(None, description="章节摘要")
    word_count: Optional[int] = Field(0, description="字数")
    status: Optional[str] = Field("draft", description="章节状态")
    outline_id: Optional[str] = Field(None, description="关联的大纲ID")
    sub_index: Optional[int] = Field(1, description="大纲下的子章节序号")
    expansion_plan: Optional[str] = Field(None, description="展开规划详情(JSON)")


class ChapterCreate(BaseModel):
    """创建章节的请求模型"""
    project_id: str = Field(..., description="所属项目ID")
    title: str = Field(..., description="章节标题")
    chapter_number: int = Field(..., description="章节序号")
    content: Optional[str] = Field(None, description="章节内容")
    summary: Optional[str] = Field(None, description="章节摘要")
    status: Optional[str] = Field("draft", description="章节状态")
    outline_id: Optional[str] = Field(None, description="关联的大纲ID")
    sub_index: Optional[int] = Field(1, description="大纲下的子章节序号")
    expansion_plan: Optional[str] = Field(None, description="展开规划详情(JSON)")


class ChapterUpdate(BaseModel):
    """更新章节的请求模型"""
    title: Optional[str] = None
    content: Optional[str] = None
    # chapter_number 不允许修改，只能通过大纲的重排序来调整
    summary: Optional[str] = None
    # word_count 自动计算，不允许手动修改
    status: Optional[str] = None


class ChapterResponse(BaseModel):
    """章节响应模型"""
    id: str
    project_id: str
    title: str
    chapter_number: int
    content: Optional[str] = None
    summary: Optional[str] = None
    word_count: int = 0
    status: str
    outline_id: Optional[str] = None
    sub_index: Optional[int] = 1
    expansion_plan: Optional[str] = None
    outline_title: Optional[str] = None  # 大纲标题（从Outline表联查）
    outline_order: Optional[int] = None  # 大纲排序序号（从Outline表联查）
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class ChapterListResponse(BaseModel):
    """章节列表响应模型"""
    total: int
    items: list[ChapterResponse]


class AnalysisTaskStatusResponse(BaseModel):
    """单章节分析任务状态响应"""
    has_task: bool
    task_id: Optional[str] = None
    chapter_id: str
    status: str
    progress: int = 0
    error_message: Optional[str] = None
    auto_recovered: bool = False
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class BatchAnalysisStatusRequest(BaseModel):
    """批量查询分析状态请求"""
    chapter_ids: Optional[List[str]] = Field(None, description="待查询章节ID列表；为空时查询项目下全部章节")


class BatchAnalysisStatusResponse(BaseModel):
    """批量查询分析状态响应"""
    project_id: str
    total: int
    items: Dict[str, AnalysisTaskStatusResponse]


class BatchAnalyzeUnanalyzedRequest(BaseModel):
    """一键分析未分析章节请求"""
    chapter_ids: Optional[List[str]] = Field(None, description="可选：限定待分析章节ID列表；为空则自动识别项目内全部未分析章节")


class BatchAnalyzeUnanalyzedResponse(BaseModel):
    """一键分析未分析章节响应"""
    project_id: str
    total_candidates: int = Field(0, description="候选章节总数（有内容章节）")
    total_started: int = Field(0, description="本次已启动分析任务数")
    total_skipped_no_content: int = Field(0, description="跳过：无内容章节数")
    total_skipped_running: int = Field(0, description="跳过：已在分析中的章节数")
    total_already_completed: int = Field(0, description="跳过：已完成分析章节数")
    started_tasks: Dict[str, AnalysisTaskStatusResponse] = Field(default_factory=dict, description="本次启动的分析任务状态映射")


class ChapterGenerateRequest(BaseModel):
    """AI生成章节内容的请求模型"""
    style_id: Optional[int] = Field(None, description="写作风格ID，不提供则不使用任何风格")
    target_word_count: Optional[int] = Field(
        3000,
        description="目标字数，默认3000字",
        ge=500,   # 最小500字
        le=10000  # 最大10000字
    )
    enable_mcp: bool = Field(True, description="是否启用MCP工具增强（搜索参考资料）")
    model: Optional[str] = Field(None, description="指定使用的AI模型，不提供则使用用户默认模型")
    narrative_perspective: Optional[str] = Field(None, description="临时人称视角：first_person/third_person/omniscient，不提供则使用项目默认")
    skill_key: Optional[str] = Field(None, description="Skill 标识，指定后以该 Skill 的工作流指导创作")
    reasoning_effort: Optional[str] = Field(None, description="思考模式：low/medium/high，不提供则不启用思考")


class BatchGenerateRequest(BaseModel):
    """批量生成章节的请求模型"""
    start_chapter_number: int = Field(..., description="起始章节序号")
    count: int = Field(..., description="生成章节数量", ge=1, le=20)
    style_id: Optional[int] = Field(None, description="写作风格ID")
    target_word_count: Optional[int] = Field(
        3000,
        description="目标字数，默认3000字",
        ge=500,
        le=10000
    )
    enable_analysis: bool = Field(False, description="是否启用同步分析")
    enable_mcp: bool = Field(True, description="是否启用MCP工具增强（搜索参考资料）")
    max_retries: int = Field(3, description="每个章节的最大重试次数", ge=0, le=5)
    model: Optional[str] = Field(None, description="指定使用的AI模型，不提供则使用用户默认模型")
    narrative_perspective: Optional[str] = Field(None, description="临时指定叙事人称，不提供则使用项目默认")
    skill_key: Optional[str] = Field(None, description="Skill 标识，指定后以该 Skill 的工作流指导创作")
    reasoning_effort: Optional[str] = Field(None, description="思考模式：low/medium/high，不提供则不启用思考")


class BatchGenerateResponse(BaseModel):
    """批量生成响应模型"""
    batch_id: str = Field(..., description="批次ID")
    message: str = Field(..., description="响应消息")
    chapters_to_generate: list[dict] = Field(..., description="待生成章节列表")
    estimated_time_minutes: int = Field(..., description="预估耗时（分钟）")


class BatchGenerateStatusResponse(BaseModel):
    """批量生成状态响应模型"""
    batch_id: str
    status: str
    total: int
    completed: int
    current_chapter_id: Optional[str] = None
    current_chapter_number: Optional[int] = None
    current_retry_count: Optional[int] = None
    max_retries: Optional[int] = None
    failed_chapters: list[dict] = []
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


class SceneData(BaseModel):
    """场景数据模型"""
    location: str = Field(..., description="场景地点")
    characters: List[str] = Field(..., description="参与角色列表")
    purpose: str = Field(..., description="场景目的")


class ExpansionPlanUpdate(BaseModel):
    """章节规划更新模型"""
    summary: Optional[str] = Field(None, description="章节情节概要")
    key_events: Optional[List[str]] = Field(None, description="关键事件列表")
    character_focus: Optional[List[str]] = Field(None, description="涉及角色列表")
    emotional_tone: Optional[str] = Field(None, description="情感基调")
    narrative_goal: Optional[str] = Field(None, description="叙事目标")
    conflict_type: Optional[str] = Field(None, description="冲突类型")
    estimated_words: Optional[int] = Field(None, description="预估字数", ge=500, le=10000)
    scenes: Optional[List[SceneData]] = Field(None, description="场景列表")
    
    model_config = ConfigDict(json_schema_extra={
            "example": {
                "key_events": ["主角遇到挑战", "关键决策时刻"],
                "character_focus": ["张三", "李四"],
                "emotional_tone": "紧张激烈",
                "narrative_goal": "推进主线剧情",
                "conflict_type": "内心冲突",
                "estimated_words": 3000,
                "scenes": [
                    {
                        "location": "城市广场",
                        "characters": ["张三", "李四"],
                        "purpose": "初次相遇"
                    }
                ]
            }
        })


class ExpansionPlanResponse(BaseModel):
    """章节规划响应模型"""
    id: str = Field(..., description="章节ID")
    expansion_plan: Optional[Dict[str, Any]] = Field(None, description="规划数据")
    message: str = Field(..., description="响应消息")


class PartialRegenerateRequest(BaseModel):
    """局部重写请求参数"""
    selected_text: str = Field(..., description="选中的原文内容")
    start_position: int = Field(..., description="在章节内容中的起始位置（字符索引）", ge=0)
    end_position: int = Field(..., description="在章节内容中的结束位置（字符索引）", ge=0)
    user_instructions: str = Field(..., description="用户的修改要求", min_length=1, max_length=1000)
    
    # 可选参数
    context_chars: int = Field(
        500,
        description="上下文截取长度（前后各截取多少字符）",
        ge=100,
        le=2000
    )
    style_id: Optional[int] = Field(None, description="写作风格ID，不提供则使用项目默认风格")
    length_mode: Optional[str] = Field(
        "similar",
        description="字数调整模式：similar(保持相近)/expand(适当扩展)/condense(精简压缩)/custom(自定义)"
    )
    target_word_count: Optional[int] = Field(
        None,
        description="指定目标字数（仅当length_mode为custom时有效）",
        ge=10,
        le=5000
    )
    
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "selected_text": "林霄挥剑斩向敌人，剑光凌厉，一招制敌。",
            "start_position": 1234,
            "end_position": 1260,
            "user_instructions": "增加更细腻的打斗描写，加入主角的心理活动",
            "context_chars": 500,
            "length_mode": "expand"
        }
    })


class PartialRegenerateResponse(BaseModel):
    """局部重写响应模型"""
    success: bool = Field(..., description="是否成功")
    new_text: str = Field(..., description="重写后的新内容")
    word_count: int = Field(..., description="新内容字数")
    original_word_count: int = Field(..., description="原文字数")
    message: str = Field("重写成功", description="响应消息")