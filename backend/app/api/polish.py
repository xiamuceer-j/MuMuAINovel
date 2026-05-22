"""AI去味API - 核心特色功能"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.generation_history import GenerationHistory
from app.schemas.polish import PolishRequest, PolishResponse
from app.services.ai_service import AIService
from app.services.prompt_service import prompt_service, PromptService
from app.logger import get_logger
from app.api.settings import get_user_ai_service

router = APIRouter(prefix="/polish", tags=["AI去味"])
logger = get_logger(__name__)


@router.post("", response_model=PolishResponse, summary="AI去味")
async def polish_text(
    request: PolishRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    AI去味 - 将AI生成的文本改写得更像人类作家的手笔
    
    核心功能：
    - 去除AI痕迹（工整排比、重复修辞、机械总结）
    - 增加人性化（口语化、不完美细节、真实情感）
    - 优化叙事（自然节奏、简单词汇、松弛感）
    - 让对话更生活化
    
    这是本项目的核心特色功能！
    """
    try:
        # 获取用户ID
        user_id = getattr(http_request.state, 'user_id', None)
        
        # 获取自定义提示词模板
        template = await PromptService.get_template("AI_DENOISING", user_id, db)
        # 格式化提示词
        prompt = PromptService.format_prompt(
            template,
            original_text=request.original_text
        )
        
        logger.info(f"开始AI去味处理，原文长度: {len(request.original_text)}")
        
        # 调用AI进行去味处理
        polished_text = await user_ai_service.generate_text(
            prompt=prompt,
            provider=request.provider,
            model=request.model,
            temperature=request.temperature,
            max_tokens=len(request.original_text) * 2  # 预留足够token
        )
        
        # 计算字数
        word_count_before = len(request.original_text)
        word_count_after = len(polished_text)
        
        logger.info(f"AI去味完成，处理后长度: {word_count_after}")
        
        # 如果提供了项目ID，记录到历史
        if request.project_id:
            history = GenerationHistory(
                project_id=request.project_id,
                generation_type="polish",
                prompt=f"原文: {request.original_text[:100]}...",
                result=polished_text,
                provider=request.provider or "default",
                model=request.model or "default"
            )
            db.add(history)
            await db.commit()
        
        return PolishResponse(
            original_text=request.original_text,
            polished_text=polished_text,
            word_count_before=word_count_before,
            word_count_after=word_count_after
        )
        
    except Exception as e:
        logger.error(f"AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI去味失败: {str(e)}")


@router.post("/batch", summary="批量AI去味")
async def polish_batch(
    texts: list[str],
    project_id: int = None,
    provider: str = None,
    model: str = None,
    http_request: Request = None,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service)
):
    """
    批量处理多个文本的AI去味
    
    适用于一次性处理多个章节或段落
    """
    try:
        # 获取用户ID
        user_id = getattr(http_request.state, 'user_id', None) if http_request else None
        
        # 在循环外获取模板，避免重复查询数据库
        template = await PromptService.get_template("AI_DENOISING", user_id, db)
        
        results = []
        
        for idx, text in enumerate(texts):
            logger.info(f"处理第 {idx+1}/{len(texts)} 个文本")
            
            # 格式化提示词
            prompt = PromptService.format_prompt(template, original_text=text)
            
            polished_text = await user_ai_service.generate_text(
                prompt=prompt,
                provider=provider,
                model=model
            )
            
            results.append({
                "index": idx,
                "original": text,
                "polished": polished_text,
                "word_count_before": len(text),
                "word_count_after": len(polished_text)
            })
        
        logger.info(f"批量AI去味完成，共处理 {len(results)} 个文本")
        
        return {
            "total": len(results),
            "results": results
        }
        
    except Exception as e:
        logger.error(f"批量AI去味失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"批量AI去味失败: {str(e)}")