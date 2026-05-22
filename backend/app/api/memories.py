"""记忆管理API - 提供记忆的查询、分析等接口"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, delete
from typing import List, Optional
from app.database import get_db
from app.models.memory import StoryMemory, PlotAnalysis
from app.models.chapter import Chapter
from app.models.project import Project
from app.services.memory_service import memory_service
from app.services.plot_analyzer import get_plot_analyzer
from app.services.foreshadow_service import foreshadow_service
from app.services.ai_service import create_user_ai_service
from app.models.settings import Settings
from app.api.settings import resolve_runtime_ai_config
from app.logger import get_logger
from app.api.common import verify_project_access
import uuid

logger = get_logger(__name__)
router = APIRouter(prefix="/api/memories", tags=["memories"])


@router.post("/projects/{project_id}/analyze-chapter/{chapter_id}")
async def analyze_chapter(
    project_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    分析章节并生成记忆
    
    对指定章节进行剧情分析,提取钩子、伏笔、情节点等,并存入记忆系统
    """
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        # 获取章节内容
        result = await db.execute(
            select(Chapter).where(
                and_(
                    Chapter.id == chapter_id,
                    Chapter.project_id == project_id
                )
            )
        )
        chapter = result.scalar_one_or_none()
        
        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")
        
        if not chapter.content:
            raise HTTPException(status_code=400, detail="章节内容为空,无法分析")
        
        # 获取用户AI设置
        settings_result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = settings_result.scalar_one_or_none()
        
        if not settings:
            raise HTTPException(status_code=400, detail="请先配置AI设置")
        
        runtime_config = resolve_runtime_ai_config(settings.api_provider, settings.api_key, settings.api_base_url)

        # 创建AI服务
        ai_service = create_user_ai_service(
            api_provider=runtime_config["api_provider"],
            api_key=runtime_config["api_key"],
            api_base_url=runtime_config["api_base_url"],
            model_name=settings.llm_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens
        )
        
        # 获取已埋入的伏笔列表（用于回收匹配）
        existing_foreshadows = await foreshadow_service.get_planted_foreshadows_for_analysis(
            db=db,
            project_id=project_id
        )
        logger.info(f"📋 已获取{len(existing_foreshadows)}个已埋入伏笔用于分析匹配")
        
        # 执行剧情分析（传入已有伏笔列表）
        analyzer = get_plot_analyzer(ai_service)
        analysis_result = await analyzer.analyze_chapter(
            chapter_number=chapter.chapter_number,
            title=chapter.title,
            content=chapter.content,
            word_count=chapter.word_count or len(chapter.content),
            user_id=user_id,
            db=db,
            existing_foreshadows=existing_foreshadows
        )
        
        if not analysis_result:
            raise HTTPException(status_code=500, detail="剧情分析失败")
        
        # 保存分析结果到数据库
        plot_analysis = PlotAnalysis(
            id=str(uuid.uuid4()),
            project_id=project_id,
            chapter_id=chapter_id,
            plot_stage=analysis_result.get('plot_stage'),
            conflict_level=analysis_result.get('conflict', {}).get('level'),
            conflict_types=analysis_result.get('conflict', {}).get('types'),
            emotional_tone=analysis_result.get('emotional_arc', {}).get('primary_emotion'),
            emotional_intensity=analysis_result.get('emotional_arc', {}).get('intensity', 0) / 10,
            emotional_curve=analysis_result.get('emotional_arc'),
            hooks=analysis_result.get('hooks'),
            hooks_count=len(analysis_result.get('hooks', [])),
            hooks_avg_strength=sum(h.get('strength', 0) for h in analysis_result.get('hooks', [])) / max(len(analysis_result.get('hooks', [])), 1),
            foreshadows=analysis_result.get('foreshadows'),
            foreshadows_planted=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'planted'),
            foreshadows_resolved=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'resolved'),
            plot_points=analysis_result.get('plot_points'),
            plot_points_count=len(analysis_result.get('plot_points', [])),
            character_states=analysis_result.get('character_states'),
            scenes=analysis_result.get('scenes'),
            pacing=analysis_result.get('pacing'),
            dialogue_ratio=analysis_result.get('dialogue_ratio'),
            description_ratio=analysis_result.get('description_ratio'),
            overall_quality_score=analysis_result.get('scores', {}).get('overall'),
            pacing_score=analysis_result.get('scores', {}).get('pacing'),
            engagement_score=analysis_result.get('scores', {}).get('engagement'),
            coherence_score=analysis_result.get('scores', {}).get('coherence'),
            analysis_report=analyzer.generate_analysis_summary(analysis_result),
            suggestions=analysis_result.get('suggestions'),
            word_count=chapter.word_count
        )
        
        # 检查是否已存在分析记录，如有则删除
        existing_result = await db.execute(
            select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id)
        )
        existing_analysis = existing_result.scalar_one_or_none()
        if existing_analysis:
            await db.delete(existing_analysis)
            await db.flush()
        
        db.add(plot_analysis)
        await db.commit()
        
        # 从分析结果中提取记忆片段
        memories_data = analyzer.extract_memories_from_analysis(
            analysis_result,
            chapter_id,
            chapter.chapter_number
        )

        # 重新分析前，先清理该章节旧记忆（关系库 + 向量库）
        old_memories_result = await db.execute(
            select(StoryMemory).where(StoryMemory.chapter_id == chapter_id)
        )
        old_memories = old_memories_result.scalars().all()
        for old_mem in old_memories:
            await db.delete(old_mem)
        await db.flush()

        if user_id:
            try:
                await memory_service.delete_chapter_memories(
                    user_id=user_id,
                    project_id=project_id,
                    chapter_id=chapter_id
                )
            except Exception as vector_delete_error:
                logger.warning(f"⚠️ 清理章节向量记忆失败（继续分析）: {str(vector_delete_error)}")

        # 保存记忆到数据库和向量库
        saved_count = 0
        for mem_data in memories_data:
            memory_id = str(uuid.uuid4())

            # 保存到关系数据库
            memory = StoryMemory(
                id=memory_id,
                project_id=project_id,
                chapter_id=chapter_id,
                memory_type=mem_data['type'],
                title=mem_data.get('title', ''),
                content=mem_data['content'],
                story_timeline=chapter.chapter_number,
                vector_id=memory_id,
                **mem_data['metadata']
            )
            db.add(memory)

            # 保存到向量库
            await memory_service.add_memory(
                user_id=user_id,
                project_id=project_id,
                memory_id=memory_id,
                content=mem_data['content'],
                memory_type=mem_data['type'],
                metadata=mem_data['metadata']
            )
            saved_count += 1

        await db.commit()

        entity_changes = {
            "careers": {"updated_count": 0, "changes": []},
            "character_states": {
                "state_updated_count": 0,
                "relationship_created_count": 0,
                "relationship_updated_count": 0,
                "org_updated_count": 0,
                "changes": []
            },
            "organization_states": {"updated_count": 0, "changes": []}
        }

        # 更新角色职业 / 角色状态关系 / 组织状态
        if analysis_result.get('character_states'):
            try:
                from app.services.career_update_service import CareerUpdateService
                career_update_result = await CareerUpdateService.update_careers_from_analysis(
                    db=db,
                    project_id=project_id,
                    character_states=analysis_result.get('character_states', []),
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number
                )
                entity_changes["careers"] = career_update_result
            except Exception as career_error:
                logger.error(f"⚠️ 更新角色职业失败（不影响分析结果）: {str(career_error)}", exc_info=True)

            try:
                from app.services.character_state_update_service import CharacterStateUpdateService
                state_update_result = await CharacterStateUpdateService.update_from_analysis(
                    db=db,
                    project_id=project_id,
                    character_states=analysis_result.get('character_states', []),
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number
                )
                entity_changes["character_states"] = state_update_result
            except Exception as state_error:
                logger.error(f"⚠️ 更新角色状态、关系和组织成员失败（不影响分析结果）: {str(state_error)}", exc_info=True)

        if analysis_result.get('organization_states'):
            try:
                from app.services.character_state_update_service import CharacterStateUpdateService
                org_state_result = await CharacterStateUpdateService.update_organization_states(
                    db=db,
                    project_id=project_id,
                    organization_states=analysis_result.get('organization_states', []),
                    chapter_number=chapter.chapter_number
                )
                entity_changes["organization_states"] = org_state_result
            except Exception as org_state_error:
                logger.error(f"⚠️ 更新组织自身状态失败（不影响分析结果）: {str(org_state_error)}", exc_info=True)

        # 【新增】自动更新伏笔状态
        foreshadow_stats = {"planted_count": 0, "resolved_count": 0, "created_count": 0}
        analysis_foreshadows = analysis_result.get('foreshadows', [])

        if analysis_foreshadows:
            try:
                foreshadow_stats = await foreshadow_service.auto_update_from_analysis(
                    db=db,
                    project_id=project_id,
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number,
                    analysis_foreshadows=analysis_foreshadows
                )
                logger.info(f"📊 伏笔自动更新: 埋入{foreshadow_stats['planted_count']}个, 回收{foreshadow_stats['resolved_count']}个")
            except Exception as fs_error:
                logger.error(f"⚠️ 伏笔自动更新失败（不影响分析结果）: {str(fs_error)}")

        logger.info(f"✅ 章节分析完成: 保存{saved_count}条记忆")

        return {
            "success": True,
            "message": f"分析完成,提取了{saved_count}条记忆",
            "analysis": plot_analysis.to_dict(),
            "memories_count": saved_count,
            "foreshadow_stats": foreshadow_stats,
            "entity_changes": entity_changes
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 章节分析失败: {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.get("/projects/{project_id}/memories")
async def get_project_memories(
    project_id: str,
    request: Request,
    memory_type: Optional[str] = None,
    chapter_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """获取项目的记忆列表"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        # 构建查询
        query = select(StoryMemory).where(StoryMemory.project_id == project_id)
        
        if memory_type:
            query = query.where(StoryMemory.memory_type == memory_type)
        if chapter_id:
            query = query.where(StoryMemory.chapter_id == chapter_id)
        
        query = query.order_by(desc(StoryMemory.importance_score), desc(StoryMemory.created_at)).limit(limit)
        
        result = await db.execute(query)
        memories = result.scalars().all()
        
        return {
            "success": True,
            "memories": [mem.to_dict() for mem in memories],
            "total": len(memories)
        }
        
    except Exception as e:
        logger.error(f"❌ 获取记忆失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/analysis/{chapter_id}")
async def get_chapter_analysis(
    project_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """获取章节的剧情分析"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        result = await db.execute(
            select(PlotAnalysis).where(
                and_(
                    PlotAnalysis.project_id == project_id,
                    PlotAnalysis.chapter_id == chapter_id
                )
            )
        )
        analysis = result.scalar_one_or_none()
        
        if not analysis:
            raise HTTPException(status_code=404, detail="该章节还未进行分析")
        
        return {
            "success": True,
            "analysis": analysis.to_dict()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取分析失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/search")
async def search_memories(
    project_id: str,
    request: Request,
    query: str,
    memory_types: Optional[List[str]] = None,
    limit: int = 10,
    min_importance: float = 0.0,
    db: AsyncSession = Depends(get_db)
):
    """语义搜索项目记忆"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        memories = await memory_service.search_memories(
            user_id=user_id,
            project_id=project_id,
            query=query,
            memory_types=memory_types,
            limit=limit,
            min_importance=min_importance
        )
        
        return {
            "success": True,
            "query": query,
            "memories": memories,
            "total": len(memories)
        }
        
    except Exception as e:
        logger.error(f"❌ 搜索记忆失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/foreshadows")
async def get_unresolved_foreshadows(
    project_id: str,
    request: Request,
    current_chapter: int,
    db: AsyncSession = Depends(get_db)
):
    """获取未完结的伏笔"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        # 从向量库搜索
        foreshadows = await memory_service.find_unresolved_foreshadows(
            user_id=user_id,
            project_id=project_id,
            current_chapter=current_chapter
        )
        
        return {
            "success": True,
            "foreshadows": foreshadows,
            "total": len(foreshadows)
        }
        
    except Exception as e:
        logger.error(f"❌ 获取伏笔失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/stats")
async def get_memory_stats(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """获取记忆统计信息"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        stats = await memory_service.get_memory_stats(
            user_id=user_id,
            project_id=project_id
        )
        
        return {
            "success": True,
            "stats": stats
        }
        
    except Exception as e:
        logger.error(f"❌ 获取统计失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/{project_id}/chapters/{chapter_id}/memories")
async def delete_chapter_memories(
    project_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """删除章节的所有记忆"""
    try:
        user_id = getattr(request.state, 'user_id', None)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        
        # 从数据库删除
        result = await db.execute(
            select(StoryMemory).where(
                and_(
                    StoryMemory.project_id == project_id,
                    StoryMemory.chapter_id == chapter_id
                )
            )
        )
        memories = result.scalars().all()
        
        for memory in memories:
            await db.delete(memory)
        
        # 从向量库删除
        await memory_service.delete_chapter_memories(
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id
        )
        
        await db.commit()
        
        return {
            "success": True,
            "message": f"已删除{len(memories)}条记忆"
        }
        
    except Exception as e:
        logger.error(f"❌ 删除记忆失败: {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))