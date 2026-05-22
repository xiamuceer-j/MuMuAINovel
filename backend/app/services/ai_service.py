"""AI服务封装 - 统一的AI接口

重构后支持自动MCP工具加载：
- 所有AI方法在请求前自动检查用户MCP配置
- 如果有启用的MCP插件且有可用工具，自动发送tools
- 通过 auto_mcp 参数控制是否启用自动工具加载
"""
from typing import Optional, AsyncGenerator, List, Dict, Any, Union

from app.config import settings as app_settings
from app.logger import get_logger
from app.services.ai_config import AIClientConfig, default_config
from app.services.ai_metrics import AICallMetrics, TokenUsage, ToolCallMetrics
from app.services.ai_clients.openai_client import OpenAIClient
from app.services.ai_clients.anthropic_client import AnthropicClient
from app.services.ai_clients.gemini_client import GeminiClient
from app.services.ai_clients.base_client import cleanup_all_clients
from app.services.ai_providers.openai_provider import OpenAIProvider
from app.services.ai_providers.anthropic_provider import AnthropicProvider
from app.services.ai_providers.gemini_provider import GeminiProvider
from app.services.ai_providers.base_provider import BaseAIProvider
from app.services.json_helper import clean_json_response, parse_json

# 导出清理函数
cleanup_http_clients = cleanup_all_clients

logger = get_logger(__name__)


def normalize_provider(provider: Optional[str]) -> Optional[str]:
    """标准化 provider 名称，兼容 OpenAI 格式渠道别名。

    内置适配器（例如 Xiaomi MiMo）应在 API 层解析为底层兼容 provider，
    AIService 只接收可直接初始化的 provider。
    """
    if provider is None:
        return None

    normalized = provider.lower().strip()
    if normalized == "mumu":
        return "openai"
    return normalized


class AIService:
    """
    AI服务统一接口
    
    MCP工具支持：
    - 在创建服务时传入 user_id 和 db_session
    - 根据用户MCP插件的enabled状态自动决定是否启用MCP
    - 如果有任意一个MCP插件启用，则加载并使用工具
    - 如果所有插件都关闭，则不使用任何MCP工具
    - 通过 auto_mcp=False 可临时禁用自动工具加载
    - 通过 mcp_max_rounds 控制工具调用轮数
    - 通过 clear_mcp_cache() 可清理MCP工具缓存
    
    MCP启用逻辑（backend/app/api/settings.py 中的 get_user_ai_service）：
    - 查询用户的所有MCP插件
    - 如果有启用的插件 (enabled=True)，则 enable_mcp=True
    - 如果所有插件都关闭或没有插件，则 enable_mcp=False
    
    使用示例：
        # 创建支持MCP的AI服务（根据插件状态自动决定是否启用）
        ai_service = create_user_ai_service_with_mcp(
            api_provider="openai",
            api_key="...",
            user_id="user123",
            db_session=db
        )
        
        # 自动加载MCP工具（如果有启用的插件）
        result = await ai_service.generate_text(prompt="...")
        
        # 临时禁用MCP工具
        result = await ai_service.generate_text(prompt="...", auto_mcp=False)
        
        # 自定义轮数
        result = await ai_service.generate_text(prompt="...", mcp_max_rounds=3)
    """

    def __init__(
        self,
        api_provider: Optional[str] = None,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        default_temperature: Optional[float] = None,
        default_max_tokens: Optional[int] = None,
        default_system_prompt: Optional[str] = None,
        config: Optional[AIClientConfig] = None,
        # MCP支持参数
        user_id: Optional[str] = None,
        db_session: Optional[Any] = None,
        enable_mcp: bool = True,
    ):
        self.raw_api_provider = (api_provider or app_settings.default_ai_provider or "openai").lower().strip()
        self.api_provider = normalize_provider(self.raw_api_provider)
        self.default_model = default_model or app_settings.default_model
        self.default_temperature = default_temperature or app_settings.default_temperature
        self.default_max_tokens = default_max_tokens or app_settings.default_max_tokens
        self.default_system_prompt = default_system_prompt
        self.config = config or default_config
        
        # MCP配置
        self.user_id = user_id
        self.db_session = db_session
        self._enable_mcp = enable_mcp
        self._cached_tools: Optional[List[Dict]] = None
        self._tools_loaded = False
        
        self._openai_provider: Optional[OpenAIProvider] = None
        self._anthropic_provider: Optional[AnthropicProvider] = None
        self._gemini_provider: Optional[GeminiProvider] = None
        
        # 初始化 OpenAI 兼容接口
        openai_key = None
        openai_base_url = None
        if self.api_provider == "openai":
            openai_key = api_key or app_settings.openai_api_key
            openai_base_url = api_base_url or app_settings.openai_base_url
        else:
            openai_key = app_settings.openai_api_key
            openai_base_url = app_settings.openai_base_url

        if openai_key:
            client = OpenAIClient(openai_key, openai_base_url or "https://api.openai.com/v1", self.config)
            self._openai_provider = OpenAIProvider(client)
        
        # 初始化 Anthropic
        anthropic_key = api_key if self.api_provider == "anthropic" else app_settings.anthropic_api_key
        if anthropic_key:
            base_url = api_base_url if self.api_provider == "anthropic" else app_settings.anthropic_base_url
            client = AnthropicClient(anthropic_key, base_url, self.config)
            self._anthropic_provider = AnthropicProvider(client)
        
        # 初始化 Gemini
        if self.api_provider == "gemini" and api_key:
            client = GeminiClient(api_key, api_base_url, self.config)
            self._gemini_provider = GeminiProvider(client)

    @property
    def enable_mcp(self) -> bool:
        """是否启用MCP工具"""
        return self._enable_mcp
    
    @enable_mcp.setter
    def enable_mcp(self, value: bool):
        """设置MCP启用状态，如果禁用则清理缓存"""
        if value is False and self._enable_mcp is True:
            # 从启用变为禁用，清理缓存
            self.clear_mcp_cache()
        self._enable_mcp = value
    
    def clear_mcp_cache(self):
        """
        清理MCP工具缓存
        
        当禁用MCP时调用此方法，确保后续AI调用不会使用缓存的工具。
        同时更新 _tools_loaded 状态，使下次调用时重新检查。
        """
        if self._cached_tools is not None:
            logger.info(f"🔧 清理MCP工具缓存，移除 {len(self._cached_tools)} 个工具")
            self._cached_tools = None
        else:
            logger.debug(f"🔧 MCP工具缓存已经是空，无需清理")
        
        # 更新加载状态，确保下次调用会重新检查
        self._tools_loaded = False
        logger.debug(f"🔧 MCP工具状态已重置: enable_mcp={self._enable_mcp}, _tools_loaded=False")
    
    def _get_provider(self, provider: Optional[str] = None) -> BaseAIProvider:
        """获取对应的 Provider"""
        p = normalize_provider(provider or self.api_provider)
        if p == "openai" and self._openai_provider:
            return self._openai_provider
        if p == "anthropic" and self._anthropic_provider:
            return self._anthropic_provider
        if p == "gemini" and self._gemini_provider:
            return self._gemini_provider
        raise ValueError(f"Provider {p} 未初始化")

    def _build_call_metrics(
        self,
        *,
        request_mode: str,
        provider: Optional[str],
        model: Optional[str],
        prompt: str,
        auto_mcp: bool,
        tools_count: int,
        stream: bool,
    ) -> AICallMetrics:
        return AICallMetrics(
            request_mode=request_mode,
            provider=normalize_provider(provider or self.api_provider) or "unknown",
            model=model or self.default_model,
            user_id=self.user_id,
            stream=stream,
            auto_mcp=auto_mcp,
            tools_count=tools_count,
            prompt_length=len(prompt or ""),
        )

    def _log_call_metrics(self, metrics: AICallMetrics, title: Optional[str] = None):
        log_title = title or ("AI调用完成" if metrics.success else "AI调用失败")
        message = metrics.to_log_message(log_title)
        if metrics.success:
            logger.info(message)
        else:
            logger.error(message)

    async def _prepare_mcp_tools(self, auto_mcp: bool = True, force_refresh: bool = False) -> Optional[List[Dict]]:
        """
        预处理MCP工具
        
        检查用户MCP配置并加载可用工具。
        结果会被缓存，避免重复加载。
        
        Args:
            auto_mcp: 是否自动加载MCP工具（来自调用方参数）
            force_refresh: 是否强制刷新缓存
            
        Returns:
            - None: 无可用工具（未配置/未启用/加载失败）
            - List[Dict]: OpenAI格式的工具列表
        """
        # 前置条件检查
        if not self._enable_mcp:
            logger.debug(f"🔧 MCP工具未启用 (_enable_mcp=False)")
            # 即使有缓存也清理掉，确保不使用
            self._cached_tools = None
            self._tools_loaded = False
            return None
        
        if not auto_mcp:
            logger.debug(f"🔧 auto_mcp=False，跳过MCP工具加载")
            # 即使有缓存也清理掉，确保不使用
            self._cached_tools = None
            self._tools_loaded = False
            return None
        
        if not self.user_id:
            logger.debug(f"🔧 MCP工具加载跳过: user_id未设置")
            return None
        
        if not self.db_session:
            logger.debug(f"🔧 MCP工具加载跳过: db_session未设置")
            return None
        
        # 使用缓存（只有 enable_mcp=True 时才使用缓存）
        if self._tools_loaded and not force_refresh:
            if self._cached_tools:
                logger.debug(f"🔧 使用缓存的MCP工具 ({len(self._cached_tools)}个)")
            return self._cached_tools
        
        try:
            from app.services.mcp_tools_loader import mcp_tools_loader
            
            self._cached_tools = await mcp_tools_loader.get_user_tools(
                user_id=self.user_id,
                db_session=self.db_session,
                use_cache=True,
                force_refresh=force_refresh
            )
            self._tools_loaded = True
            
            if self._cached_tools:
                logger.info(f"🔧 已加载 {len(self._cached_tools)} 个MCP工具")
            else:
                logger.debug(f"📭 用户 {self.user_id} 没有可用的MCP工具")
            
            return self._cached_tools
            
        except Exception as e:
            logger.warning(f"⚠️ 加载MCP工具失败: {e}")
            self._tools_loaded = True
            self._cached_tools = None
            return None

    async def _handle_tool_calls(
        self,
        original_prompt: str,
        response: Dict[str, Any],
        max_rounds: int = 2,
        **kwargs
    ) -> Dict[str, Any]:
        """
        处理AI返回的工具调用
        
        Args:
            original_prompt: 原始提示词
            response: AI响应（包含tool_calls）
            max_rounds: 最大工具调用轮数
            **kwargs: 传递给generate_text的其他参数
            
        Returns:
            最终的AI响应
        """
        from app.mcp import mcp_client
        
        tool_calls = response.get("tool_calls", [])
        if not tool_calls or not self.user_id:
            return response

        tool_metrics = ToolCallMetrics()
        tool_metrics.usage.add(TokenUsage.from_response(response))
        
        result = {
            "content": response.get("content", ""),
            "tool_calls_made": 0,
            "tools_used": [],
            "finish_reason": response.get("finish_reason", ""),
            "mcp_enhanced": True,
            "usage": response.get("usage"),
        }
        
        prompt = original_prompt
        
        for round_num in range(max_rounds):
            logger.info(f"🔧 工具调用 - 第{round_num+1}/{max_rounds}轮，{len(tool_calls)}个工具")
            tool_metrics.mcp_rounds += 1
            
            try:
                # 批量执行工具调用
                tool_results = await mcp_client.batch_call_tools(
                    user_id=self.user_id,
                    tool_calls=tool_calls
                )
                
                # 记录使用的工具
                for tc in tool_calls:
                    name = tc["function"]["name"]
                    tool_metrics.add_tool_name(name)
                    if name not in result["tools_used"]:
                        result["tools_used"].append(name)
                result["tool_calls_made"] += len(tool_calls)
                tool_metrics.tool_calls_count += len(tool_calls)
                
                # 构建工具上下文
                tool_context = mcp_client.build_tool_context(tool_results, format="markdown")
                
                # 更新提示词
                if round_num == max_rounds - 1:
                    # 最后一轮，强制要求回答
                    prompt = f"{original_prompt}\n\n{tool_context}\n\n⚠️ 重要：请基于以上工具查询结果，给出完整详细的最终答案。不要再调用工具。"
                    tool_choice = "none"
                else:
                    prompt = f"{original_prompt}\n\n{tool_context}\n\n请基于以上工具查询结果，继续完成任务。"
                    tool_choice = kwargs.get("tool_choice", "auto")
                
                # 继续调用AI
                prov = self._get_provider(kwargs.get("provider"))
                next_response = await prov.generate(
                    prompt=prompt,
                    model=kwargs.get("model") or self.default_model,
                    temperature=kwargs.get("temperature") or self.default_temperature,
                    max_tokens=kwargs.get("max_tokens") or self.default_max_tokens,
                    system_prompt=kwargs.get("system_prompt") or self.default_system_prompt,
                    tools=None if tool_choice == "none" else self._cached_tools,
                    tool_choice=tool_choice,
                )
                tool_metrics.usage.add(TokenUsage.from_response(next_response))
                
                tool_calls = next_response.get("tool_calls", [])
                
                if not tool_calls:
                    # 没有更多工具调用，返回结果
                    result["content"] = next_response.get("content", "")
                    result["finish_reason"] = next_response.get("finish_reason", "stop")
                    result["usage"] = {
                        "prompt_tokens": tool_metrics.usage.prompt_tokens,
                        "completion_tokens": tool_metrics.usage.completion_tokens,
                        "total_tokens": tool_metrics.usage.total_tokens,
                    }
                    break
                    
            except Exception as e:
                logger.error(f"❌ 工具调用失败: {e}")
                tool_metrics.tool_error_count += 1
                result["content"] = response.get("content", "")
                result["finish_reason"] = "tool_error"
                result["usage"] = {
                    "prompt_tokens": tool_metrics.usage.prompt_tokens,
                    "completion_tokens": tool_metrics.usage.completion_tokens,
                    "total_tokens": tool_metrics.usage.total_tokens,
                }
                break

        result["__tool_metrics"] = tool_metrics
        
        return result

    async def generate_text(
        self,
        prompt: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        tools: Optional[List[Dict]] = None,
        tool_choice: Optional[str] = None,
        auto_mcp: bool = True,
        handle_tool_calls: bool = True,
        mcp_max_rounds: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        生成文本（自动支持MCP工具）
        
        Args:
            prompt: 用户提示词
            provider: AI提供商
            model: 模型名称
            temperature: 温度
            max_tokens: 最大令牌数
            system_prompt: 系统提示词
            tools: 手动指定的工具列表（优先级高于自动加载）
            tool_choice: 工具选择策略
            auto_mcp: 是否自动加载MCP工具（默认True）
            handle_tool_calls: 是否自动处理工具调用（默认True）
            mcp_max_rounds: 最大工具调用轮数（None使用默认值3）
            
        Returns:
            包含生成内容的字典
        """
        # 使用全局配置的MCP轮数（如果未指定）
        if mcp_max_rounds is None:
            mcp_max_rounds = app_settings.mcp_max_rounds
        
        # 自动加载MCP工具
        if auto_mcp and tools is None:
            tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)

        metrics = self._build_call_metrics(
            request_mode="文本",
            provider=provider,
            model=model,
            prompt=prompt,
            auto_mcp=auto_mcp,
            tools_count=len(tools) if tools else 0,
            stream=False,
        )
        
        try:
            prov = self._get_provider(provider)
            response = await prov.generate(
                prompt=prompt,
                model=model or self.default_model,
                temperature=temperature or self.default_temperature,
                max_tokens=max_tokens or self.default_max_tokens,
                system_prompt=system_prompt or self.default_system_prompt,
                tools=tools,
                tool_choice=tool_choice,
            )
            usage = TokenUsage.from_response(response)
            
            # 处理工具调用
            if handle_tool_calls and response.get("tool_calls"):
                response = await self._handle_tool_calls(
                    original_prompt=prompt,
                    response=response,
                    provider=provider,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    system_prompt=system_prompt,
                    tool_choice=tool_choice,
                    max_rounds=mcp_max_rounds,
                )
                usage = TokenUsage.from_response(response)
                tool_metrics = response.get("__tool_metrics")
                if tool_metrics:
                    metrics.merge_tool_metrics(tool_metrics)

            metrics.finish(
                success=True,
                response_length=len(response.get("content", "") or ""),
                finish_reason=response.get("finish_reason"),
                usage=usage,
            )
            self._log_call_metrics(metrics)
            return response
        except Exception as e:
            metrics.finish(success=False, error=e)
            self._log_call_metrics(metrics)
            raise

    async def generate_text_stream(
        self,
        prompt: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        tool_choice: Optional[str] = None,
        auto_mcp: bool = True,
        mcp_max_rounds: Optional[int] = None,
    ) -> AsyncGenerator[str, None]:
        """
        流式生成文本（自动支持MCP工具）
        
        工具调用在 Provider 层通过流式方式处理，支持真正的流式工具调用。
        
        Args:
            prompt: 用户提示词
            provider: AI提供商
            model: 模型名称
            temperature: 温度
            max_tokens: 最大令牌数
            system_prompt: 系统提示词
            tool_choice: 工具选择策略（"auto"/"none"/"required"）
            auto_mcp: 是否自动加载MCP工具
            mcp_max_rounds: 最大工具调用轮数（None使用默认值3）
            
        Yields:
            生成的文本块
        """
        logger.debug(f"🔧 generate_text_stream: auto_mcp={auto_mcp}, tool_choice={tool_choice}")
        
        tools_to_use = None
        
        # 加载MCP工具
        if auto_mcp:
            tools_to_use = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
            if tools_to_use:
                logger.info(f"🔧 已获取 {len(tools_to_use)} 个MCP工具")

        metrics = self._build_call_metrics(
            request_mode="流式文本",
            provider=provider,
            model=model,
            prompt=prompt,
            auto_mcp=auto_mcp,
            tools_count=len(tools_to_use) if tools_to_use else 0,
            stream=True,
        )
        response_parts: List[str] = []
        latest_usage = TokenUsage()
        finish_reason = "stop"
        
        try:
            # 流式生成（Provider 层处理工具调用）
            prov = self._get_provider(provider)
            logger.debug(f"🔧 开始流式生成，provider={provider or self.api_provider}, tools_count={len(tools_to_use) if tools_to_use else 0}")
            async for chunk in prov.generate_stream(
                prompt=prompt,
                model=model or self.default_model,
                temperature=temperature or self.default_temperature,
                max_tokens=max_tokens or self.default_max_tokens,
                system_prompt=system_prompt or self.default_system_prompt,
                tools=tools_to_use,
                tool_choice=tool_choice,
                user_id=self.user_id,
            ):
                if isinstance(chunk, dict):
                    if chunk.get("usage"):
                        latest_usage = TokenUsage.from_response({"usage": chunk.get("usage")})
                    if chunk.get("finish_reason"):
                        finish_reason = chunk.get("finish_reason") or finish_reason
                    continue

                if chunk:
                    metrics.mark_first_chunk()
                    metrics.chunk_count += 1
                    response_parts.append(chunk)
                yield chunk

            metrics.finish(
                success=True,
                response_length=len("".join(response_parts)),
                finish_reason=finish_reason,
                usage=latest_usage,
            )
            self._log_call_metrics(metrics)
        except Exception as e:
            metrics.finish(
                success=False,
                response_length=len("".join(response_parts)),
                finish_reason=finish_reason,
                usage=latest_usage,
                error=e,
            )
            self._log_call_metrics(metrics)
            raise

    async def call_with_json_retry(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_retries: int = 3,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        expected_type: Optional[str] = None,
        auto_mcp: bool = True,
    ) -> Union[Dict, List]:
        """
        带重试的 JSON 调用（自动支持MCP工具）
        
        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词
            max_retries: 最大重试次数
            temperature: 温度
            max_tokens: 最大令牌数
            provider: AI提供商
            model: 模型名称
            expected_type: 期望的返回类型（"object"或"array"）
            auto_mcp: 是否自动加载MCP工具
            
        Returns:
            解析后的JSON数据
        """
        last_response = ""
        aggregate_usage = TokenUsage()
        metrics = self._build_call_metrics(
            request_mode="JSON重试",
            provider=provider,
            model=model,
            prompt=prompt,
            auto_mcp=auto_mcp,
            tools_count=0,
            stream=False,
        )
        
        try:
            for attempt in range(1, max_retries + 1):
                current_prompt = prompt if attempt == 1 else self._add_json_hint(prompt, last_response, attempt)
                
                result = await self.generate_text(
                    prompt=current_prompt,
                    provider=provider,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    system_prompt=system_prompt,
                    auto_mcp=auto_mcp,
                    handle_tool_calls=True,
                )
                aggregate_usage.add(TokenUsage.from_response(result))
                metrics.retry_count = attempt
                metrics.tools_count = max(metrics.tools_count, len(self._cached_tools) if self._cached_tools else 0)
                
                last_response = result.get("content", "")
                
                try:
                    data = parse_json(last_response)
                    if expected_type == "object" and not isinstance(data, dict):
                        raise ValueError("期望对象")
                    if expected_type == "array" and not isinstance(data, list):
                        raise ValueError("期望数组")
                    metrics.json_parse_success = True
                    metrics.finish(
                        success=True,
                        response_length=len(last_response),
                        finish_reason=result.get("finish_reason"),
                        usage=aggregate_usage,
                    )
                    self._log_call_metrics(metrics, title="AI调用汇总")
                    return data
                except Exception as e:
                    metrics.json_parse_success = False
                    if attempt == max_retries:
                        raise ValueError(f"JSON 解析失败: {e}")
            
            raise ValueError("JSON 调用失败")
        except Exception as e:
            metrics.finish(
                success=False,
                response_length=len(last_response),
                usage=aggregate_usage,
                error=e,
            )
            self._log_call_metrics(metrics, title="AI调用汇总")
            raise

    @staticmethod
    def _add_json_hint(prompt: str, failed: str, attempt: int) -> str:
        return f"{prompt}\n\n⚠️ 第{attempt}次重试，请返回纯JSON，不要markdown包裹。上次错误: {failed[:200]}..."

    @staticmethod
    def _clean_json_response(text: str) -> str:
        """清洗 JSON 响应"""
        return clean_json_response(text)


def create_user_ai_service(
    api_provider: str,
    api_key: str,
    api_base_url: str,
    model_name: str,
    temperature: float,
    max_tokens: int,
    system_prompt: Optional[str] = None,
) -> AIService:
    """创建用户 AI 服务（不带MCP支持）"""
    return AIService(
        api_provider=api_provider,
        api_key=api_key,
        api_base_url=api_base_url,
        default_model=model_name,
        default_temperature=temperature,
        default_max_tokens=max_tokens,
        default_system_prompt=system_prompt,
    )


def create_user_ai_service_with_mcp(
    api_provider: str,
    api_key: str,
    api_base_url: str,
    model_name: str,
    temperature: float,
    max_tokens: int,
    user_id: str,
    db_session,
    system_prompt: Optional[str] = None,
    enable_mcp: bool = True,
) -> AIService:
    """
    创建支持MCP的用户AI服务
    
    Args:
        api_provider: AI提供商
        api_key: API密钥
        api_base_url: API基础URL
        model_name: 模型名称
        temperature: 温度
        max_tokens: 最大令牌数
        user_id: 用户ID（用于加载MCP工具）
        db_session: 数据库会话
        system_prompt: 系统提示词
        enable_mcp: 是否启用MCP工具
        
    Returns:
        配置好的AIService实例
    """
    return AIService(
        api_provider=api_provider,
        api_key=api_key,
        api_base_url=api_base_url,
        default_model=model_name,
        default_temperature=temperature,
        default_max_tokens=max_tokens,
        default_system_prompt=system_prompt,
        user_id=user_id,
        db_session=db_session,
        enable_mcp=enable_mcp,
    )