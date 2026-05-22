"""FastAPI应用主入口"""
from fastapi import FastAPI, Request, status, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.exceptions import RequestValidationError
from contextlib import asynccontextmanager
from pathlib import Path

from app.config import settings as config_settings
from app.database import close_db, _session_stats
from app.logger import setup_logging, get_logger
from app.middleware import RequestIDMiddleware
from app.middleware.auth_middleware import AuthMiddleware
from app.mcp import mcp_client, register_status_sync

setup_logging(
    level=config_settings.log_level,
    log_to_file=config_settings.log_to_file,
    log_file_path=config_settings.log_file_path,
    max_bytes=config_settings.log_max_bytes,
    backup_count=config_settings.log_backup_count
)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 注册MCP状态同步服务
    register_status_sync()

    # 安全保障：确保后台任务表存在（兼容未执行Alembic迁移的旧部署）
    try:
        from app.database import get_engine
        from app.models.background_task import BackgroundTask
        _startup_engine = await get_engine("system")
        async with _startup_engine.begin() as conn:
            # 仅创建 background_tasks 表（如果不存在），不影响其他表
            await conn.run_sync(
                lambda sync_conn: BackgroundTask.__table__.create(sync_conn, checkfirst=True)
            )
        logger.info("后台任务表检查完成")
    except Exception as e:
        logger.warning(f"后台任务表检查失败（不影响启动）: {e}")

    logger.info("应用启动完成")
    
    yield
    
    # 清理MCP插件
    await mcp_client.cleanup()
    
    # 清理HTTP客户端池
    from app.services.ai_service import cleanup_http_clients
    await cleanup_http_clients()
    
    # 关闭数据库连接
    await close_db()
    
    logger.info("应用已关闭")


app = FastAPI(
    title=config_settings.app_name,
    version=config_settings.app_version,
    description="AI写小说工具 - 智能小说创作助手",
    lifespan=lifespan
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求验证错误"""
    logger.error(f"请求验证失败: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "请求参数验证失败",
            "errors": exc.errors()
        }
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """处理所有未捕获的异常"""
    logger.error(f"未处理的异常: {type(exc).__name__}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "服务器内部错误",
            "message": str(exc) if config_settings.debug else "请稍后重试"
        }
    )

app.add_middleware(RequestIDMiddleware)
app.add_middleware(AuthMiddleware)

if config_settings.debug:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}


@app.get("/health/db-sessions")
async def db_session_stats(request: Request):
    """
    数据库会话统计（监控连接泄漏）
    
    返回：
    - created: 总创建会话数
    - closed: 总关闭会话数
    - active: 当前活跃会话数（应该接近0）
    - errors: 错误次数
    - generator_exits: SSE断开次数
    - last_check: 最后检查时间
    """
    if not getattr(request.state, "is_admin", False):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return {
        "status": "ok",
        "session_stats": _session_stats,
        "warning": "活跃会话数过多" if _session_stats["active"] > 10 else None
    }


from app.api import (
    projects, outlines, characters, chapters,
    wizard_stream, relationships, organizations,
    auth, users, settings, writing_styles, memories,
    mcp_plugins, admin, inspiration, prompt_templates,
    changelog, careers, foreshadows, prompt_workshop, book_import,
    project_covers, tasks, announcements
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

app.include_router(projects.router, prefix="/api")
app.include_router(project_covers.router, prefix="/api")
app.include_router(wizard_stream.router, prefix="/api")
app.include_router(inspiration.router, prefix="/api")
app.include_router(outlines.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(careers.router, prefix="/api")  # 职业管理API
app.include_router(chapters.router, prefix="/api")
app.include_router(relationships.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(writing_styles.router, prefix="/api")
app.include_router(memories.router)  # 记忆管理API (已包含/api前缀)
app.include_router(foreshadows.router)  # 伏笔管理API (已包含/api前缀)
app.include_router(mcp_plugins.router, prefix="/api")  # MCP插件管理API
app.include_router(prompt_templates.router, prefix="/api")  # 提示词模板管理API
app.include_router(changelog.router, prefix="/api")  # 更新日志API
app.include_router(prompt_workshop.router, prefix="/api")  # 提示词工坊API
app.include_router(book_import.router, prefix="/api")  # 拆书导入API
app.include_router(tasks.router, prefix="/api")  # 后台任务API
app.include_router(announcements.router, prefix="/api")  # 公告API

static_dir = Path(__file__).parent.parent / "static"
generated_assets_root_dir = Path(__file__).parent.parent / "storage"
generated_covers_dir = generated_assets_root_dir / "generated_covers"
generated_covers_dir.mkdir(parents=True, exist_ok=True)
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")
    app.mount("/generated-assets/covers", StaticFiles(directory=str(generated_covers_dir)), name="generated-covers")
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """服务单页应用，所有非API路径返回index.html"""
        if full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"detail": "API路径不存在"}
            )
        
        file_path = static_dir / full_path
        try:
            resolved_file = file_path.resolve()
            resolved_static = static_dir.resolve()
            resolved_file.relative_to(resolved_static)
        except ValueError:
            return JSONResponse(
                status_code=404,
                content={"detail": "页面不存在"}
            )

        if resolved_file.is_file():
            return FileResponse(resolved_file)
        
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        
        return JSONResponse(
            status_code=404,
            content={"detail": "页面不存在"}
        )
else:
    logger.warning("静态文件目录不存在，请先构建前端: cd frontend && npm run build")
    
    @app.get("/")
    async def root():
        return {
            "message": "欢迎使用MuMuAINovel",
            "version": config_settings.app_version,
            "docs": "/docs",
            "notice": "请先构建前端: cd frontend && npm run build"
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=config_settings.app_host,
        port=config_settings.app_port,
        reload=config_settings.debug
    )
