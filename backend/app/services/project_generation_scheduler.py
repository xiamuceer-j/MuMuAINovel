"""项目自动推进调度器。"""
from __future__ import annotations

import asyncio
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings as config_settings
from app.database import get_engine
from app.logger import get_logger
from app.models.project_generation_schedule import ProjectGenerationSchedule
from app.services.project_generation_automation_service import project_generation_automation_service

logger = get_logger(__name__)

_scheduler_task: asyncio.Task | None = None


async def _create_session() -> AsyncSession:
    """创建调度器使用的数据库会话。"""
    engine = await get_engine("system")
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return session_factory()


async def _scheduler_loop(interval_seconds: int = 30) -> None:
    """后台轮询到期的项目自动推进计划。

    PostgreSQL 环境使用 SELECT ... FOR UPDATE SKIP LOCKED 防止多实例重复触发。
    SQLite 环境退化为普通查询（单实例部署场景）。
    """
    is_postgres = "postgresql" in config_settings.database_url.lower()

    while True:
        try:
            async with await _create_session() as db:
                now = datetime.utcnow()
                query = (
                    select(ProjectGenerationSchedule)
                    .where(
                        ProjectGenerationSchedule.enabled.is_(True),
                        ProjectGenerationSchedule.next_run_at.is_not(None),
                        ProjectGenerationSchedule.next_run_at <= now,
                    )
                    .order_by(ProjectGenerationSchedule.next_run_at.asc())
                )
                if is_postgres:
                    query = query.with_for_update(skip_locked=True)

                if is_postgres:
                    async with db.begin():
                        result = await db.execute(query)
                        schedules = result.scalars().all()
                        for schedule in schedules:
                            try:
                                await project_generation_automation_service.run_project_automation(
                                    schedule.id, db
                                )
                            except Exception as exc:
                                logger.error(
                                    "项目自动推进执行失败: schedule_id=%s error=%s",
                                    schedule.id,
                                    exc,
                                    exc_info=True,
                                )
                else:
                    # SQLite：不做行锁，直接查询执行
                    result = await db.execute(query)
                    schedules = result.scalars().all()
                    for schedule in schedules:
                        try:
                            await project_generation_automation_service.run_project_automation(
                                schedule.id, db
                            )
                        except Exception as exc:
                            logger.error(
                                "项目自动推进执行失败: schedule_id=%s error=%s",
                                schedule.id,
                                exc,
                                exc_info=True,
                            )

            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            logger.info("项目自动推进调度器已停止")
            raise
        except Exception as exc:
            logger.error("项目自动推进调度器异常: %s", exc, exc_info=True)
            await asyncio.sleep(interval_seconds)


def start_project_generation_scheduler() -> None:
    """启动项目自动推进调度器。"""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        return
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("项目自动推进调度器已启动")


async def stop_project_generation_scheduler() -> None:
    """停止项目自动推进调度器。"""
    global _scheduler_task
    if _scheduler_task is None:
        return
    _scheduler_task.cancel()
    try:
        await _scheduler_task
    except asyncio.CancelledError:
        pass
    _scheduler_task = None
