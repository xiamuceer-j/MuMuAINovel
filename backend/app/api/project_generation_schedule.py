"""项目自动推进计划 API"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.project import Project
from app.models.project_generation_schedule import ProjectGenerationSchedule
from app.schemas.project_generation_schedule import (
    ProjectGenerationScheduleResponse,
    ProjectGenerationScheduleUpdate,
)
from app.services.project_generation_automation_service import project_generation_automation_service

router = APIRouter(prefix="/project-automation", tags=["项目自动推进"])


def _get_current_user_id(request: Request) -> str:
    """从请求上下文中获取当前用户 ID。"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id


async def _get_project(project_id: str, user_id: str, db: AsyncSession) -> Project:
    """获取当前用户有权访问的项目。"""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


async def _get_schedule_by_project_id(
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> ProjectGenerationSchedule | None:
    """按项目 ID 获取自动推进计划。"""
    result = await db.execute(
        select(ProjectGenerationSchedule).where(
            ProjectGenerationSchedule.project_id == project_id,
            ProjectGenerationSchedule.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


def _serialize_schedule(
    schedule: ProjectGenerationSchedule,
    outline_mode: str,
) -> ProjectGenerationScheduleResponse:
    """序列化自动推进计划响应。"""
    return ProjectGenerationScheduleResponse(
        **{
            **ProjectGenerationScheduleResponse.model_validate(schedule).model_dump(),
            "outline_mode": outline_mode,
        }
    )


@router.get("/{project_id}", response_model=ProjectGenerationScheduleResponse, summary="获取项目自动推进计划")
async def get_project_generation_schedule(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ProjectGenerationScheduleResponse:
    user_id = _get_current_user_id(request)
    project = await _get_project(project_id, user_id, db)
    outline_mode = project.outline_mode
    schedule = await _get_schedule_by_project_id(project_id, user_id, db)
    if not schedule:
        raise HTTPException(status_code=404, detail="自动推进计划不存在")
    return _serialize_schedule(schedule, outline_mode)


@router.put("/{project_id}", response_model=ProjectGenerationScheduleResponse, summary="创建或更新项目自动推进计划")
async def save_project_generation_schedule(
    project_id: str,
    payload: ProjectGenerationScheduleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ProjectGenerationScheduleResponse:
    user_id = _get_current_user_id(request)
    project = await _get_project(project_id, user_id, db)
    outline_mode = project.outline_mode
    schedule = await _get_schedule_by_project_id(project_id, user_id, db)

    data = payload.model_dump()
    model_name = (data.get("model") or "").strip()
    data["model"] = model_name or None
    try:
        data["next_run_at"] = project_generation_automation_service.calculate_next_run_at(
            data["cron_expr"], data["timezone"]
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if schedule is None:
        schedule = ProjectGenerationSchedule(project_id=project_id, user_id=user_id, **data)
        db.add(schedule)
    else:
        for field, value in data.items():
            setattr(schedule, field, value)

    await db.commit()
    await db.refresh(schedule)
    return _serialize_schedule(schedule, outline_mode)


@router.post("/{project_id}/trigger", response_model=ProjectGenerationScheduleResponse, summary="立即执行一次项目自动推进")
async def trigger_project_generation_schedule(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ProjectGenerationScheduleResponse:
    user_id = _get_current_user_id(request)
    project = await _get_project(project_id, user_id, db)
    schedule = await _get_schedule_by_project_id(project_id, user_id, db)
    if not schedule:
        raise HTTPException(status_code=404, detail="自动推进计划不存在")

    outline_mode = project.outline_mode
    refreshed_schedule = await project_generation_automation_service.run_project_automation(schedule.id, db)
    if refreshed_schedule is None:
        raise HTTPException(status_code=404, detail="自动推进计划不存在")

    return _serialize_schedule(refreshed_schedule, outline_mode)


@router.delete("/{project_id}", summary="删除项目自动推进计划")
async def delete_project_generation_schedule(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user_id = _get_current_user_id(request)
    await _get_project(project_id, user_id, db)
    schedule = await _get_schedule_by_project_id(project_id, user_id, db)
    if not schedule:
        raise HTTPException(status_code=404, detail="自动推进计划不存在")

    await db.delete(schedule)
    await db.commit()
    return {"message": "项目自动推进计划已删除", "project_id": project_id}
