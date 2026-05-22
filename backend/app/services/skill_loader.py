"""Skill 提示词加载器

从 backend/app/skills/ 目录动态加载 oh-story-claudecode 格式的 Skill，
将其转换为 PromptService 兼容的系统默认模板。

每个 Skill 目录结构：
  skills/{skill_name}/
  ├── SKILL.md          # YAML元数据 + 完整工作流指令
  └── references/       # 参考知识库（可选）
      ├── xxx.md
      └── ...
"""

import os
import re
from typing import List, Dict, Optional
from app.logger import get_logger

logger = get_logger(__name__)

# Skills 目录路径：backend/app/skills/ （本文件在 backend/app/services/ 下）
SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")

# 持久化 Skills 目录（Docker volume 挂载路径，用户创建的 Skill 保存在这里）
PERSISTENT_SKILLS_DIR = os.environ.get(
    "SKILLS_PERSISTENT_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "storage", "skills")
)


# Skill 分类定义
SKILL_TYPES = {
    "writing": {
        "label": "✍️ 写作类",
        "color": "blue",
        "category_hint": "创作章节时注入 → 改变 AI 写作风格（对话、悬念等）",
    },
    "polishing": {
        "label": "✨ 润色类",
        "color": "orange",
        "category_hint": "生成两次：先写初稿 → 再自动润色去AI味",
    },
    "analysis": {
        "label": "🔍 分析类",
        "color": "green",
        "category_hint": "Skill Chat 对话中使用，分析章节内容",
    },
    "tool": {
        "label": "🔧 工具类",
        "color": "purple",
        "category_hint": "Skill Chat 对话中使用，浏览器、搜索等辅助能力",
    },
    "generic": {
        "label": "💬 通用类",
        "color": "default",
        "category_hint": "Skill Chat 对话中使用，通用助手",
    },
}

# 根据 name 自动推断 skill_type 的关键词映射
SKILL_TYPE_KEYWORDS = {
    "writing": ["write", "写作", "dialogue", "tension", "对话", "悬念"],
    "polishing": ["deslop", "polish", "润色", "去味"],
    "analysis": ["analyze", "scan", "分析", "拆文", "扫榜"],
    "tool": ["browser", "cdp", "工具", "浏览器"],
}


def infer_skill_type(name: str) -> str:
    """根据 Skill 名称自动推断 skill_type"""
    name_lower = name.lower()
    for skill_type, keywords in SKILL_TYPE_KEYWORDS.items():
        for kw in keywords:
            if kw in name_lower:
                return skill_type
    return "generic"


def _parse_yaml_frontmatter(content: str) -> Dict[str, str]:
    """解析 SKILL.md 开头的 YAML frontmatter"""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}
    
    yaml_text = match.group(1)
    result = {}
    
    # 简单解析 YAML（不引入 pyyaml 依赖）
    name_match = re.search(r'^name:\s*(.+)$', yaml_text, re.MULTILINE)
    if name_match:
        result['name'] = name_match.group(1).strip()
    
    # 解析 skill_type 字段
    type_match = re.search(r'^skill_type:\s*(.+)$', yaml_text, re.MULTILINE)
    if type_match:
        type_val = type_match.group(1).strip().strip('"').strip("'")
        if type_val in SKILL_TYPES:
            result['skill_type'] = type_val
    
    desc_match = re.search(r'description:\s*\|(.*?)^(?=\S)', yaml_text, re.MULTILINE | re.DOTALL)
    if desc_match:
        desc = desc_match.group(1).strip()
        # 清理缩进
        lines = desc.split('\n')
        min_indent = float('inf')
        for line in lines:
            if line.strip():
                indent = len(line) - len(line.lstrip())
                min_indent = min(min_indent, indent)
        if min_indent == float('inf'):
            min_indent = 0
        desc = '\n'.join(line[min_indent:] if line.strip() else '' for line in lines)
        result['description'] = desc.strip()
    else:
        desc_single = re.search(r'description:\s*"(.+?)"', yaml_text, re.DOTALL)
        if desc_single:
            result['description'] = desc_single.group(1).strip()
        else:
            desc_single2 = re.search(r'description:\s*(.+?)$', yaml_text, re.MULTILINE)
            if desc_single2:
                result['description'] = desc_single2.group(1).strip()
    
    return result


def _get_skill_body(content: str) -> str:
    """获取 SKILL.md 中 YAML frontmatter 之后的内容（即工作流指令）"""
    match = re.match(r'^---\s*\n.*?\n---\s*\n', content, re.DOTALL)
    if match:
        return content[match.end():].strip()
    return content.strip()


def _get_references(skill_dir: str) -> Dict[str, str]:
    """读取 skill 目录下 references/ 中的所有 .md 文件"""
    refs_dir = os.path.join(skill_dir, "references")
    references = {}
    
    if not os.path.isdir(refs_dir):
        return references
    
    for filename in sorted(os.listdir(refs_dir)):
        if filename.endswith('.md'):
            filepath = os.path.join(refs_dir, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    ref_name = filename[:-3]  # 去掉 .md 后缀
                    references[ref_name] = f.read().strip()
            except Exception as e:
                logger.warning(f"读取参考文件失败: {filepath}, 错误: {e}")
    
    return references


def _load_skills_from_dir(skills_dir: str, skills_map: Dict[str, Dict], source: str = "builtin") -> None:
    """从指定目录加载 Skills 到 skills_map（按 skill_name 去重，后加载的覆盖先加载的）"""
    if not os.path.isdir(skills_dir):
        return
    
    for skill_name in sorted(os.listdir(skills_dir)):
        skill_dir = os.path.join(skills_dir, skill_name)
        if not os.path.isdir(skill_dir):
            continue
        
        skill_md_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_md_path):
            continue
        
        try:
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            metadata = _parse_yaml_frontmatter(content)
            body = _get_skill_body(content)
            references = _get_references(skill_dir)
            
            triggers = []
            name = metadata.get('name', skill_name)
            triggers.append(f"/{name}")
            
            desc = metadata.get('description', '')
            trigger_match = re.findall(r'[「](.+?)[」]', desc)
            triggers.extend(trigger_match)
            
            if references:
                ref_section = "\n\n---\n\n## 附录：参考资料知识库\n"
                ref_section += "（以下内容根据用户需求按需引用，不需要全部使用）\n"
                for ref_name, ref_content in references.items():
                    ref_section += f"\n### 参考资料：{ref_name}\n\n{ref_content}\n"
                full_content = body + ref_section
            else:
                full_content = body
            
            skill_type = metadata.get('skill_type') or infer_skill_type(name)
            type_info = SKILL_TYPES.get(skill_type, SKILL_TYPES["generic"])
            sub_category = type_info["label"]
            category_hint = type_info["category_hint"]
            
            skill_template = {
                "template_key": f"SKILL_{name.upper().replace('-', '_')}",
                "template_name": metadata.get('description', '').split('。')[0] if '。' in metadata.get('description', '') else name,
                "category": sub_category,
                "skill_type": skill_type,
                "category_hint": category_hint,
                "description": desc,
                "parameters": ["user_input"],
                "content": full_content,
                "references": references,
                "triggers": triggers,
                "is_skill": True,
                "_source": source,
                "_skill_dir": skill_dir,
            }
            
            # 用 skill_name 作为 key，后加载的（用户自定义）覆盖先加载的（内置）
            skills_map[skill_name] = skill_template
            logger.info(f"加载 Skill: {name} (来源: {source}, 分类: {sub_category}, 类型: {skill_type})")
            
        except Exception as e:
            logger.error(f"加载 Skill 失败: {skill_name}, 错误: {e}")


def load_skills() -> List[Dict]:
    """
    从内置目录和持久化目录加载所有 Skill，返回合并后的模板列表。
    
    加载策略：
    1. 先加载内置 Skills (backend/app/skills/)
    2. 再加载持久化 Skills (storage/skills/)
    3. 同名 Skill 以持久化版本为准（用户可覆盖内置 Skill）
    
    Returns:
        List[Dict]: Skill 模板列表
    """
    skills_map: Dict[str, Dict] = {}  # key: skill_name (目录名)
    
    # 1. 加载内置 Skills
    _load_skills_from_dir(SKILLS_DIR, skills_map, source="builtin")
    
    # 2. 加载持久化 Skills（会覆盖同名内置 Skill）
    _load_skills_from_dir(PERSISTENT_SKILLS_DIR, skills_map, source="persistent")
    
    # 按 template_key 排序返回
    return sorted(skills_map.values(), key=lambda s: s["template_key"])


def get_skill_by_trigger(user_input: str) -> Optional[Dict]:
    """
    根据用户输入匹配对应的 Skill
    
    Args:
        user_input: 用户输入的文本
        
    Returns:
        匹配到的 Skill 模板，未匹配返回 None
    """
    skills = load_skills()
    user_input_lower = user_input.lower().strip()
    
    for skill in skills:
        triggers = skill.get('triggers', [])
        for trigger in triggers:
            trigger_lower = trigger.lower()
            # 精确匹配触发词
            if user_input_lower == trigger_lower:
                return skill
            # 用户输入以触发词开头
            if user_input_lower.startswith(trigger_lower):
                return skill
    
    # 自然语言模糊匹配
    keyword_map = {
        "长篇写作": ["SKILL_STORY_LONG_WRITE"],
        "写长篇": ["SKILL_STORY_LONG_WRITE"],
        "帮我开书": ["SKILL_STORY_LONG_WRITE"],
        "写大纲": ["SKILL_STORY_LONG_WRITE"],
        "去ai味": ["SKILL_STORY_DESLOP"],
        "去味": ["SKILL_STORY_DESLOP"],
        "太ai了": ["SKILL_STORY_DESLOP"],
        "润色": ["SKILL_STORY_DESLOP", "SKILL_STORY_POLISH"],
        "帮我改": ["SKILL_STORY_POLISH"],
        "优化文字": ["SKILL_STORY_POLISH"],
        "对话": ["SKILL_STORY_DIALOGUE"],
        "悬念": ["SKILL_STORY_TENSION"],
        "太平淡": ["SKILL_STORY_TENSION"],
        "紧张感": ["SKILL_STORY_TENSION"],
    }
    
    for keyword, skill_keys in keyword_map.items():
        if keyword in user_input_lower:
            for skill in skills:
                if skill['template_key'] in skill_keys:
                    return skill
    
    return None


# 预加载缓存
_skills_cache = None

def get_all_skills_cached() -> List[Dict]:
    """获取所有 Skills（带缓存）"""
    global _skills_cache
    if _skills_cache is None:
        _skills_cache = load_skills()
    return _skills_cache

def refresh_skills_cache():
    """刷新 Skills 缓存"""
    global _skills_cache
    _skills_cache = load_skills()
    return _skills_cache


def _find_skill_dir(skill_key: str) -> Optional[str]:
    """根据 template_key 在两个目录中查找 Skill 目录"""
    skill_name = skill_key.replace("SKILL_", "").lower().replace("_", "-")
    
    # 优先查找持久化目录
    for base_dir in [PERSISTENT_SKILLS_DIR, SKILLS_DIR]:
        if not os.path.isdir(base_dir):
            continue
        # 先尝试目录名匹配
        candidate = os.path.join(base_dir, skill_name)
        if os.path.isdir(candidate):
            md_path = os.path.join(candidate, "SKILL.md")
            if os.path.isfile(md_path):
                return candidate
        # 再遍历匹配 name 字段
        for d in sorted(os.listdir(base_dir)):
            d_path = os.path.join(base_dir, d)
            if not os.path.isdir(d_path):
                continue
            md_path = os.path.join(d_path, "SKILL.md")
            if os.path.isfile(md_path):
                try:
                    with open(md_path, 'r', encoding='utf-8') as f:
                        meta = _parse_yaml_frontmatter(f.read())
                    if f"SKILL_{meta.get('name', '').upper().replace('-', '_')}" == skill_key:
                        return d_path
                except:
                    pass
    return None


def get_skill_detail(skill_key: str) -> Optional[Dict]:
    """根据 template_key 获取 Skill 完整详情（包括原始 SKILL.md 内容和独立 references）"""
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == skill_key:
            # 使用加载时记录的实际目录
            skill_dir = s.get("_skill_dir", "")
            if not skill_dir or not os.path.isdir(skill_dir):
                skill_dir = _find_skill_dir(skill_key)
            
            if not skill_dir:
                return {**s, "raw_content": "", "standalone_references": {}, "skill_dir": ""}

            # 读取原始 SKILL.md
            skill_md_path = os.path.join(skill_dir, "SKILL.md")
            raw_content = ""
            if os.path.isfile(skill_md_path):
                with open(skill_md_path, 'r', encoding='utf-8') as f:
                    raw_content = f.read()

            # 读取独立的 references（不拼接到 content 中）
            standalone_refs = {}
            refs_dir = os.path.join(skill_dir, "references")
            if os.path.isdir(refs_dir):
                for filename in sorted(os.listdir(refs_dir)):
                    if filename.endswith('.md'):
                        filepath = os.path.join(refs_dir, filename)
                        try:
                            with open(filepath, 'r', encoding='utf-8') as f:
                                standalone_refs[filename[:-3]] = f.read()
                        except:
                            pass

            return {
                **s,
                "raw_content": raw_content,
                "standalone_references": standalone_refs,
                "skill_dir": skill_dir,
            }
    return None


def _get_write_dir(dir_name: str) -> str:
    """获取 Skill 写入目录（始终写入持久化目录）"""
    os.makedirs(PERSISTENT_SKILLS_DIR, exist_ok=True)
    return os.path.join(PERSISTENT_SKILLS_DIR, dir_name)


def create_skill_files(name: str, description: str, body: str, references: Optional[Dict[str, str]] = None, skill_type: Optional[str] = None) -> Dict:
    """创建新的 Skill 文件（写入持久化目录）"""
    import re
    # 目录名：小写+短横线
    dir_name = name.lower().replace("_", "-").replace(" ", "-")
    dir_name = re.sub(r'[^a-z0-9\-]', '', dir_name)
    if not dir_name:
        dir_name = "new-skill"
    
    # 检查两个目录是否已存在同名 Skill
    for base_dir in [PERSISTENT_SKILLS_DIR, SKILLS_DIR]:
        existing = os.path.join(base_dir, dir_name)
        if os.path.exists(existing):
            raise ValueError(f"Skill 目录已存在: {dir_name}")
    
    skill_dir = _get_write_dir(dir_name)
    os.makedirs(skill_dir, exist_ok=True)
    
    # 如果未指定 skill_type，根据 name 自动推断
    if not skill_type:
        skill_type = infer_skill_type(name)
    
    # 创建 SKILL.md
    skill_type_line = f"\nskill_type: {skill_type}" if skill_type and skill_type != "generic" else ""
    skill_md_content = f"""---
name: {name}
description: |
  {description}{skill_type_line}
---

{body}"""
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(skill_md_content)
    
    # 创建 references
    if references:
        refs_dir = os.path.join(skill_dir, "references")
        os.makedirs(refs_dir, exist_ok=True)
        for ref_name, ref_content in references.items():
            ref_path = os.path.join(refs_dir, f"{ref_name}.md")
            with open(ref_path, 'w', encoding='utf-8') as f:
                f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回新建的 skill
    skills = get_all_skills_cached()
    for s in skills:
        if s["template_key"] == f"SKILL_{name.upper().replace('-', '_')}":
            return s
    return {"template_key": f"SKILL_{name.upper().replace('-', '_')}", "template_name": description.split('。')[0], "category": "Skill"}


def update_skill_files(skill_key: str, description: Optional[str] = None, body: Optional[str] = None, references: Optional[Dict[str, str]] = None, skill_type: Optional[str] = None) -> Dict:
    """更新已有 Skill 文件（如果是内置 Skill，先复制到持久化目录再修改）"""
    import shutil
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")
    
    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在: {skill_dir}")
    
    # 如果是内置 Skill（在 SKILLS_DIR 下），复制到持久化目录
    if skill_dir.startswith(os.path.abspath(SKILLS_DIR)):
        skill_dir_name = os.path.basename(skill_dir)
        persistent_dir = _get_write_dir(skill_dir_name)
        shutil.copytree(skill_dir, persistent_dir, dirs_exist_ok=True)
        skill_dir = persistent_dir
        logger.info(f"内置 Skill 已复制到持久化目录: {persistent_dir}")
    
    skill_md_path = os.path.join(skill_dir, "SKILL.md")
    
    # 读取现有内容
    with open(skill_md_path, 'r', encoding='utf-8') as f:
        raw = f.read()
    
    # 解析现有元数据
    metadata = _parse_yaml_frontmatter(raw)
    name = metadata.get('name', '')
    
    # 更新 SKILL.md
    final_desc = description if description is not None else metadata.get('description', '')
    final_body = body if body is not None else _get_skill_body(raw)
    # 如果未指定新 skill_type，保留原有的
    final_skill_type = skill_type if skill_type is not None else metadata.get('skill_type', '')
    
    skill_type_line = f"\nskill_type: {final_skill_type}" if final_skill_type and final_skill_type != "generic" else ""
    new_content = f"""---
name: {name}
description: |
  {final_desc}{skill_type_line}
---

{final_body}"""
    
    with open(skill_md_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    # 更新 references
    if references is not None:
        refs_dir = os.path.join(skill_dir, "references")
        # 删除旧的 reference 文件
        if os.path.isdir(refs_dir):
            for f in os.listdir(refs_dir):
                if f.endswith('.md'):
                    os.remove(os.path.join(refs_dir, f))
        else:
            os.makedirs(refs_dir, exist_ok=True)
        
        # 写入新的 references
        for ref_name, ref_content in references.items():
            if ref_content.strip():  # 只写入非空内容
                ref_path = os.path.join(refs_dir, f"{ref_name}.md")
                with open(ref_path, 'w', encoding='utf-8') as f:
                    f.write(ref_content)
    
    # 刷新缓存
    refresh_skills_cache()
    
    # 返回更新后的详情
    return get_skill_detail(skill_key) or {}


def delete_skill_files(skill_key: str) -> bool:
    """删除 Skill 目录"""
    import shutil
    detail = get_skill_detail(skill_key)
    if not detail:
        raise ValueError(f"未找到 Skill: {skill_key}")
    
    skill_dir = detail.get("skill_dir", "")
    if not skill_dir or not os.path.isdir(skill_dir):
        raise ValueError(f"Skill 目录不存在")
    
    shutil.rmtree(skill_dir)
    refresh_skills_cache()
    return True
