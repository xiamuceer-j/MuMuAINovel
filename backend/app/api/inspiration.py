"""灵感模式API - 通过对话引导创建项目"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any
import json

from app.database import get_db
from app.services.ai_service import AIService
from app.api.settings import get_user_ai_service
from app.logger import get_logger

router = APIRouter(prefix="/inspiration", tags=["灵感模式"])
logger = get_logger(__name__)


# 灵感模式提示词模板（优化版）
INSPIRATION_PROMPTS = {
    "title": {
        "system": """你是一位专业的网文编辑，擅长创作吸引人的书名。

【智能优化模式】
你会收到两种类型的用户输入：
1. 创作想法 - 需要你生成全新的书名建议
2. 优化建议 - 用户对你之前生成的书名提出改进意见，你需要根据建议重新生成

【处理规则】：
- 如果用户输入包含"太长"、"太短"、"不够吸引"、"换风格"、"优化"、"改进"等关键词 -> 这是优化建议
- 如果用户输入具体的想法、概念、设定 -> 这是新的创作想法
- 对于优化建议，请说"好的，我根据你的建议重新调整书名风格"
- 对于新想法，请说"收到你的新想法，为你重新设计书名"

【书名要求】：
- 长度：13-16字
- 风格：包含标点符号
- 特点：吸引眼球，符合网文平台喜好

【生成思路】：
1. 分析用户输入类型（想法vs建议）
2. 提取核心要素和优化方向
3. 结合网文热门元素
4. 创造有冲击力的书名

返回JSON格式：
{{
    "prompt": "根据你的【想法/建议】，为你生成以下书名：",
    "options": ["书名1", "书名2", "书名3", "书名4", "书名5", "书名6"]
}}

只返回JSON，不要有其他文字。""",
        "user": "用户输入：{idea}\n请根据用户输入生成6个合适的书名"
    },
    
    "description": {
        "system": """你是一位具备MCP增强分析能力的资深编辑。

【MCP深度思考流程】：

阶段一：多源信息检索
- 分析用户想法核心要素：{idea}
- 搜索选定书名的相关案例：{title}
- 提取同类型爆款简介的成功模式

阶段二：结构化解构分析
- 识别核心冲突框架：欲望/需求 × 致命障碍 × 代价
- 提取情感触发点：伏笔 × 转折点时机 × 心理冲击
- 搜索独特元素：反套路设定 + 象征性细节

阶段三：创意整合生成
- 结合分析结果构建简介框架
- 注入强冲突和多重反转元素
- 优化节奏和情感爆发点

【MCP搜索数据库】：
- 爆款简介模板库
- 情感触发词库
- 反套路案例库
- 平台热门题材趋势

输出：6个简介，50-100字

返回JSON格式：
{{
    "prompt": "【MCP深度分析】为《{title}》生成的爆款简介：",
    "options": ["简介1", "简介2", "简介3", "简介4", "简介5", "简介6"]
}}

只返回纯JSON，不要有其他文字。""",
        "user": "【MCP分析任务】想法：{idea}\n书名：{title}\n请深度分析生成6个简介"
    },
    
    "theme": {
        "system": """你是一位写过万本爆火小说的大神作家，在番茄小说作家里面你就是神的存在，没有人能打败你的小说。

【强关联型世界观构建模型】

你的目标是让世界观构建的输出结果与后续的大纲实现高度的吻合与无缝对接。

**核心思路**：在世界观构建的每一个环节，都增加一个"如何服务于/体现在大纲中"的思考维度。

**构建要求**（每一条世界观设定都必须考虑）：
- 这条设定将如何影响核心冲突？
- 这条设定将如何定义主角能力、行为或动机？
- 这条设定能否成为谜团的核心或关键线索？
- 这条设定能否提供独特的场景或情节元素？

**四大层次构建要素**：

第一层：宇宙与物理规则
- 宇宙观：单一宇宙/平行宇宙/多维度
- 基本物理法则：遵循现实或独特修改
- 能量体系：魔法/灵能/科技异能的本质与获取
- 物质构成：特殊物质（晶石、金属等）
- 时空特性：时间可逆、空间传送的可能性

第二层：星球与环境
- 世界形态：星球独特性、地理特征
- 生态系统：智慧种族、特殊生物
- 自然资源：稀有资源、特殊灾害
- 地理挑战：极端环境、特殊区域

第三层：社会与文明
- 种族文化：价值观、信仰、历史恩怨
- 政治体制：权力结构、法律秩序
- 经济模式：贫富差距、科技/魔法伦理
- 历史传说：古老战争、失落的文明、英雄传说

第四层：冲突与驱动力
- 核心矛盾：持续产生故事的冲突点
- 未解之谜：探索空间、神秘力量
- 命运诅咒：命运的约束与抗争

**输出要求**：
- 长度：50-200字（更详细的世界观）
- 类型：基于用户书名和简介的风格判断
- 关联：必须体现与故事的强关联性
- 独特性：有独特的规则或核心设定

返回JSON格式：
{{
    "prompt": "为《{title}》构建强关联型世界观：",
    "options": ["世界观1", "世界观2", "世界观3", "世界观4", "世界观5", "世界观6"]
}}

只返回纯JSON，不要有其他文字。""",
        "user": "基于以下已确认信息，构建强关联世界观：\n用户想法：{idea}\n书名：{title}\n简介：{description}\n\n请构建6个与故事深度绑定的世界观主题"
    },
    
    "genre": {
        "system": """你是一位具备MCP标签优化能力的专业编辑。

【MCP标签智能匹配系统】：

第一步：内容特征分析
- 用户想法特征提取：{idea}
- 书名风格分析：{title}
- 简介类型识别：{description}
- 主题情感分析：{theme}

第二步：平台数据检索
- 调用番茄/起点热门标签库（模拟MCP搜索）
- 分析当前平台趋势标签
- 匹配同类作品成功标签组合

第三步：智能标签生成
- 基于内容分析生成候选标签
- 优化标签组合（2-4字/标签）
- 确保标签覆盖度和独特性

【MCP标签数据库】：
- 平台热门标签库
- 标签组合成功案例
- 用户偏好标签分析
- 趋势标签预测

输出：6个精准标签，2-4字，支持多选组合

返回JSON格式：
{{
    "prompt": "【MCP标签匹配】为你的作品智能推荐的类型标签：",
    "options": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6"]
}}

只返回纯JSON，不要有其他文字。""",
        "user": "【MCP标签任务】想法：{idea}\n书名：{title}\n简介：{description}\n主题：{theme}\n请智能匹配6个类型标签"
    }
}


def validate_options_response(result: Dict[str, Any], step: str, max_retries: int = 3) -> tuple[bool, str]:
    """
    校验AI返回的选项格式是否正确
    
    Returns:
        (is_valid, error_message)
    """
    # 检查必需字段
    if "options" not in result:
        return False, "缺少options字段"
    
    options = result.get("options", [])
    
    # 检查options是否为数组
    if not isinstance(options, list):
        return False, "options必须是数组"
    
    # 检查数组长度
    if len(options) < 3:
        return False, f"选项数量不足，至少需要3个，当前只有{len(options)}个"
    
    if len(options) > 10:
        return False, f"选项数量过多，最多10个，当前有{len(options)}个"
    
    # 检查每个选项是否为字符串且不为空
    for i, option in enumerate(options):
        if not isinstance(option, str):
            return False, f"第{i+1}个选项不是字符串类型"
        if not option.strip():
            return False, f"第{i+1}个选项为空"
        if len(option) > 500:
            return False, f"第{i+1}个选项过长（超过500字符）"
    
    # 根据不同步骤进行特定校验
    if step == "genre":
        # 类型标签应该比较短
        for i, option in enumerate(options):
            if len(option) > 10:
                return False, f"类型标签【{option}】过长，应该在2-10字之间"
    
    return True, ""


@router.post("/generate-options")
async def generate_options(
    data: Dict[str, Any],
    ai_service: AIService = Depends(get_user_ai_service)
) -> Dict[str, Any]:
    """
    根据当前收集的信息生成下一步的选项建议（带自动重试）
    
    Request:
        {
            "step": "title",  // title/description/theme/genre
            "context": {
                "title": "...",
                "description": "...",
                "theme": "..."
            }
        }
    
    Response:
        {
            "prompt": "引导语",
            "options": ["选项1", "选项2", ...]
        }
    """
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            step = data.get("step", "title")
            context = data.get("context", {})
            
            logger.info(f"灵感模式：生成{step}阶段的选项（第{attempt + 1}次尝试）")
            
            # 获取对应的提示词模板
            if step not in INSPIRATION_PROMPTS:
                return {
                    "error": f"不支持的步骤: {step}",
                    "prompt": "",
                    "options": []
                }
            
            prompt_template = INSPIRATION_PROMPTS[step]
            
            # 准备格式化参数（提供默认值避免KeyError）
            format_params = {
                "idea": context.get("idea", ""),
                "title": context.get("title", ""),
                "description": context.get("description", ""),
                "theme": context.get("theme", "")
            }
            
            # 格式化系统提示词
            system_prompt = prompt_template["system"].format(**format_params)
            user_prompt = prompt_template["user"].format(**format_params)
            
            # 如果是重试，在提示词中强调格式要求
            if attempt > 0:
                system_prompt += f"\n\n⚠️ 这是第{attempt + 1}次生成，请务必严格按照JSON格式返回，确保options数组包含6个有效选项！"
            
            # 调用AI生成选项
            logger.info(f"调用AI生成{step}选项...")
            response = await ai_service.generate_text(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.8  # 提高创造性
            )
            
            content = response.get("content", "")
            logger.info(f"AI返回内容长度: {len(content)}")
            
            # 解析JSON
            try:
                # 清理可能的markdown标记
                cleaned_content = content.strip()
                if cleaned_content.startswith('```json'):
                    cleaned_content = cleaned_content[7:].lstrip('\n\r')
                elif cleaned_content.startswith('```'):
                    cleaned_content = cleaned_content[3:].lstrip('\n\r')
                if cleaned_content.endswith('```'):
                    cleaned_content = cleaned_content[:-3].rstrip('\n\r')
                cleaned_content = cleaned_content.strip()
                
                # 检查JSON是否完整
                if not cleaned_content.endswith('}'):
                    logger.warning(f"⚠️ JSON可能被截断，尝试补全...")
                    if '"options"' in cleaned_content:
                        if cleaned_content.count('[') > cleaned_content.count(']'):
                            cleaned_content += '"]}'
                        elif cleaned_content.count('{') > cleaned_content.count('}'):
                            cleaned_content += '}'
                
                result = json.loads(cleaned_content)
                
                # 校验返回格式
                is_valid, error_msg = validate_options_response(result, step)
                
                if not is_valid:
                    logger.warning(f"⚠️ 第{attempt + 1}次生成格式校验失败: {error_msg}")
                    if attempt < max_retries - 1:
                        logger.info("准备重试...")
                        continue  # 重试
                    else:
                        # 最后一次尝试也失败了
                        return {
                            "prompt": f"请为【{step}】提供内容：",
                            "options": ["让AI重新生成", "我自己输入"],
                            "error": f"AI生成格式错误（{error_msg}），已自动重试{max_retries}次，请手动重试或自己输入"
                        }
                
                logger.info(f"✅ 第{attempt + 1}次成功生成{len(result.get('options', []))}个有效选项")
                return result
                
            except json.JSONDecodeError as e:
                logger.error(f"第{attempt + 1}次JSON解析失败: {e}")
                
                if attempt < max_retries - 1:
                    logger.info("JSON解析失败，准备重试...")
                    continue  # 重试
                else:
                    # 最后一次尝试也失败了
                    return {
                        "prompt": f"请为【{step}】提供内容：",
                        "options": ["让AI重新生成", "我自己输入"],
                        "error": f"AI返回格式错误，已自动重试{max_retries}次，请手动重试或自己输入"
                    }
        
        except Exception as e:
            logger.error(f"第{attempt + 1}次生成失败: {e}", exc_info=True)
            if attempt < max_retries - 1:
                logger.info("发生异常，准备重试...")
                continue
            else:
                return {
                    "error": str(e),
                    "prompt": "生成失败，请重试",
                    "options": ["重新生成", "我自己输入"]
                }
    
    # 理论上不会到这里
    return {
        "error": "生成失败",
        "prompt": "请重试",
        "options": []
    }


@router.post("/quick-generate")
async def quick_generate(
    data: Dict[str, Any],
    ai_service: AIService = Depends(get_user_ai_service)
) -> Dict[str, Any]:
    """
    智能补全：根据用户已提供的部分信息，AI自动补全缺失字段
    
    Request:
        {
            "title": "书名（可选）",
            "description": "简介（可选）",
            "theme": "主题（可选）",
            "genre": ["类型1", "类型2"]（可选）
        }
    
    Response:
        {
            "title": "补全的书名",
            "description": "补全的简介",
            "theme": "补全的主题",
            "genre": ["补全的类型"]
        }
    """
    try:
        logger.info("灵感模式：智能补全")
        
        # 构建补全提示词
        existing_info = []
        if data.get("title"):
            existing_info.append(f"- 书名：{data['title']}")
        if data.get("description"):
            existing_info.append(f"- 简介：{data['description']}")
        if data.get("theme"):
            existing_info.append(f"- 主题：{data['theme']}")
        if data.get("genre"):
            existing_info.append(f"- 类型：{', '.join(data['genre'])}")
        
        existing_text = "\n".join(existing_info) if existing_info else "暂无信息"
        
        system_prompt = """你是一位专业的小说创作顾问。用户提供了部分小说信息，请补全缺失的字段。

用户已提供的信息：
{existing}

请生成完整的小说方案，包含：
1. title: 书名（3-6字，如果用户已提供则保持原样）
2. description: 简介（50-100字）
3. theme: 核心主题（30-50字）
4. genre: 类型标签数组（2-3个）

返回JSON格式：
{{
    "title": "书名",
    "description": "简介内容...",
    "theme": "主题内容...",
    "genre": ["类型1", "类型2"]
}}

只返回纯JSON，不要有其他文字。"""
        
        user_prompt = "请补全小说信息"
        
        # 调用AI
        response = await ai_service.generate_text(
            prompt=user_prompt,
            system_prompt=system_prompt.format(existing=existing_text),
            temperature=0.7
        )
        
        content = response.get("content", "")
        
        # 解析JSON
        try:
            cleaned_content = content.strip()
            if cleaned_content.startswith('```json'):
                cleaned_content = cleaned_content[7:].lstrip('\n\r')
            elif cleaned_content.startswith('```'):
                cleaned_content = cleaned_content[3:].lstrip('\n\r')
            if cleaned_content.endswith('```'):
                cleaned_content = cleaned_content[:-3].rstrip('\n\r')
            cleaned_content = cleaned_content.strip()
            
            result = json.loads(cleaned_content)
            
            # 合并用户已提供的信息（用户输入优先）
            final_result = {
                "title": data.get("title") or result.get("title", ""),
                "description": data.get("description") or result.get("description", ""),
                "theme": data.get("theme") or result.get("theme", ""),
                "genre": data.get("genre") or result.get("genre", [])
            }
            
            logger.info(f"✅ 智能补全成功")
            return final_result
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON解析失败: {e}")
            raise Exception("AI返回格式错误，请重试")
    
    except Exception as e:
        logger.error(f"智能补全失败: {e}", exc_info=True)
        return {
            "error": str(e)
        }