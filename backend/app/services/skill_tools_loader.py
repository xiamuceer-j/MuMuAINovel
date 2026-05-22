"""Skill 工具加载器

将 Skill 注册为 Function Calling 格式的 tools，
让 AI 在章节生成时自主决定是否调用 Skill。

与 MCP 工具不同，Skill tool 的执行是本地的（直接加载内容），
不需要通过 MCP 协议。
"""

from typing import List, Dict, Optional, Any
from app.logger import get_logger

logger = get_logger(__name__)

# Skill tool 名称前缀，用于区分 MCP 工具
SKILL_TOOL_PREFIX = "use_skill_"


def _skill_key_to_tool_name(skill_key: str) -> str:
    """将 skill_key 转换为合法的 function name（只允许 a-z 0-9 _ -）"""
    safe_name = skill_key.replace("-", "_").replace(" ", "_")
    # 移除不合法字符
    safe_name = "".join(c for c in safe_name if c.isalnum() or c == "_")
    return f"{SKILL_TOOL_PREFIX}{safe_name}"


def _tool_name_to_skill_key(tool_name: str) -> str:
    """从 tool name 反查 skill_key"""
    if tool_name.startswith(SKILL_TOOL_PREFIX):
        return tool_name[len(SKILL_TOOL_PREFIX):]
    return tool_name


def is_skill_tool(tool_name: str) -> bool:
    """判断一个 tool name 是否是 Skill 工具"""
    return tool_name.startswith(SKILL_TOOL_PREFIX)


def get_skill_tools(
    skill_type_filter: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    将所有 Skill 转换为 OpenAI Function Calling 格式的 tools。

    Args:
        skill_type_filter: 只包含指定类型的 Skill（如 ["writing", "polishing"]）
                          None 表示包含所有类型

    Returns:
        OpenAI tools 格式的列表
    """
    from app.services.skill_loader import get_all_skills_cached

    skills = get_all_skills_cached()
    tools = []

    for skill in skills:
        skill_type = skill.get("skill_type", "generic")

        # 类型过滤
        if skill_type_filter and skill_type not in skill_type_filter:
            continue

        skill_key = skill["template_key"]
        skill_name = skill["template_name"]
        description = skill.get("description", "")
        triggers = skill.get("triggers", [])

        # 构建 tool description
        tool_desc = f"{skill_name}"
        if description:
            tool_desc += f"：{description}"
        if triggers:
            trigger_text = "、".join(triggers)
            tool_desc += f"\n触发场景：{trigger_text}"

        # 限制 description 长度
        if len(tool_desc) > 500:
            tool_desc = tool_desc[:497] + "..."

        tool = {
            "type": "function",
            "function": {
                "name": _skill_key_to_tool_name(skill_key),
                "description": tool_desc,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {
                            "type": "string",
                            "description": "简要说明为什么选择使用这个 Skill（1-2句话）"
                        }
                    },
                    "required": []
                }
            }
        }
        tools.append(tool)

    if tools:
        logger.info(f"🎯 已将 {len(tools)} 个 Skill 注册为 AI 可调用工具")
    return tools


def load_skill_content_by_tool_name(tool_name: str) -> Optional[Dict[str, Any]]:
    """
    根据 tool name 加载对应的 Skill 完整内容。

    Args:
        tool_name: function calling 返回的 tool name

    Returns:
        包含 skill 信息的字典，或 None
    """
    from app.services.skill_loader import get_all_skills_cached

    skill_key = _tool_name_to_skill_key(tool_name)
    skills = get_all_skills_cached()

    for skill in skills:
        if skill["template_key"] == skill_key:
            return skill

    logger.warning(f"⚠️ 未找到 Skill tool 对应的 Skill: {tool_name} -> {skill_key}")
    return None


def build_skill_tool_result(tool_name: str) -> str:
    """
    构建 Skill tool call 的返回内容。
    当 AI 选择调用某个 Skill 时，返回该 Skill 的完整工作流指令。

    Args:
        tool_name: AI 返回的 tool name

    Returns:
        Skill 的完整内容，作为 tool result 返回给 AI
    """
    skill = load_skill_content_by_tool_name(tool_name)
    if not skill:
        return f"错误：未找到对应的 Skill（{tool_name}）"

    skill_name = skill["template_name"]
    content = skill["content"]

    result = f"""## Skill 工作流：{skill_name}

{content}

---
⚠️ 请严格遵循上述 Skill 工作流指令进行创作！"""

    logger.info(f"🎯 AI 自主选择了 Skill: {skill_name}（{len(content)}字符）")
    return result


async def auto_select_skill(
    ai_service,
    chapter_context: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[str]:
    """
    让 AI 自动选择适合当前章节上下文的 Skill。

    通过 Function Calling 实现：
    1. 将所有写作/润色类 Skill 注册为 tools
    2. 发送章节上下文给 AI
    3. AI 决定是否调用某个 Skill，还是直接创作

    Args:
        ai_service: AIService 实例
        chapter_context: 章节上下文（大纲、前文摘要等）
        provider: AI 提供商
        model: 模型名称

    Returns:
        选中的 skill_key，或 None（AI 认为不需要 Skill）
    """
    skill_tools = get_skill_tools(
        skill_type_filter=["writing", "polishing", "generic"]
    )

    if not skill_tools:
        logger.info("🎯 没有可用的写作/润色类 Skill，跳过自动选择")
        return None

    # 提取精简的章节摘要（从完整 prompt 中提取关键信息，控制在 1500 字以内）
    import re as _re
    # 尝试提取大纲和情感基调等关键信息
    summary_parts = []
    
    # 提取章节概要
    outline_match = _re.search(r'【章节概要】\s*(.+?)(?=【|$)', chapter_context, _re.DOTALL)
    if outline_match:
        summary_parts.append(f"章节概要：{outline_match.group(1).strip()[:500]}")
    
    # 提取情感基调
    emotion_match = _re.search(r'【情感基调】\s*(.+?)(?=【|$)', chapter_context, _re.DOTALL)
    if emotion_match:
        summary_parts.append(f"情感基调：{emotion_match.group(1).strip()[:200]}")
    
    # 提取叙事目标
    goal_match = _re.search(r'【叙事目标】\s*(.+?)(?=【|$)', chapter_context, _re.DOTALL)
    if goal_match:
        summary_parts.append(f"叙事目标：{goal_match.group(1).strip()[:200]}")
    
    # 如果提取失败，使用截断的原文
    if not summary_parts:
        summary_parts.append(chapter_context[:1500])
    
    chapter_summary = "\n".join(summary_parts)

    # 构建让 AI 选择 Skill 的提示词
    selection_prompt = f"""你是一个专业的小说创作助手。请根据以下章节信息，判断是否需要使用某个 Skill（写作技巧工具）来辅助创作。

## 章节信息

{chapter_summary}

---

## 可用的 Skill 工具

请查看上方提供的工具列表，根据章节的题材、风格、场景需要，选择最合适的 Skill。
如果你认为当前章节不需要任何特殊的 Skill 技巧，请不要调用任何工具，直接回复"不需要"。"""

    try:
        # 使用 generate_text + tools，让 AI 通过 function calling 选择
        # max_tokens 设为 500，兼容推理模型（reasoning_tokens 不计入输出）
        response = await ai_service.generate_text(
            prompt=selection_prompt,
            provider=provider,
            model=model,
            temperature=0.3,  # 低温度，让选择更确定
            max_tokens=500,
            system_prompt="你是一个专业的小说创作助手。请根据章节上下文选择最合适的 Skill 工具，或者判断不需要使用 Skill。",
            tools=skill_tools,
            tool_choice="auto",
            auto_mcp=False,  # 不加载 MCP 工具，避免干扰
            handle_tool_calls=False,  # 我们自己处理 tool calls
        )

        # 检查 AI 是否选择了某个 Skill
        tool_calls = response.get("tool_calls", [])
        if tool_calls:
            for tc in tool_calls:
                func_name = tc.get("function", {}).get("name", "")
                if is_skill_tool(func_name):
                    skill_key = _tool_name_to_skill_key(func_name)
                    logger.info(f"🎯 AI 自动选择了 Skill: {skill_key}")
                    return skill_key

        # AI 没有调用任何工具，说明不需要 Skill
        content = response.get("content", "")
        logger.info(f"🎯 AI 判断不需要使用 Skill（回复: {content[:100]}）")
        return None

    except Exception as e:
        logger.warning(f"⚠️ Skill 自动选择失败: {e}，将不使用 Skill")
        return None
