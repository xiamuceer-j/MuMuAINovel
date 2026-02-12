from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple, List
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import PROJECT_ROOT
from app.models.skill_spec import SkillSpec


@dataclass
class ParsedSkill:
    skill_key: str
    name: str
    description: Optional[str]
    allowed_tools: Optional[str]
    api_provider_override: Optional[str]
    model_override: Optional[str]
    temperature_override: Optional[str]
    max_tokens_override: Optional[str]
    content: str
    source_path: str


def get_repo_root() -> Path:
    # 开发环境：PROJECT_ROOT 指向 backend/，repo 根目录在其上一级
    # 容器环境：PROJECT_ROOT 通常就是 /app（已将 .opencode/skills 复制到 /app/.opencode/skills）
    candidates = [PROJECT_ROOT, PROJECT_ROOT.parent]
    for c in candidates:
        if (c / ".opencode" / "skills").is_dir():
            return c
    return PROJECT_ROOT.parent


def get_skills_root() -> Path:
    return get_repo_root() / ".opencode" / "skills"


def _strip_quotes(value: str) -> str:
    v = value.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v


def parse_skill_md(text: str, source_path: str) -> ParsedSkill:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md 缺少 YAML frontmatter 起始标记 ---")

    frontmatter: Dict[str, str] = {}
    i = 1
    while i < len(lines):
        line = lines[i]
        if line.strip() == "---":
            i += 1
            break
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, raw = line.split(":", 1)
        frontmatter[key.strip()] = _strip_quotes(raw.strip())
        i += 1

    name = frontmatter.get("name")
    if not name:
        raise ValueError("SKILL.md frontmatter 缺少 name")

    description = frontmatter.get("description")
    allowed_tools = frontmatter.get("allowed-tools")
    api_provider_override = frontmatter.get("provider-override")
    model_override = frontmatter.get("model-override")
    temperature_override = frontmatter.get("temperature-override")
    max_tokens_override = frontmatter.get("max-tokens-override")
    content = "\n".join(lines[i:]).strip()
    if not content:
        raise ValueError("SKILL.md 内容为空")

    return ParsedSkill(
        skill_key=name,
        name=name,
        description=description,
        allowed_tools=allowed_tools,
        api_provider_override=api_provider_override,
        model_override=model_override,
        temperature_override=temperature_override,
        max_tokens_override=max_tokens_override,
        content=content,
        source_path=source_path,
    )


def discover_skill_files(skills_root: Path) -> List[Path]:
    if not skills_root.exists() or not skills_root.is_dir():
        return []
    return sorted([p for p in skills_root.glob("*/SKILL.md") if p.is_file()])


async def upsert_builtin_skills(db: AsyncSession) -> Tuple[int, int, int, int, List[str]]:
    skills_root = get_skills_root()
    files = discover_skill_files(skills_root)

    discovered = len(files)
    upserted = 0
    skipped = 0
    errors = 0
    error_messages: List[str] = []

    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
            parsed = parse_skill_md(text, source_path=str(f.relative_to(get_repo_root())))

            result = await db.execute(select(SkillSpec).where(SkillSpec.skill_key == parsed.skill_key))
            row = result.scalar_one_or_none()
            if row:
                row.name = parsed.name
                row.description = parsed.description
                row.allowed_tools = parsed.allowed_tools
                row.api_provider_override = parsed.api_provider_override
                row.model_override = parsed.model_override
                row.temperature_override = parsed.temperature_override
                row.max_tokens_override = parsed.max_tokens_override
                row.content = parsed.content
                row.source_path = parsed.source_path
                row.is_builtin = True
            else:
                row = SkillSpec(
                    skill_key=parsed.skill_key,
                    name=parsed.name,
                    description=parsed.description,
                    allowed_tools=parsed.allowed_tools,
                    api_provider_override=parsed.api_provider_override,
                    model_override=parsed.model_override,
                    temperature_override=parsed.temperature_override,
                    max_tokens_override=parsed.max_tokens_override,
                    content=parsed.content,
                    source_path=parsed.source_path,
                    is_builtin=True,
                )
                db.add(row)
            upserted += 1
        except Exception as e:
            errors += 1
            error_messages.append(f"{f}: {e}")
            skipped += 1

    await db.commit()
    return discovered, upserted, skipped, errors, error_messages


def parse_preferences(preferences: Optional[str]) -> Dict[str, object]:
    if not preferences:
        return {}
    try:
        return json.loads(preferences)
    except Exception:
        return {}


def dump_preferences(prefs: Dict[str, object]) -> str:
    return json.dumps(prefs, ensure_ascii=False)
