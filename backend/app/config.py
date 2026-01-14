"""应用配置管理"""
from pydantic_settings import BaseSettings
from typing import Optional
from pathlib import Path
import logging
import os

# 获取项目根目录(从backend/app/config.py向上两级)
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

# 配置模块使用标准logging（在logger.py初始化之前）
config_logger = logging.getLogger(__name__)

# 数据库配置：PostgreSQL
# 从环境变量获取数据库URL
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://mumuai:password@localhost:5432/mumuai_novel")

config_logger.debug(f"数据库类型: PostgreSQL")
config_logger.debug(f"数据库URL: {DATABASE_URL}")

class Settings(BaseSettings):
    """应用配置"""
    
    # 应用配置
    app_name: str = "MuMuAINovel"
    app_version: str = "1.2.8"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = True
    
    # 日志配置
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    log_to_file: bool = True  # 是否输出到文件
    log_file_path: str = str(PROJECT_ROOT / "logs" / "app.log")
    log_max_bytes: int = 10 * 1024 * 1024  # 10MB
    log_backup_count: int = 30  # 保留30个备份文件
    
    # CORS配置
    cors_origins: list[str] = ["http://localhost:8000", "http://127.0.0.1:8000"]
    
    # 数据库配置 - PostgreSQL
    database_url: str = DATABASE_URL
    
    # PostgreSQL连接池配置（优化后支持150-200并发用户）
    database_pool_size: int = 50  # 核心连接池大小（优化：从30提升到50）
    database_max_overflow: int = 30  # 最大溢出连接数（优化：从20提升到30）
    database_pool_timeout: int = 90  # 连接池超时秒数（优化：从60提升到90）
    database_pool_recycle: int = 1800  # 连接回收时间秒数（30分钟，防止长时间连接失效）
    database_pool_pre_ping: bool = True  # 连接前ping检测，确保连接有效
    database_pool_use_lifo: bool = True  # 使用LIFO策略提高连接复用率
    
    # 连接池高级配置
    database_echo_pool: bool = False  # 是否记录连接池日志（调试用）
    database_pool_reset_on_return: str = "rollback"  # 连接归还时的重置策略：rollback/commit/none
    database_max_identifier_length: int = 128  # PostgreSQL标识符最大长度
    
    # 会话监控配置
    database_session_max_active: int = 50  # 活跃会话警告阈值（从100降低到50）
    database_session_leak_threshold: int = 100  # 会话泄漏严重告警阈值
    
    # 数据库监控配置
    database_enable_slow_query_log: bool = True  # 启用慢查询日志
    database_slow_query_threshold: float = 1.0  # 慢查询阈值（秒）
    database_enable_metrics: bool = True  # 启用性能指标收集
    
    # AI服务配置
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    gemini_api_key: Optional[str] = None
    gemini_base_url: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_base_url: Optional[str] = None
    default_ai_provider: str = "openai"
    default_model: str = "gpt-4"
    default_temperature: float = 0.7
    default_max_tokens: int = 32000
    
    # MCP配置
    mcp_max_rounds: int = 3  # MCP工具调用最大轮数（全局统一控制）
    
    # LinuxDO OAuth2 配置
    LINUXDO_CLIENT_ID: Optional[str] = None
    LINUXDO_CLIENT_SECRET: Optional[str] = None
    # 回调地址：Docker部署时必须使用实际域名或服务器IP，不能使用localhost
    # 本地开发: http://localhost:8000/api/auth/callback
    # 生产环境: https://your-domain.com/api/auth/callback 或 http://your-ip:8000/api/auth/callback
    LINUXDO_REDIRECT_URI: Optional[str] = None
    
    # 前端URL配置（用于OAuth回调后重定向）
    # 本地开发: http://localhost:8000
    # 生产环境: https://your-domain.com 或 http://your-ip:8000
    FRONTEND_URL: str = "http://localhost:8000"
    
    # 初始管理员配置（LinuxDO user_id）
    INITIAL_ADMIN_LINUXDO_ID: Optional[str] = None
    
    # 本地账户登录配置
    LOCAL_AUTH_ENABLED: bool = True  # 是否启用本地账户登录
    LOCAL_AUTH_USERNAME: Optional[str] = None  # 本地登录用户名
    LOCAL_AUTH_PASSWORD: Optional[str] = None  # 本地登录密码
    LOCAL_AUTH_DISPLAY_NAME: str = "本地用户"  # 本地用户显示名称
    
    # 会话配置
    SESSION_EXPIRE_MINUTES: int = 120  # 会话过期时间（分钟），默认2小时
    SESSION_REFRESH_THRESHOLD_MINUTES: int = 30  # 会话刷新阈值（分钟），剩余时间少于此值时可刷新
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # 忽略未定义的环境变量，避免验证错误


# 创建全局配置实例
settings = Settings()
config_logger.info(f"配置加载完成: {settings.app_name} v{settings.app_version}")
config_logger.debug(f"调试模式: {settings.debug}")
config_logger.debug(f"AI提供商: {settings.default_ai_provider}")
