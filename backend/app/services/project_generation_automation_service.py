"""项目自动推进编排服务。"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.chapters import check_prerequisites, execute_batch_generation_in_order
from app.config import settings as config_settings
from app.database import get_engine
from app.logger import get_logger
from app.models.batch_generation_task import BatchGenerationTask
from app.models.chapter import Chapter
from app.models.character import Character
from app.models.mcp_plugin import MCPPlugin
from app.models.outline import Outline
from app.models.project import Project
from app.models.project_generation_schedule import ProjectGenerationSchedule
from app.models.settings import Settings
from app.services.ai_service import AIService, create_user_ai_service_with_mcp
from app.services.plot_expansion_service import PlotExpansionService
from app.services.prompt_service import PromptService

logger = get_logger(__name__)


class ProjectGenerationAutomationService:
    """项目自动推进编排服务。"""

    def calculate_next_run_at(self, cron_expr: str, timezone_name: str) -> datetime:
        """根据 Cron 表达式和时区计算下一次执行时间。

        Raises:
            ValueError: 时区或 Cron 表达式无效时抛出。
        """
        try:
            tzinfo = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("无效的时区配置") from exc

        now = datetime.now(tzinfo)
        try:
            next_run_at = croniter(cron_expr, now).get_next(datetime)
        except (ValueError, KeyError) as exc:
            raise ValueError("Cron 表达式无效") from exc

        next_run_at_utc = next_run_at.astimezone(timezone.utc)
        return next_run_at_utc.replace(tzinfo=None)

    async def _get_schedule(
        self,
        schedule_id: str,
        db: AsyncSession,
    ) -> ProjectGenerationSchedule | None:
        """获取自动推进计划。"""
        result = await db.execute(
            select(ProjectGenerationSchedule).where(ProjectGenerationSchedule.id == schedule_id)
        )
        return result.scalar_one_or_none()

    async def _get_active_batch_task(
        self,
        project_id: str,
        db: AsyncSession,
    ) -> BatchGenerationTask | None:
        """获取项目当前活跃的正文批量任务。"""
        result = await db.execute(
            select(BatchGenerationTask)
            .where(BatchGenerationTask.project_id == project_id)
            .where(BatchGenerationTask.status.in_(["pending", "running"]))
            .order_by(BatchGenerationTask.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _is_pending_content_chapter(chapter: Chapter) -> bool:
        """判断章节是否仍待生成正文。"""
        return not chapter.content or not chapter.content.strip()

    async def collect_project_generation_state(
        self,
        schedule: ProjectGenerationSchedule,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """收集项目当前自动推进所需状态。"""
        project_result = await db.execute(
            select(Project).where(Project.id == schedule.project_id)
        )
        project = project_result.scalar_one_or_none()
        if project is None:
            raise ValueError("项目不存在")

        outlines_result = await db.execute(
            select(Outline)
            .where(Outline.project_id == schedule.project_id)
            .order_by(Outline.order_index.asc(), Outline.created_at.asc())
        )
        outlines = outlines_result.scalars().all()

        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == schedule.project_id)
            .order_by(Chapter.chapter_number.asc(), Chapter.sub_index.asc(), Chapter.created_at.asc())
        )
        chapters = chapters_result.scalars().all()

        pending_content_chapters = [
            chapter for chapter in chapters if self._is_pending_content_chapter(chapter)
        ]

        existing_chapter_numbers = {chapter.chapter_number for chapter in chapters}
        outline_ids_with_chapters = {
            chapter.outline_id for chapter in chapters if chapter.outline_id
        }

        missing_one_to_one_outlines = [
            outline
            for outline in outlines
            if outline.order_index is not None and outline.order_index not in existing_chapter_numbers
        ]
        unexpanded_outlines = [
            outline for outline in outlines if outline.id not in outline_ids_with_chapters
        ]

        return {
            "project": project,
            "outlines": outlines,
            "chapters": chapters,
            "pending_content_chapters": pending_content_chapters,
            "missing_one_to_one_outlines": missing_one_to_one_outlines,
            "unexpanded_outlines": unexpanded_outlines,
            "active_batch_task": await self._get_active_batch_task(schedule.project_id, db),
        }

    async def _create_missing_one_to_one_chapters(
        self,
        project_id: str,
        outlines: list[Outline],
        chapters: list[Chapter],
        db: AsyncSession,
    ) -> list[Chapter]:
        """为 one-to-one 项目补齐缺失的章节记录。"""
        existing_numbers = {chapter.chapter_number for chapter in chapters}
        created_chapters: list[Chapter] = []

        for outline in outlines:
            if outline.order_index is None or outline.order_index in existing_numbers:
                continue

            chapter = Chapter(
                project_id=project_id,
                title=outline.title or f"第{outline.order_index}章",
                summary=outline.content or "",
                chapter_number=outline.order_index,
                sub_index=1,
                outline_id=None,
                status="pending",
                content="",
            )
            db.add(chapter)
            created_chapters.append(chapter)
            existing_numbers.add(outline.order_index)

        if created_chapters:
            await db.flush()
            for chapter in created_chapters:
                await db.refresh(chapter)

        return created_chapters

    async def _create_scheduled_batch_task(
        self,
        schedule: ProjectGenerationSchedule,
        chapters_to_generate: list[Chapter],
        db: AsyncSession,
    ) -> BatchGenerationTask:
        """创建由调度器触发的正文批量任务。"""
        batch_task = BatchGenerationTask(
            project_id=schedule.project_id,
            user_id=schedule.user_id,
            start_chapter_number=chapters_to_generate[0].chapter_number,
            chapter_count=len(chapters_to_generate),
            chapter_ids=[chapter.id for chapter in chapters_to_generate],
            style_id=None,
            target_word_count=schedule.target_word_count,
            enable_analysis=schedule.enable_analysis,
            enable_mcp=schedule.enable_mcp,
            model_name=schedule.model,
            trigger_source="schedule",
            schedule_id=schedule.id,
            max_retries=schedule.max_retries,
            status="pending",
            total_chapters=len(chapters_to_generate),
            completed_chapters=0,
            failed_chapters=[],
            current_retry_count=0,
        )
        db.add(batch_task)
        await db.flush()
        await db.refresh(batch_task)
        return batch_task

    @staticmethod
    def _build_characters_info(characters: list[Character]) -> str:
        """构建角色信息字符串。"""
        return "\n".join([
            f"- {char.name} ({'组织' if char.is_organization else '角色'}, {char.role_type}): "
            f"{char.personality[:100] if char.personality else '暂无描述'}"
            for char in characters
        ])

    @staticmethod
    def _serialize_outline_context(outline: Outline) -> str:
        """序列化单个大纲上下文。"""
        outline_text = f"\n第{outline.order_index}章《{outline.title}》"
        if not outline.structure:
            if outline.content:
                outline_text += f"\n  概要：{outline.content}"
            return outline_text

        try:
            structure_data = json.loads(outline.structure)
        except json.JSONDecodeError:
            if outline.content:
                outline_text += f"\n  概要：{outline.content}"
            return outline_text

        if structure_data.get("summary"):
            outline_text += f"\n  概要：{structure_data['summary']}"
        elif structure_data.get("content"):
            outline_text += f"\n  概要：{structure_data['content']}"

        if structure_data.get("key_points"):
            events = structure_data["key_points"]
            if isinstance(events, list):
                outline_text += f"\n  关键事件：{', '.join(events)}"
            else:
                outline_text += f"\n  关键事件：{events}"

        if structure_data.get("characters"):
            chars = structure_data["characters"]
            if isinstance(chars, list):
                char_names: list[str] = []
                org_names: list[str] = []
                for item in chars:
                    if isinstance(item, dict):
                        name = item.get("name", "")
                        if not name:
                            continue
                        if item.get("type") == "organization":
                            org_names.append(name)
                        else:
                            char_names.append(name)
                    elif isinstance(item, str):
                        char_names.append(item)
                if char_names:
                    outline_text += f"\n  重点角色：{', '.join(char_names)}"
                if org_names:
                    outline_text += f"\n  涉及组织：{', '.join(org_names)}"
            else:
                outline_text += f"\n  重点角色：{chars}"

        if structure_data.get("emotion"):
            outline_text += f"\n  情感基调：{structure_data['emotion']}"
        if structure_data.get("goal"):
            outline_text += f"\n  叙事目标：{structure_data['goal']}"

        return outline_text

    def _build_outline_continue_context(
        self,
        project: Project,
        latest_outlines: list[Outline],
        characters: list[Character],
    ) -> dict[str, Any]:
        """构建自动续写大纲所需上下文。"""
        recent_outlines = latest_outlines[-10:] if len(latest_outlines) > 10 else latest_outlines
        outline_texts = [f"【最近{len(recent_outlines)}章大纲详情】"] if recent_outlines else []
        for outline in recent_outlines:
            outline_texts.append(self._serialize_outline_context(outline))

        return {
            "recent_outlines": "\n".join(outline_texts),
            "characters_info": self._build_characters_info(characters) or "暂无角色信息",
        }

    async def _save_outlines(
        self,
        project_id: str,
        outline_data: list[dict[str, Any]],
        db: AsyncSession,
        start_index: int,
    ) -> list[Outline]:
        """保存自动生成的大纲。"""
        outlines: list[Outline] = []
        for idx, chapter_data in enumerate(outline_data):
            order_idx = chapter_data.get("chapter_number", start_index + idx)
            chapter_title = chapter_data.get("title", f"第{order_idx}章")
            chapter_content = chapter_data.get("summary") or chapter_data.get("content", "")
            outline = Outline(
                project_id=project_id,
                title=chapter_title,
                content=chapter_content,
                structure=json.dumps(chapter_data, ensure_ascii=False),
                order_index=order_idx,
            )
            db.add(outline)
            outlines.append(outline)

        await db.flush()
        for outline in outlines:
            await db.refresh(outline)
        return outlines

    @staticmethod
    def _build_all_chapters_brief(chapters: list[Chapter], outlines: list[Outline]) -> str:
        """构建所有章节的简要概览。"""
        if not chapters and not outlines:
            return "暂无章节"
        brief_parts: list[str] = []
        for chapter in chapters:
            summary = (chapter.summary or "")[:80]
            brief_parts.append(f"第{chapter.chapter_number}章《{chapter.title or '未命名'}》：{summary}")
        for outline in outlines:
            if outline.order_index is not None:
                content_brief = (outline.content or "")[:80]
                brief_parts.append(f"第{outline.order_index}章《{outline.title or '未命名'}》(大纲)：{content_brief}")
        return "\n".join(brief_parts) if brief_parts else "暂无章节"

    async def _generate_initial_outlines(
        self,
        schedule: ProjectGenerationSchedule,
        project: Project,
        db: AsyncSession,
    ) -> list[Outline]:
        """为无大纲项目生成首批大纲。"""
        ai_service = await self._build_user_ai_service(schedule.user_id, db)
        ai_service.enable_mcp = schedule.enable_mcp

        characters_result = await db.execute(
            select(Character).where(Character.project_id == project.id)
        )
        characters = characters_result.scalars().all()
        characters_info = self._build_characters_info(characters) or "暂无角色信息"

        chapter_count = max(schedule.outline_batch_size, 1)
        template = await PromptService.get_template("OUTLINE_CREATE", schedule.user_id, db)
        prompt = PromptService.format_prompt(
            template,
            title=project.title,
            theme=project.theme or "未设定",
            genre=project.genre or "通用",
            chapter_count=chapter_count,
            narrative_perspective=project.narrative_perspective or "第三人称",
            time_period=project.world_time_period or "未设定",
            location=project.world_location or "未设定",
            atmosphere=project.world_atmosphere or "未设定",
            rules=project.world_rules or "未设定",
            characters_info=characters_info,
            all_chapters_brief="暂无章节（首次生成）",
            existing_characters=characters_info,
            existing_organizations="暂无组织信息",
            requirements="",
            mcp_references="",
        )

        accumulated_text = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=prompt,
            provider=None,
            model=schedule.model,
        ):
            accumulated_text += chunk

        cleaned_text = AIService._clean_json_response(accumulated_text)
        parsed = json.loads(cleaned_text)
        if isinstance(parsed, list):
            outline_data = parsed
        elif isinstance(parsed, dict):
            outline_data = parsed.get("chapters") or parsed.get("data") or [parsed]
        else:
            outline_data = []

        outline_data = [
            item for item in outline_data
            if isinstance(item, dict) and (item.get("title") or item.get("summary") or item.get("content"))
        ]
        if not outline_data:
            raise ValueError("自动生成首批大纲失败：AI 未返回有效大纲数组")

        return await self._save_outlines(
            project_id=project.id,
            outline_data=outline_data,
            db=db,
            start_index=1,
        )

    async def _continue_project_outlines(
        self,
        schedule: ProjectGenerationSchedule,
        project: Project,
        outlines: list[Outline],
        db: AsyncSession,
    ) -> list[Outline]:
        """自动续写项目大纲。"""
        if not outlines:
            return []

        ai_service = await self._build_user_ai_service(schedule.user_id, db)
        ai_service.enable_mcp = schedule.enable_mcp

        characters_result = await db.execute(
            select(Character).where(Character.project_id == project.id)
        )
        characters = characters_result.scalars().all()
        context = self._build_outline_continue_context(project, outlines, characters)

        # 构建补充上下文
        chapters_result = await db.execute(
            select(Chapter).where(Chapter.project_id == project.id)
            .order_by(Chapter.chapter_number.asc(), Chapter.sub_index.asc())
        )
        all_chapters = chapters_result.scalars().all()
        all_chapters_brief = self._build_all_chapters_brief(all_chapters, outlines)

        org_characters = [c for c in characters if c.is_organization]
        person_characters = [c for c in characters if not c.is_organization]
        existing_organizations = "\n".join(
            [f"- {c.name}: {c.personality[:80] if c.personality else '暂无'}" for c in org_characters]
        ) if org_characters else "暂无组织信息"
        existing_characters = self._build_characters_info(person_characters) or "暂无角色信息"

        chapter_count = max(schedule.outline_batch_size, 1)
        last_chapter_number = outlines[-1].order_index or len(outlines)
        start_chapter = last_chapter_number + 1
        end_chapter = start_chapter + chapter_count - 1

        template = await PromptService.get_template("OUTLINE_CONTINUE", schedule.user_id, db)
        prompt = PromptService.format_prompt(
            template,
            title=project.title,
            theme=project.theme or "未设定",
            genre=project.genre or "通用",
            narrative_perspective=project.narrative_perspective or "第三人称",
            time_period=project.world_time_period or "未设定",
            location=project.world_location or "未设定",
            atmosphere=project.world_atmosphere or "未设定",
            rules=project.world_rules or "未设定",
            recent_outlines=context["recent_outlines"],
            characters_info=context["characters_info"],
            all_chapters_brief=all_chapters_brief,
            existing_characters=existing_characters,
            existing_organizations=existing_organizations,
            chapter_count=chapter_count,
            start_chapter=start_chapter,
            end_chapter=end_chapter,
            current_chapter_count=len(outlines),
            plot_stage_instruction="继续展开情节，深化角色关系，推进主线冲突",
            plot_stage="development",
            story_direction="自然延续",
            requirements="",
            mcp_references="",
        )

        accumulated_text = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=prompt,
            provider=None,
            model=schedule.model,
        ):
            accumulated_text += chunk

        cleaned_text = AIService._clean_json_response(accumulated_text)
        parsed = json.loads(cleaned_text)
        if isinstance(parsed, list):
            outline_data = parsed
        elif isinstance(parsed, dict):
            outline_data = parsed.get("chapters") or parsed.get("data") or [parsed]
        else:
            outline_data = []

        outline_data = [
            item for item in outline_data
            if isinstance(item, dict) and (item.get("title") or item.get("summary") or item.get("content"))
        ]
        if not outline_data:
            raise ValueError("自动续写大纲失败：AI 未返回有效大纲数组")

        return await self._save_outlines(
            project_id=project.id,
            outline_data=outline_data,
            db=db,
            start_index=start_chapter,
        )

    async def _expand_one_to_many_outlines(
        self,
        schedule: ProjectGenerationSchedule,
        project: Project,
        outlines: list[Outline],
        ai_service: AIService,
        db: AsyncSession,
    ) -> list[Chapter]:
        """为 one-to-many 项目补齐未展开大纲对应的章节。"""
        created_chapters: list[Chapter] = []
        expansion_service = PlotExpansionService(ai_service)
        outlines_to_expand = outlines[:schedule.outline_batch_size]

        for outline in outlines_to_expand:
            chapter_plans = await expansion_service.analyze_outline_for_chapters(
                outline=outline,
                project=project,
                db=db,
                target_chapter_count=schedule.chapters_per_outline,
                expansion_strategy=schedule.expansion_strategy,
                enable_scene_analysis=schedule.enable_scene_analysis,
                model=schedule.model,
            )
            created = await expansion_service.create_chapters_from_plans(
                outline_id=outline.id,
                chapter_plans=chapter_plans,
                project_id=project.id,
                db=db,
                start_chapter_number=None,
            )
            created_chapters.extend(created)

        created_chapters.sort(key=lambda chapter: (chapter.chapter_number, chapter.sub_index))
        return created_chapters

    async def _ensure_ready_chapters(
        self,
        schedule: ProjectGenerationSchedule,
        project: Project,
        state: dict[str, Any],
        db: AsyncSession,
    ) -> list[Chapter]:
        """根据项目模式补齐可写章节。"""
        pending_content_chapters = list(state["pending_content_chapters"])
        outlines = list(state["outlines"])
        chapters = list(state["chapters"])

        if project.outline_mode == "one-to-one":
            generated_initial_outlines = False
            if not outlines:
                new_outlines = await self._generate_initial_outlines(
                    schedule=schedule,
                    project=project,
                    db=db,
                )
                outlines.extend(new_outlines)
                generated_initial_outlines = bool(new_outlines)

            if (
                not generated_initial_outlines
                and not state["missing_one_to_one_outlines"]
                and not pending_content_chapters
            ):
                new_outlines = await self._continue_project_outlines(
                    schedule=schedule,
                    project=project,
                    outlines=outlines,
                    db=db,
                )
                outlines.extend(new_outlines)

            if any(outline.order_index is not None for outline in outlines):
                created_chapters = await self._create_missing_one_to_one_chapters(
                    project_id=project.id,
                    outlines=outlines,
                    chapters=chapters,
                    db=db,
                )
                pending_content_chapters.extend(created_chapters)

        if project.outline_mode == "one-to-many" and len(pending_content_chapters) < schedule.min_ready_chapters:
            if not outlines:
                new_outlines = await self._generate_initial_outlines(
                    schedule=schedule,
                    project=project,
                    db=db,
                )
                outlines.extend(new_outlines)
                state["unexpanded_outlines"] = list(new_outlines)
            elif not state["unexpanded_outlines"]:
                new_outlines = await self._continue_project_outlines(
                    schedule=schedule,
                    project=project,
                    outlines=outlines,
                    db=db,
                )
                outlines.extend(new_outlines)
                state["unexpanded_outlines"] = list(new_outlines)

            if state["unexpanded_outlines"]:
                ai_service = await self._build_user_ai_service(schedule.user_id, db)
                ai_service.enable_mcp = schedule.enable_mcp
                created_chapters = await self._expand_one_to_many_outlines(
                    schedule=schedule,
                    project=project,
                    outlines=state["unexpanded_outlines"],
                    ai_service=ai_service,
                    db=db,
                )
                pending_content_chapters.extend(created_chapters)

        pending_content_chapters.sort(key=lambda chapter: (chapter.chapter_number, chapter.sub_index))
        return pending_content_chapters

    def _resolve_pipeline_stage(
        self,
        project: Project,
        original_state: dict[str, Any],
        pending_content_chapters: list[Chapter],
    ) -> str:
        """根据本次推进动作推断流水线阶段。"""
        if project.outline_mode == "one-to-many":
            original_pending = len(original_state["pending_content_chapters"])
            if len(pending_content_chapters) > original_pending:
                return "expand"

        if project.outline_mode == "one-to-one":
            original_pending = len(original_state["pending_content_chapters"])
            if len(pending_content_chapters) > original_pending:
                return "chapter_create"

        return "content"

    def _select_chapters_for_generation(
        self,
        schedule: ProjectGenerationSchedule,
        pending_content_chapters: list[Chapter],
    ) -> list[Chapter]:
        """选取本轮需要生成正文的章节。"""
        return pending_content_chapters[:schedule.chapters_per_run]

    async def _prepare_generation_candidates(
        self,
        schedule: ProjectGenerationSchedule,
        project: Project,
        state: dict[str, Any],
        db: AsyncSession,
    ) -> list[Chapter]:
        """补齐结构后返回可用于正文生成的章节列表。"""
        return await self._ensure_ready_chapters(
            schedule=schedule,
            project=project,
            state=state,
            db=db,
        )

    def _has_expand_capacity(
        self,
        schedule: ProjectGenerationSchedule,
        state: dict[str, Any],
    ) -> bool:
        """判断 one-to-many 项目是否需要继续展开。"""
        return (
            bool(state["unexpanded_outlines"])
            and len(state["pending_content_chapters"]) < schedule.min_ready_chapters
        )

    def _resolve_no_pending_status(
        self,
        project: Project,
        state: dict[str, Any],
    ) -> tuple[str, Optional[str]]:
        """在无可写章节时给出状态和错误信息。"""
        if project.outline_mode == "one-to-many" and state["unexpanded_outlines"]:
            return "failed_expand", "存在待展开大纲，但未成功生成章节"
        return "skipped_no_pending", None

    async def _run_content_stage(
        self,
        schedule: ProjectGenerationSchedule,
        chapters_to_generate: list[Chapter],
        db: AsyncSession,
    ) -> str:
        """创建正文批量任务并返回任务 ID。"""
        batch_task = await self._create_scheduled_batch_task(
            schedule=schedule,
            chapters_to_generate=chapters_to_generate,
            db=db,
        )
        return batch_task.id

    def _build_default_settings_payload(self) -> dict[str, Any]:
        """构建默认 AI 设置。"""
        provider = config_settings.default_ai_provider
        if provider == "anthropic":
            api_key = config_settings.anthropic_api_key or config_settings.openai_api_key or ""
            api_base_url = (
                config_settings.anthropic_base_url or config_settings.openai_base_url or ""
            )
        else:
            api_key = config_settings.openai_api_key or config_settings.anthropic_api_key or ""
            api_base_url = (
                config_settings.openai_base_url or config_settings.anthropic_base_url or ""
            )

        return {
            "api_provider": provider,
            "api_key": api_key,
            "api_base_url": api_base_url,
            "llm_model": config_settings.default_model,
            "temperature": config_settings.default_temperature,
            "max_tokens": config_settings.default_max_tokens,
        }

    async def _build_user_ai_service(
        self,
        user_id: str,
        db: AsyncSession,
    ) -> AIService:
        """为后台调度任务构建 AI 服务实例。"""
        settings_result = await db.execute(
            select(Settings).where(Settings.user_id == user_id)
        )
        user_settings = settings_result.scalar_one_or_none()

        if user_settings is None:
            user_settings = Settings(user_id=user_id, **self._build_default_settings_payload())
            db.add(user_settings)
            await db.commit()
            await db.refresh(user_settings)

        mcp_result = await db.execute(
            select(MCPPlugin).where(MCPPlugin.user_id == user_id)
        )
        mcp_plugins = mcp_result.scalars().all()
        enable_mcp = any(plugin.enabled for plugin in mcp_plugins) if mcp_plugins else False

        return create_user_ai_service_with_mcp(
            api_provider=user_settings.api_provider,
            api_key=user_settings.api_key,
            api_base_url=user_settings.api_base_url or "",
            model_name=user_settings.llm_model,
            temperature=user_settings.temperature,
            max_tokens=user_settings.max_tokens,
            user_id=user_id,
            db_session=db,
            system_prompt=user_settings.system_prompt,
            enable_mcp=enable_mcp,
        )

    async def _execute_scheduled_batch_task(self, batch_id: str, user_id: str) -> None:
        """异步执行调度器创建的正文批量任务。"""
        db_session: Optional[AsyncSession] = None

        try:
            engine = await get_engine(user_id)
            session_factory = async_sessionmaker(
                engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
            db_session = session_factory()
            ai_service = await self._build_user_ai_service(user_id, db_session)
            await execute_batch_generation_in_order(
                batch_id=batch_id,
                user_id=user_id,
                ai_service=ai_service,
            )
        except Exception as exc:
            logger.error(
                "自动推进正文任务执行失败: batch_id=%s error=%s",
                batch_id,
                exc,
                exc_info=True,
            )
        finally:
            if db_session is not None:
                await db_session.close()

    async def run_project_automation(
        self,
        schedule_id: str,
        db: AsyncSession,
    ) -> ProjectGenerationSchedule | None:
        """执行一次项目自动推进。"""
        schedule = await self._get_schedule(schedule_id, db)
        if schedule is None:
            return None

        launched_batch_id: Optional[str] = None
        schedule.last_triggered_at = datetime.utcnow()
        schedule.last_error = None

        try:
            state = await self.collect_project_generation_state(schedule, db)
            project: Project = state["project"]
            active_batch_task: BatchGenerationTask | None = state["active_batch_task"]

            if active_batch_task is not None:
                schedule.last_pipeline_stage = "content"
                schedule.last_run_status = "skipped_conflict"
                schedule.last_error = None
                schedule.current_batch_task_id = active_batch_task.id
            else:
                pending_content_chapters = await self._prepare_generation_candidates(
                    schedule=schedule,
                    project=project,
                    state=state,
                    db=db,
                )

                if not pending_content_chapters:
                    status, error_message = self._resolve_no_pending_status(project, state)
                    schedule.last_pipeline_stage = "expand" if status == "failed_expand" else "skip"
                    schedule.last_run_status = status
                    schedule.last_error = error_message
                    schedule.current_batch_task_id = None
                else:
                    chapters_to_generate = self._select_chapters_for_generation(
                        schedule,
                        pending_content_chapters,
                    )
                    can_generate, error_msg, _ = await check_prerequisites(
                        db,
                        chapters_to_generate[0],
                    )

                    if not can_generate:
                        schedule.last_pipeline_stage = "content"
                        schedule.last_run_status = "failed_content"
                        schedule.last_error = error_msg
                        schedule.current_batch_task_id = None
                    else:
                        launched_batch_id = await self._run_content_stage(
                            schedule=schedule,
                            chapters_to_generate=chapters_to_generate,
                            db=db,
                        )
                        schedule.last_pipeline_stage = self._resolve_pipeline_stage(
                            project,
                            state,
                            pending_content_chapters,
                        )
                        schedule.last_run_status = "success"
                        schedule.last_error = None
                        schedule.current_batch_task_id = launched_batch_id

            schedule.next_run_at = self.calculate_next_run_at(
                schedule.cron_expr,
                schedule.timezone,
            )
            schedule.last_finished_at = datetime.utcnow()
            await db.commit()
            await db.refresh(schedule)
        except Exception as exc:
            logger.error(
                "项目自动推进执行失败: schedule_id=%s error=%s",
                schedule_id,
                exc,
                exc_info=True,
            )
            await db.rollback()

            schedule = await self._get_schedule(schedule_id, db)
            if schedule is None:
                return None

            schedule.last_pipeline_stage = schedule.last_pipeline_stage or "content"
            schedule.last_run_status = "failed_content"
            schedule.last_error = str(exc)
            schedule.current_batch_task_id = None
            try:
                schedule.next_run_at = self.calculate_next_run_at(
                    schedule.cron_expr,
                    schedule.timezone,
                )
            except ValueError:
                # Cron 表达式也出错时，延迟 1 小时后重试，避免永远卡住
                schedule.next_run_at = datetime.utcnow() + timedelta(hours=1)
                logger.warning(
                    "自动推进错误处理中 Cron 解析也失败，延迟 1 小时重试: schedule_id=%s",
                    schedule_id,
                )
            schedule.last_finished_at = datetime.utcnow()
            await db.commit()
            await db.refresh(schedule)
            return schedule

        if launched_batch_id is not None:
            asyncio.create_task(
                self._execute_scheduled_batch_task(launched_batch_id, schedule.user_id),
                name=f"project-automation-{launched_batch_id}",
            )
            logger.info(
                "项目自动推进已创建正文任务: schedule_id=%s batch_id=%s",
                schedule.id,
                launched_batch_id,
            )
        else:
            logger.info(
                "项目自动推进执行完成: schedule_id=%s status=%s",
                schedule.id,
                schedule.last_run_status,
            )

        return schedule


project_generation_automation_service = ProjectGenerationAutomationService()
