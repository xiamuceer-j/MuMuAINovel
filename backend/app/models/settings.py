"""设置数据模型"""
from sqlalchemy import Column, String, Text, Float, Integer, DateTime, Boolean, Index
from sqlalchemy.sql import func
from app.database import Base
import uuid


class Settings(Base):
    """设置表"""
    __tablename__ = "settings"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(50), nullable=False, unique=True, index=True, comment="用户ID")
    api_provider = Column(String(50), default="openai", comment="API提供商")
    api_key = Column(String(500), comment="API密钥")
    api_base_url = Column(String(500), comment="自定义API地址")
    llm_model = Column(String(100), default="gpt-4", comment="模型名称")
    temperature = Column(Float, default=0.7, comment="温度参数")
    max_tokens = Column(Integer, default=2000, comment="最大token数")
    system_prompt = Column(Text, comment="系统级别提示词，每次AI调用都会使用")
    disable_thinking = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否关闭模型思考（vLLM等自部署思考模型，注入 enable_thinking=false）")

    # 封面图片生成配置
    cover_api_provider = Column(String(50), comment="封面图片API提供商")
    cover_api_key = Column(String(500), comment="封面图片API密钥")
    cover_api_base_url = Column(String(500), comment="封面图片自定义API地址")
    cover_image_model = Column(String(100), comment="封面图片模型名称")
    cover_enabled = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用封面图片生成")

    # 系统级 SMTP 配置（仅管理员维护）
    smtp_provider = Column(String(50), default="qq", server_default="qq", nullable=False, comment="SMTP 提供商")
    smtp_host = Column(String(255), comment="SMTP 主机")
    smtp_port = Column(Integer, default=465, server_default="465", nullable=False, comment="SMTP 端口")
    smtp_username = Column(String(255), comment="SMTP 用户名")
    smtp_password = Column(String(500), comment="SMTP 密码或授权码")
    smtp_use_tls = Column(Boolean, default=False, server_default="0", nullable=False, comment="是否启用 TLS")
    smtp_use_ssl = Column(Boolean, default=True, server_default="1", nullable=False, comment="是否启用 SSL")
    smtp_from_email = Column(String(255), comment="发件人邮箱")
    smtp_from_name = Column(String(255), default="MuMuAINovel", server_default="MuMuAINovel", nullable=False, comment="发件人名称")
    email_auth_enabled = Column(Boolean, default=True, server_default="1", nullable=False, comment="是否启用邮箱认证")
    email_register_enabled = Column(Boolean, default=True, server_default="1", nullable=False, comment="是否启用邮箱注册")
    verification_code_ttl_minutes = Column(Integer, default=10, server_default="10", nullable=False, comment="验证码有效期（分钟）")
    verification_resend_interval_seconds = Column(Integer, default=60, server_default="60", nullable=False, comment="验证码重发间隔（秒）")

    preferences = Column(Text, comment="其他偏好设置(JSON)")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    
    __table_args__ = (
        Index('idx_user_id', 'user_id'),
    )
    
    def __repr__(self):
        return f"<Settings(id={self.id}, user_id={self.user_id}, api_provider={self.api_provider})>"
