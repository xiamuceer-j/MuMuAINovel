"""FastAPI应用主入口"""
from fastapi import FastAPI, Request, status
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
from app.mcp import mcp_client, register_status_sync, mumu_mcp_server, MCP_SERVER_AVAILABLE

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

    # 启动 MuMu 对外 MCP Server（streamable-http 会话管理）
    mcp_server_ctx = None
    if MCP_SERVER_AVAILABLE and mumu_mcp_server is not None:
        try:
            session_manager = getattr(mumu_mcp_server, "session_manager", None)
            if session_manager and hasattr(session_manager, "run"):
                mcp_server_ctx = session_manager.run()
                await mcp_server_ctx.__aenter__()
                logger.info("✅ MuMu MCP Server 会话管理已启动")
            else:
                logger.warning("⚠️ MuMu MCP Server 未发现 session_manager.run()，跳过会话管理启动")
        except Exception as e:
            logger.error(f"❌ MuMu MCP Server 启动失败（将继续启动主应用）: {e}", exc_info=True)
    
    logger.info("应用启动完成")
    
    yield
    
    # 清理MCP插件
    await mcp_client.cleanup()

    # 清理 MuMu MCP Server 会话管理
    if mcp_server_ctx is not None:
        try:
            await mcp_server_ctx.__aexit__(None, None, None)
            logger.info("✅ MuMu MCP Server 会话管理已关闭")
        except Exception as e:
            logger.warning(f"⚠️ MuMu MCP Server 会话管理关闭失败: {e}")
    
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

# 挂载 MuMu 对外 MCP Server
if MCP_SERVER_AVAILABLE and mumu_mcp_server is not None:
    try:
        mcp_asgi_app = None
        if hasattr(mumu_mcp_server, "streamable_http_app"):
            mcp_asgi_app = mumu_mcp_server.streamable_http_app()
        elif hasattr(mumu_mcp_server, "http_app"):
            mcp_asgi_app = mumu_mcp_server.http_app()

        if mcp_asgi_app is not None:
            # 注意：如果 SDK 默认 path=/mcp，则最终访问路径为 /mcp/mcp
            app.mount("/mcp", mcp_asgi_app)
            logger.info("✅ MuMu MCP Server 已挂载，入口: /mcp（通常客户端连接 /mcp/mcp）")
        else:
            logger.warning("⚠️ 未找到可挂载的 MCP ASGI app（streamable_http_app/http_app）")
    except Exception as e:
        logger.error(f"❌ 挂载 MuMu MCP Server 失败: {e}", exc_info=True)
else:
    logger.warning("⚠️ MCP Server 依赖不可用，已跳过 /mcp 挂载")

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
async def db_session_stats():
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
    changelog, careers, foreshadows, prompt_workshop
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

app.include_router(projects.router, prefix="/api")
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

static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """服务单页应用，所有非API路径返回index.html"""
        if full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"detail": "API路径不存在"}
            )
        
        # 路径穿越防护：防止通过 ../ 读取 static_dir 之外的任意文件
        file_path = (static_dir / full_path).resolve()
        if not file_path.as_posix().startswith(static_dir.resolve().as_posix() + "/") and file_path.as_posix() != static_dir.resolve().as_posix():
            return JSONResponse(
                status_code=404,
                content={"detail": "页面不存在"}
            )
        if file_path.is_file():
            return FileResponse(file_path)
        
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
