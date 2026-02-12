import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Select, Slider, InputNumber, message, Space, Typography, Spin, Modal, Alert, Grid, Tabs, List, Tag, Popconfirm, Empty, Row, Col } from 'antd';
import { SaveOutlined, DeleteOutlined, ReloadOutlined, InfoCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined, PlusOutlined, EditOutlined, CopyOutlined, WarningOutlined } from '@ant-design/icons';
import { settingsApi, mcpPluginApi } from '../services/api';
import type { SettingsUpdate, APIKeyPreset, PresetCreateRequest, APIKeyPresetConfig } from '../types';
import { eventBus, EventNames } from '../store/eventBus';
import { ThemeSettingsCard } from '../theme-plugins/ThemeSettingsCard';
import { SkillSettingsCard } from '../skills/SkillSettingsCard';

const { Title, Text } = Typography;
const { Option } = Select;
const { useBreakpoint } = Grid;
const { TextArea } = Input;

export default function SettingsPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md; // md断点是768px
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasSettings, setHasSettings] = useState(false);
  const [isDefaultSettings, setIsDefaultSettings] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; description: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    response_time_ms?: number;
    response_preview?: string;
    error?: string;
    error_type?: string;
    suggestions?: string[];
  } | null>(null);
  const [showTestResult, setShowTestResult] = useState(false);

  // 预设相关状态
  const [activeTab, setActiveTab] = useState('current');
  const [presets, setPresets] = useState<APIKeyPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | undefined>();
  const [editingPreset, setEditingPreset] = useState<APIKeyPreset | null>(null);
  const [isPresetModalVisible, setIsPresetModalVisible] = useState(false);
  const [testingPresetId, setTestingPresetId] = useState<string | null>(null);
  const [presetForm] = Form.useForm();
  
  // 预设编辑窗口的模型列表状态（独立于当前配置的模型列表）
  const [presetModelOptions, setPresetModelOptions] = useState<Array<{ value: string; label: string; description: string }>>([]);
  const [fetchingPresetModels, setFetchingPresetModels] = useState(false);
  const [presetModelsFetched, setPresetModelsFetched] = useState(false);

  useEffect(() => {
    loadSettings();
    if (activeTab === 'presets') {
      loadPresets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'presets') {
      loadPresets();
    } else if (activeTab === 'current') {
      // 切换到当前配置Tab时，刷新设置以获取最新数据
      loadSettings();
      // 清除旧的测试结果，因为可能是其他配置的测试结果
      setTestResult(null);
      setShowTestResult(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadSettings = async () => {
    setInitialLoading(true);
    try {
      const settings = await settingsApi.getSettings();
      form.setFieldsValue(settings);

      // 判断是否为默认设置（id='0'表示来自.env的默认配置）
      if (settings.id === '0' || !settings.id) {
        setIsDefaultSettings(true);
        setHasSettings(false);
      } else {
        setIsDefaultSettings(false);
        setHasSettings(true);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // 如果404表示还没有设置，使用默认值
      if (error?.response?.status === 404) {
        setHasSettings(false);
        setIsDefaultSettings(true);
        form.setFieldsValue({
          api_provider: 'openai',
          api_base_url: 'https://api.openai.com/v1',
          llm_model: 'gpt-4',
          temperature: 0.7,
          max_tokens: 2000,
        });
      } else {
        message.error('加载设置失败');
      }
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSave = async (values: SettingsUpdate) => {
    setLoading(true);
    try {
      // 检查是否与 MCP 缓存的配置不一致
      const verifiedConfigStr = localStorage.getItem('mcp_verified_config');
      let configChanged = false;
      
      if (verifiedConfigStr) {
        try {
          const verifiedConfig = JSON.parse(verifiedConfigStr);
          configChanged =
            verifiedConfig.provider !== values.api_provider ||
            verifiedConfig.baseUrl !== values.api_base_url ||
            verifiedConfig.model !== values.llm_model;
        } catch (e) {
          console.error('Failed to parse verified config:', e);
        }
      }
      
      await settingsApi.saveSettings(values);
      message.success('设置已保存');
      setHasSettings(true);
      setIsDefaultSettings(false);
      
      // 保存后清除测试结果，因为配置可能已变更
      setTestResult(null);
      setShowTestResult(false);
      
      // 手动保存配置后，需要同步更新预设激活状态
      // 因为用户手动修改的配置可能与之前激活的预设不一致了
      // 重新加载预设列表以确保状态正确（后端在save时会自动取消激活状态）
      if (activePresetId) {
        // 检查当前保存的配置是否与激活预设一致
        const activePreset = presets.find(p => p.id === activePresetId);
        if (activePreset) {
          const presetConfig = activePreset.config;
          const configMismatch =
            presetConfig.api_provider !== values.api_provider ||
            presetConfig.api_key !== values.api_key ||
            presetConfig.api_base_url !== values.api_base_url ||
            presetConfig.llm_model !== values.llm_model ||
            presetConfig.temperature !== values.temperature ||
            presetConfig.max_tokens !== values.max_tokens;
          
          if (configMismatch) {
            // 配置已变更，清除前端的激活状态标记
            setActivePresetId(undefined);
            message.info('配置已更改，预设激活状态已取消');
            // 刷新预设列表以同步后端取消激活的状态
            loadPresets();
          }
        }
      }
      
      // 如果配置发生变化，需要处理 MCP 插件
      if (configChanged) {
        // 清除 MCP 验证缓存
        localStorage.removeItem('mcp_verified_config');
        
        // 检查并禁用所有 MCP 插件
        try {
          const plugins = await mcpPluginApi.getPlugins();
          const activePlugins = plugins.filter(p => p.enabled);
          
          if (activePlugins.length > 0) {
            // 禁用所有插件
            message.loading({ content: '正在禁用 MCP 插件...', key: 'disable_mcp' });
            await Promise.all(activePlugins.map(p => mcpPluginApi.togglePlugin(p.id, false)));
            message.success({ content: '已禁用所有 MCP 插件', key: 'disable_mcp' });
            
            // 显示提示弹窗
            modal.warning({
              title: (
                <Space>
                  <WarningOutlined style={{ color: '#faad14' }} />
                  <span>API 配置已更改</span>
                </Space>
              ),
              centered: true,
              content: (
                <div style={{ padding: '8px 0' }}>
                  <Alert
                    message="检测到您修改了 API 配置（提供商、地址或模型），为确保 MCP 插件正常工作，系统已自动禁用所有插件。"
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <div style={{
                    padding: 12,
                    background: 'var(--color-info-bg)',
                    border: '1px solid var(--color-info-border)',
                    borderRadius: 8
                  }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>请完成以下步骤：</Text>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                      <li>前往 MCP 插件管理页面</li>
                      <li>重新进行"模型能力检查"</li>
                      <li>确认新模型支持 Function Calling 后再启用插件</li>
                    </ol>
                  </div>
                </div>
              ),
              okText: '前往 MCP 页面',
              cancelText: '稍后处理',
              onOk: () => {
                eventBus.emit(EventNames.SWITCH_TO_MCP_VIEW);
              },
            });
          }
        } catch (err) {
          console.error('Failed to disable MCP plugins:', err);
        }
      }
    } catch {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    modal.confirm({
      title: '重置设置',
      content: '确定要重置为默认值吗？',
      centered: true,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        form.setFieldsValue({
          api_provider: 'openai',
          api_key: '',
          api_base_url: 'https://api.openai.com/v1',
          llm_model: 'gpt-4',
          temperature: 0.7,
          max_tokens: 2000,
        });
        message.info('已重置为默认值，请点击保存');
      },
    });
  };

  const handleDelete = () => {
    modal.confirm({
      title: '删除设置',
      content: '确定要删除所有设置吗？此操作不可恢复。',
      centered: true,
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        setLoading(true);
        try {
          await settingsApi.deleteSettings();
          message.success('设置已删除');
          setHasSettings(false);
          form.resetFields();
        } catch {
          message.error('删除设置失败');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const apiProviders = [
    { value: 'openai', label: 'OpenAI Compatible', defaultUrl: 'https://api.openai.com/v1' },
    // { value: 'anthropic', label: 'Anthropic (Claude)', defaultUrl: 'https://api.anthropic.com' },
    { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ];

  const handleProviderChange = (value: string) => {
    const provider = apiProviders.find(p => p.value === value);
    if (provider && provider.defaultUrl) {
      form.setFieldValue('api_base_url', provider.defaultUrl);
    }
    // 清空模型列表，需要重新获取
    setModelOptions([]);
    setModelsFetched(false);
  };

  const handleFetchModels = async (silent: boolean = false) => {
    const apiKey = form.getFieldValue('api_key');
    const apiBaseUrl = form.getFieldValue('api_base_url');
    const provider = form.getFieldValue('api_provider');

    if (!apiKey || !apiBaseUrl) {
      if (!silent) {
        message.warning('请先填写 API 密钥和 API 地址');
      }
      return;
    }

    setFetchingModels(true);
    try {
      const response = await settingsApi.getAvailableModels({
        api_key: apiKey,
        api_base_url: apiBaseUrl,
        provider: provider || 'openai'
      });

      setModelOptions(response.models);
      setModelsFetched(true);
      if (!silent) {
        message.success(`成功获取 ${response.count || response.models.length} 个可用模型`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '获取模型列表失败';
      if (!silent) {
        message.error(errorMsg);
      }
      setModelOptions([]);
      setModelsFetched(true); // 即使失败也标记为已尝试，避免重复请求
    } finally {
      setFetchingModels(false);
    }
  };

  const handleModelSelectFocus = () => {
    // 如果还没有获取过模型列表，自动获取
    if (!modelsFetched && !fetchingModels) {
      handleFetchModels(true); // silent模式，不显示成功消息
    }
  };

  const handleTestConnection = async () => {
    const apiKey = form.getFieldValue('api_key');
    const apiBaseUrl = form.getFieldValue('api_base_url');
    const provider = form.getFieldValue('api_provider');
    const modelName = form.getFieldValue('llm_model');
    const temperature = form.getFieldValue('temperature');
    const maxTokens = form.getFieldValue('max_tokens');

    if (!apiKey || !apiBaseUrl || !provider || !modelName) {
      message.warning('请先填写完整的配置信息');
      return;
    }

    setTestingApi(true);
    setTestResult(null);

    try {
      const result = await settingsApi.testApiConnection({
        api_key: apiKey,
        api_base_url: apiBaseUrl,
        provider: provider,
        llm_model: modelName,
        temperature: temperature,
        max_tokens: maxTokens
      });

      setTestResult(result);
      setShowTestResult(true);

      if (result.success) {
        message.success(`测试成功！响应时间: ${result.response_time_ms}ms`);
      } else {
        message.error('API 测试失败，请查看详细信息');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '测试请求失败';
      message.error(errorMsg);
      setTestResult({
        success: false,
        message: '测试请求失败',
        error: errorMsg,
        error_type: 'RequestError',
        suggestions: ['请检查网络连接', '请确认后端服务是否正常运行']
      });
      setShowTestResult(true);
    } finally {
      setTestingApi(false);
    }
  };

  // ========== 预设管理函数 ==========

  const loadPresets = async () => {
    setPresetsLoading(true);
    try {
      const response = await settingsApi.getPresets();
      setPresets(response.presets);
      setActivePresetId(response.active_preset_id);
    } catch (error) {
      message.error('加载预设失败');
      console.error(error);
    } finally {
      setPresetsLoading(false);
    }
  };

  const showPresetModal = (preset?: APIKeyPreset) => {
    // 重置预设模型列表状态
    setPresetModelOptions([]);
    setPresetModelsFetched(false);
    
    if (preset) {
      setEditingPreset(preset);
      presetForm.setFieldsValue({
        name: preset.name,
        description: preset.description,
        ...preset.config,
      });
    } else {
      setEditingPreset(null);
      presetForm.resetFields();
      presetForm.setFieldsValue({
        api_provider: 'openai',
        api_base_url: 'https://api.openai.com/v1',
        temperature: 0.7,
        max_tokens: 2000,
      });
    }
    setIsPresetModalVisible(true);
  };

  const handlePresetCancel = () => {
    setIsPresetModalVisible(false);
    setEditingPreset(null);
    presetForm.resetFields();
    // 清除预设模型列表状态
    setPresetModelOptions([]);
    setPresetModelsFetched(false);
  };

  // 预设编辑窗口：获取模型列表
  const handleFetchPresetModels = async (silent: boolean = false) => {
    const apiKey = presetForm.getFieldValue('api_key');
    const apiBaseUrl = presetForm.getFieldValue('api_base_url');
    const provider = presetForm.getFieldValue('api_provider');

    if (!apiKey || !apiBaseUrl) {
      if (!silent) {
        message.warning('请先填写 API 密钥和 API 地址');
      }
      return;
    }

    setFetchingPresetModels(true);
    try {
      const response = await settingsApi.getAvailableModels({
        api_key: apiKey,
        api_base_url: apiBaseUrl,
        provider: provider || 'openai'
      });

      setPresetModelOptions(response.models);
      setPresetModelsFetched(true);
      if (!silent) {
        message.success(`成功获取 ${response.count || response.models.length} 个可用模型`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '获取模型列表失败';
      if (!silent) {
        message.error(errorMsg);
      }
      setPresetModelOptions([]);
      setPresetModelsFetched(true);
    } finally {
      setFetchingPresetModels(false);
    }
  };

  // 预设编辑窗口：模型选择框获得焦点时自动获取
  const handlePresetModelSelectFocus = () => {
    if (!presetModelsFetched && !fetchingPresetModels) {
      handleFetchPresetModels(true);
    }
  };

  // 预设编辑窗口：提供商变更时更新默认URL并清空模型列表
  const handlePresetProviderChange = (value: string) => {
    const provider = apiProviders.find(p => p.value === value);
    if (provider && provider.defaultUrl) {
      presetForm.setFieldValue('api_base_url', provider.defaultUrl);
    }
    // 清空模型列表，需要重新获取
    setPresetModelOptions([]);
    setPresetModelsFetched(false);
  };

  const handlePresetSave = async () => {
    try {
      const values = await presetForm.validateFields();
      const config: APIKeyPresetConfig = {
        api_provider: values.api_provider,
        api_key: values.api_key,
        api_base_url: values.api_base_url,
        llm_model: values.llm_model,
        temperature: values.temperature,
        max_tokens: values.max_tokens,
      };

      if (editingPreset) {
        await settingsApi.updatePreset(editingPreset.id, {
          name: values.name,
          description: values.description,
          config,
        });
        message.success('预设已更新');
      } else {
        const request: PresetCreateRequest = {
          name: values.name,
          description: values.description,
          config,
        };
        await settingsApi.createPreset(request);
        message.success('预设已创建');
      }

      handlePresetCancel();
      loadPresets();
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const handlePresetDelete = async (presetId: string) => {
    try {
      await settingsApi.deletePreset(presetId);
      message.success('预设已删除');
      loadPresets();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败');
      console.error(error);
    }
  };

  const handlePresetActivate = async (presetId: string, presetName: string) => {
    try {
      // 获取预设配置用于比较
      const preset = presets.find(p => p.id === presetId);
      
      await settingsApi.activatePreset(presetId);
      message.success(`已激活预设: ${presetName}`);
      
      // 激活预设后清除当前配置Tab的测试结果
      setTestResult(null);
      setShowTestResult(false);
      
      // 清除模型列表缓存，因为API配置可能已变更
      setModelOptions([]);
      setModelsFetched(false);
      
      loadPresets();
      loadSettings(); // 重新加载当前配置
      
      // 检查是否与 MCP 缓存的配置不一致
      if (preset) {
        const verifiedConfigStr = localStorage.getItem('mcp_verified_config');
        let configChanged = false;
        
        if (verifiedConfigStr) {
          try {
            const verifiedConfig = JSON.parse(verifiedConfigStr);
            configChanged =
              verifiedConfig.provider !== preset.config.api_provider ||
              verifiedConfig.baseUrl !== preset.config.api_base_url ||
              verifiedConfig.model !== preset.config.llm_model;
          } catch (e) {
            console.error('Failed to parse verified config:', e);
            configChanged = true; // 解析失败也视为配置变化
          }
        } else {
          // 没有缓存的配置，如果有启用的插件也需要处理
          configChanged = true;
        }
        
        if (configChanged) {
          // 清除 MCP 验证缓存
          localStorage.removeItem('mcp_verified_config');
          
          // 检查并禁用所有 MCP 插件
          try {
            const plugins = await mcpPluginApi.getPlugins();
            const activePlugins = plugins.filter(p => p.enabled);
            
            if (activePlugins.length > 0) {
              // 禁用所有插件
              message.loading({ content: '正在禁用 MCP 插件...', key: 'disable_mcp' });
              await Promise.all(activePlugins.map(p => mcpPluginApi.togglePlugin(p.id, false)));
              message.success({ content: '已禁用所有 MCP 插件', key: 'disable_mcp' });
              
              // 显示提示弹窗
              modal.warning({
                title: (
                  <Space>
                    <WarningOutlined style={{ color: '#faad14' }} />
                    <span>API 配置已更改</span>
                  </Space>
                ),
                centered: true,
                content: (
                  <div style={{ padding: '8px 0' }}>
                    <Alert
                      message={`切换到预设「${presetName}」后，API 配置发生了变化。为确保 MCP 插件正常工作，系统已自动禁用所有插件。`}
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                    />
                    <div style={{
                      padding: 12,
                      background: 'var(--color-info-bg)',
                      border: '1px solid var(--color-info-border)',
                      borderRadius: 8
                    }}>
                      <Text strong style={{ display: 'block', marginBottom: 8 }}>请完成以下步骤：</Text>
                      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                        <li>前往 MCP 插件管理页面</li>
                        <li>重新进行"模型能力检查"</li>
                        <li>确认新模型支持 Function Calling 后再启用插件</li>
                      </ol>
                    </div>
                  </div>
                ),
                okText: '前往 MCP 页面',
                cancelText: '稍后处理',
                onOk: () => {
                  eventBus.emit(EventNames.SWITCH_TO_MCP_VIEW);
                },
              });
            }
          } catch (err) {
            console.error('Failed to disable MCP plugins:', err);
          }
        }
      }
    } catch (error) {
      message.error('激活失败');
      console.error(error);
    }
  };

  const handlePresetTest = async (presetId: string) => {
    setTestingPresetId(presetId);
    try {
      const result = await settingsApi.testPreset(presetId);
      if (result.success) {
        modal.success({
          title: '测试成功',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 24, padding: 16, background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: 8 }}>
                <Typography.Text strong style={{ color: 'var(--color-success)' }}>
                  ✓ API 连接正常
                </Typography.Text>
              </div>

              <div style={{
                padding: 16,
                background: 'var(--color-bg-layout)',
                borderRadius: 8,
                marginBottom: 16
              }}>
                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <Text type="secondary">提供商：</Text>
                  <Text strong>{result.provider?.toUpperCase() || 'N/A'}</Text>
                </div>
                <div style={{ marginBottom: 8, fontSize: 14 }}>
                  <Text type="secondary">模型：</Text>
                  <Text strong>{result.model || 'N/A'}</Text>
                </div>
                {result.response_time_ms !== undefined && (
                  <div style={{ fontSize: 14 }}>
                    <Text type="secondary">响应时间：</Text>
                    <Text strong>{result.response_time_ms}ms</Text>
                  </div>
                )}
              </div>

              <Alert
                message="预设配置测试通过，可以正常使用"
                type="success"
                showIcon
              />
            </div>
          ),
        });
      } else {
        modal.error({
          title: '测试失败',
          centered: true,
          width: isMobile ? '90%' : 600,
          content: (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <Alert
                  message={result.message || 'API 测试失败'}
                  type="error"
                  showIcon
                />
              </div>

              {result.error && (
                <div style={{
                  padding: 16,
                  background: 'var(--color-error-bg)',
                  border: '1px solid var(--color-error-border)',
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>错误信息:</Text>
                  <Text style={{ fontSize: 13, color: 'var(--color-error)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.error}
                  </Text>
                </div>
              )}

              {result.suggestions && result.suggestions.length > 0 && (
                <div style={{
                  padding: 16,
                  background: 'var(--color-warning-bg)',
                  border: '1px solid var(--color-warning-border)',
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>💡 建议:</Text>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {result.suggestions.map((s, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Alert
                message="预设配置存在问题，请检查后重试"
                type="warning"
                showIcon
              />
            </div>
          ),
        });
      }
    } catch (error) {
      message.error('测试失败');
      console.error(error);
    } finally {
      setTestingPresetId(null);
    }
  };

  const handleCreateFromCurrent = () => {
    const currentConfig = form.getFieldsValue();
    presetForm.setFieldsValue({
      name: '',
      description: '',
      ...currentConfig,
    });
    setEditingPreset(null);
    setIsPresetModalVisible(true);
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'blue';
      // case 'anthropic':
      //   return 'purple';
      case 'gemini':
        return 'green';
      default:
        return 'default';
    }
  };

  // ========== 渲染预设列表 ==========

  const renderPresetsList = () => (
    <Spin spinning={presetsLoading}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">管理你的API配置预设，快速切换不同的配置</Text>
          <Space>
            <Button icon={<CopyOutlined />} onClick={handleCreateFromCurrent}>
              从当前创建
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showPresetModal()}>
              新建预设
            </Button>
          </Space>
        </div>

        {presets.length === 0 ? (
          <Empty
            description="暂无预设配置"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: '40px 0' }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => showPresetModal()}>
              创建第一个预设
            </Button>
          </Empty>
        ) : (
          <List
            dataSource={presets}
            renderItem={(preset) => {
              const isActive = preset.id === activePresetId;
              return (
                <List.Item
                  key={preset.id}
                  style={{
                    background: isActive ? '#f0f5ff' : 'transparent',
                    padding: '16px',
                    marginBottom: '8px',
                    border: isActive ? '2px solid #1890ff' : '1px solid #f0f0f0',
                    borderRadius: '8px',
                  }}
                  actions={[
                    !isActive && (
                      <Button
                        type="link"
                        onClick={() => handlePresetActivate(preset.id, preset.name)}
                      >
                        激活
                      </Button>
                    ),
                    <Button
                      key="test"
                      type="link"
                      icon={<ThunderboltOutlined />}
                      loading={testingPresetId === preset.id}
                      onClick={() => handlePresetTest(preset.id)}
                    >
                      测试
                    </Button>,
                    <Button
                      type="link"
                      icon={<EditOutlined />}
                      onClick={() => showPresetModal(preset)}
                    >
                      编辑
                    </Button>,
                    <Popconfirm
                      title="确定删除此预设吗？"
                      onConfirm={() => handlePresetDelete(preset.id)}
                      disabled={isActive}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={isActive}
                      >
                        删除
                      </Button>
                    </Popconfirm>,
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={
                      isActive && (
                        <CheckCircleOutlined
                          style={{ fontSize: '24px', color: '#52c41a' }}
                        />
                      )
                    }
                    title={
                      <Space>
                        <span style={{ fontWeight: 'bold' }}>{preset.name}</span>
                        {isActive && <Tag color="success">激活中</Tag>}
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        {preset.description && (
                          <div style={{ color: '#666' }}>{preset.description}</div>
                        )}
                        <Space wrap>
                          <Tag color={getProviderColor(preset.config.api_provider)}>
                            {preset.config.api_provider.toUpperCase()}
                          </Tag>
                          <Tag>{preset.config.llm_model}</Tag>
                          <Tag>温度: {preset.config.temperature}</Tag>
                          <Tag>Tokens: {preset.config.max_tokens}</Tag>
                        </Space>
                        <div style={{ fontSize: '12px', color: '#999' }}>
                          创建于: {new Date(preset.created_at).toLocaleString()}
                        </div>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Space>
    </Spin>
  );

  return (
    <>
      {contextHolder}
      <div style={{
        minHeight: '90vh',
        background: 'linear-gradient(180deg, var(--color-bg-base) 0%, #EEF2F3 100%)',
        padding: isMobile ? '20px 16px 70px' : '24px 24px 70px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* 顶部导航卡片 */}
          <Card
            variant="borderless"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary) 0%, #5A9BA5 50%, var(--color-primary-hover) 100%)',
              borderRadius: isMobile ? 16 : 24,
              boxShadow: '0 12px 40px rgba(77, 128, 136, 0.25), 0 4px 12px rgba(0, 0, 0, 0.06)',
              marginBottom: isMobile ? 20 : 24,
              border: 'none',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* 装饰性背景元素 */}
            <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.08)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '50%', right: '15%', width: 80, height: 80, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.06)', pointerEvents: 'none' }} />

            <Row align="middle" justify="space-between" gutter={[16, 16]} style={{ position: 'relative', zIndex: 1 }}>
              <Col xs={24} sm={12}>
                <Space direction="vertical" size={4}>
                  <Title level={isMobile ? 3 : 2} style={{ margin: 0, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    AI API 设置
                  </Title>
                  <Text style={{ fontSize: isMobile ? 12 : 14, color: 'rgba(255,255,255,0.85)', marginLeft: isMobile ? 40 : 48 }}>
                    配置AI接口参数，管理多个API配置预设
                  </Text>
                </Space>
              </Col>
              <Col xs={24} sm={12}>
                {/* 按钮区域预留 */}
              </Col>
            </Row>
          </Card>

          <ThemeSettingsCard />

          <SkillSettingsCard />

          {/* 主内容卡片 */}
          <Card
            variant="borderless"
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: isMobile ? 12 : 16,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              flex: 1,
            }}
            styles={{
              body: {
                padding: isMobile ? '16px' : '24px'
              }
            }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'current',
                  label: '当前配置',
                  children: (
                    <Space direction="vertical" size={isMobile ? 'middle' : 'large'} style={{ width: '100%' }}>

                      {/* 默认配置提示 */}
                      {isDefaultSettings && (
                        <Alert
                          message="使用 .env 文件中的默认配置"
                          description={
                            <div style={{ fontSize: isMobile ? '12px' : '14px' }}>
                              <p style={{ margin: '8px 0' }}>
                                当前显示的是从服务器 <code>.env</code> 文件读取的默认配置。
                              </p>
                              <p style={{ margin: '8px 0 0 0' }}>
                                点击"保存设置"后，配置将保存到数据库并同步更新到 <code>.env</code> 文件。
                              </p>
                            </div>
                          }
                          type="info"
                          showIcon
                          style={{ marginBottom: isMobile ? 12 : 16 }}
                        />
                      )}

                      {/* 已保存配置提示 */}
                      {hasSettings && !isDefaultSettings && (
                        <Alert
                          message="使用已保存的个人配置"
                          type="success"
                          showIcon
                          style={{ marginBottom: isMobile ? 12 : 16 }}
                        />
                      )}

                      {/* 表单 */}
                      <Spin spinning={initialLoading}>
                        <Form
                          form={form}
                          layout="vertical"
                          onFinish={handleSave}
                          autoComplete="off"
                        >
                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 提供商</span>
                                <InfoCircleOutlined
                                  title="选择你的AI服务提供商"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_provider"
                            rules={[{ required: true, message: '请选择API提供商' }]}
                          >
                            <Select size={isMobile ? 'middle' : 'large'} onChange={handleProviderChange}>
                              {apiProviders.map(provider => (
                                <Option key={provider.value} value={provider.value}>
                                  {provider.label}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 密钥</span>
                                <InfoCircleOutlined
                                  title="你的API密钥，将加密存储"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_key"
                            rules={[{ required: true, message: '请输入API密钥' }]}
                          >
                            <Input.Password
                              size={isMobile ? 'middle' : 'large'}
                              placeholder="sk-..."
                              autoComplete="new-password"
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>API 地址</span>
                                <InfoCircleOutlined
                                  title="API的基础URL地址"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="api_base_url"
                            rules={[
                              { required: true, message: '请输入API地址' },
                              { type: 'url', message: '请输入有效的URL' }
                            ]}
                          >
                            <Input
                              size={isMobile ? 'middle' : 'large'}
                              placeholder="https://api.openai.com/v1"
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>模型名称</span>
                                <InfoCircleOutlined
                                  title="AI模型的名称，如 gpt-4, gpt-3.5-turbo"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="llm_model"
                            rules={[{ required: true, message: '请输入或选择模型名称' }]}
                          >
                            <Select
                              size={isMobile ? 'middle' : 'large'}
                              showSearch
                              placeholder={isMobile ? "选择模型" : "输入模型名称或点击获取"}
                              optionFilterProp="label"
                              loading={fetchingModels}
                              onFocus={handleModelSelectFocus}
                              filterOption={(input, option) =>
                                (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                                (option?.description ?? '').toLowerCase().includes(input.toLowerCase())
                              }
                              dropdownRender={(menu) => (
                                <>
                                  {menu}
                                  {fetchingModels && (
                                    <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      <Spin size="small" /> 正在获取模型列表...
                                    </div>
                                  )}
                                  {!fetchingModels && modelOptions.length === 0 && modelsFetched && (
                                    <div style={{ padding: '8px 12px', color: '#ff4d4f', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      未能获取到模型列表，请检查 API 配置
                                    </div>
                                  )}
                                  {!fetchingModels && modelOptions.length === 0 && !modelsFetched && (
                                    <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                      点击输入框自动获取模型列表
                                    </div>
                                  )}
                                </>
                              )}
                              notFoundContent={
                                fetchingModels ? (
                                  <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                    <Spin size="small" /> 加载中...
                                  </div>
                                ) : (
                                  <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: isMobile ? '12px' : '14px' }}>
                                    未找到匹配的模型
                                  </div>
                                )
                              }
                              suffixIcon={
                                !isMobile ? (
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!fetchingModels) {
                                        setModelsFetched(false);
                                        handleFetchModels(false);
                                      }
                                    }}
                                    style={{
                                      cursor: fetchingModels ? 'not-allowed' : 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      padding: '0 4px',
                                      height: '100%',
                                      marginRight: -8
                                    }}
                                    title="重新获取模型列表"
                                  >
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<ReloadOutlined />}
                                      loading={fetchingModels}
                                      style={{ pointerEvents: 'none' }}
                                    >
                                      刷新
                                    </Button>
                                  </div>
                                ) : undefined
                              }
                              options={modelOptions.map(model => ({
                                value: model.value,
                                label: model.label,
                                description: model.description
                              }))}
                              optionRender={(option) => (
                                <div>
                                  <div style={{ fontWeight: 500, fontSize: isMobile ? '13px' : '14px' }}>{option.data.label}</div>
                                  {option.data.description && (
                                    <div style={{ fontSize: isMobile ? '11px' : '12px', color: '#8c8c8c', marginTop: '2px' }}>
                                      {option.data.description}
                                    </div>
                                  )}
                                </div>
                              )}
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>温度参数</span>
                                <InfoCircleOutlined
                                  title="控制输出的随机性，值越高越随机（0.0-2.0）"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="temperature"
                          >
                            <Slider
                              min={0}
                              max={2}
                              step={0.1}
                              marks={{
                                0: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '0.0' },
                                0.7: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '0.7' },
                                1: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '1.0' },
                                2: { style: { fontSize: isMobile ? '11px' : '12px' }, label: '2.0' }
                              }}
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>最大 Token 数</span>
                                <InfoCircleOutlined
                                  title="单次请求的最大token数量"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="max_tokens"
                            rules={[
                              { required: true, message: '请输入最大token数' },
                              { type: 'number', min: 1, message: '请输入大于0的数字' }
                            ]}
                          >
                            <InputNumber
                              size={isMobile ? 'middle' : 'large'}
                              style={{ width: '100%' }}
                              min={1}
                              placeholder="2000"
                            />
                          </Form.Item>

                          <Form.Item
                            label={
                              <Space size={4}>
                                <span>系统提示词</span>
                                <InfoCircleOutlined
                                  title="设置全局系统提示词，每次AI调用时都会自动使用。可用于设定AI的角色、语言风格等"
                                  style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? '12px' : '14px' }}
                                />
                              </Space>
                            }
                            name="system_prompt"
                          >
                            <TextArea
                              rows={4}
                              placeholder="例如：你是一个专业的小说创作助手，请用生动、细腻的文字进行创作..."
                              maxLength={10000}
                              showCount
                              style={{ fontSize: isMobile ? '13px' : '14px' }}
                            />
                          </Form.Item>

                          {/* 测试结果展示 */}
                          {showTestResult && testResult && (
                            <Alert
                              message={
                                <Space>
                                  {testResult.success ? (
                                    <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: isMobile ? '16px' : '18px' }} />
                                  ) : (
                                    <CloseCircleOutlined style={{ color: 'var(--color-error)', fontSize: isMobile ? '16px' : '18px' }} />
                                  )}
                                  <span style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: 500 }}>
                                    {testResult.message}
                                  </span>
                                </Space>
                              }
                              description={
                                <div style={{ marginTop: 8 }}>
                                  {testResult.success ? (
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                      {testResult.response_time_ms && (
                                        <div style={{ fontSize: isMobile ? '12px' : '14px' }}>
                                          ⚡ 响应时间: <strong>{testResult.response_time_ms} ms</strong>
                                        </div>
                                      )}
                                      {testResult.response_preview && (
                                        <div style={{
                                          fontSize: isMobile ? '12px' : '13px',
                                          padding: '8px 12px',
                                          background: '#f6ffed',
                                          borderRadius: '4px',
                                          border: '1px solid #b7eb8f',
                                          marginTop: '8px'
                                        }}>
                                          <div style={{ marginBottom: '4px', fontWeight: 500 }}>AI 响应预览:</div>
                                          <div style={{ color: '#595959' }}>{testResult.response_preview}</div>
                                        </div>
                                      )}
                                      <div style={{ color: 'var(--color-success)', fontSize: isMobile ? '12px' : '13px', marginTop: '4px' }}>
                                        ✓ API 配置正确，可以正常使用
                                      </div>
                                    </Space>
                                  ) : (
                                    <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                      {testResult.error && (
                                        <div style={{
                                          fontSize: isMobile ? '12px' : '13px',
                                          padding: '8px 12px',
                                          background: '#fff2e8',
                                          borderRadius: '4px',
                                          border: '1px solid #ffbb96',
                                          color: '#d4380d'
                                        }}>
                                          <strong>错误信息:</strong> {testResult.error}
                                        </div>
                                      )}
                                      {testResult.error_type && (
                                        <div style={{ fontSize: isMobile ? '11px' : '12px', color: 'var(--color-text-secondary)' }}>
                                          错误类型: {testResult.error_type}
                                        </div>
                                      )}
                                      {testResult.suggestions && testResult.suggestions.length > 0 && (
                                        <div style={{ marginTop: '8px' }}>
                                          <div style={{ fontSize: isMobile ? '12px' : '13px', fontWeight: 500, marginBottom: '4px' }}>
                                            💡 解决建议:
                                          </div>
                                          <ul style={{
                                            margin: 0,
                                            paddingLeft: isMobile ? '16px' : '20px',
                                            fontSize: isMobile ? '12px' : '13px',
                                            color: '#595959'
                                          }}>
                                            {testResult.suggestions.map((suggestion, index) => (
                                              <li key={index} style={{ marginBottom: '4px' }}>{suggestion}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </Space>
                                  )}
                                </div>
                              }
                              type={testResult.success ? 'success' : 'error'}
                              closable
                              onClose={() => setShowTestResult(false)}
                              style={{ marginBottom: isMobile ? 16 : 24 }}
                            />
                          )}

                          {/* 操作按钮 */}
                          <Form.Item style={{ marginBottom: 0, marginTop: isMobile ? 24 : 32 }}>
                            {isMobile ? (
                              // 移动端：垂直堆叠布局
                              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                <Button
                                  type="primary"
                                  size="large"
                                  icon={<SaveOutlined />}
                                  htmlType="submit"
                                  loading={loading}
                                  block
                                  style={{
                                    background: 'var(--color-primary)',
                                    border: 'none',
                                    height: '44px'
                                  }}
                                >
                                  保存设置
                                </Button>
                                <Button
                                  size="large"
                                  icon={<ThunderboltOutlined />}
                                  onClick={handleTestConnection}
                                  loading={testingApi}
                                  block
                                  style={{
                                    borderColor: 'var(--color-success)',
                                    color: 'var(--color-success)',
                                    fontWeight: 500,
                                    height: '44px'
                                  }}
                                >
                                  {testingApi ? '测试中...' : '测试连接'}
                                </Button>
                                <Space size="middle" style={{ width: '100%' }}>
                                  <Button
                                    size="large"
                                    icon={<ReloadOutlined />}
                                    onClick={handleReset}
                                    style={{ flex: 1, height: '44px' }}
                                  >
                                    重置
                                  </Button>
                                  {hasSettings && (
                                    <Button
                                      danger
                                      size="large"
                                      icon={<DeleteOutlined />}
                                      onClick={handleDelete}
                                      loading={loading}
                                      style={{ flex: 1, height: '44px' }}
                                    >
                                      删除
                                    </Button>
                                  )}
                                </Space>
                              </Space>
                            ) : (
                              // 桌面端：删除在左边，测试、重置和保存在右边
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '16px',
                                flexWrap: 'wrap'
                              }}>
                                {/* 左侧：删除按钮 */}
                                {hasSettings ? (
                                  <Button
                                    danger
                                    size="large"
                                    icon={<DeleteOutlined />}
                                    onClick={handleDelete}
                                    loading={loading}
                                    style={{
                                      minWidth: '100px'
                                    }}
                                  >
                                    删除配置
                                  </Button>
                                ) : (
                                  <div /> // 占位符，保持右侧按钮位置
                                )}

                                {/* 右侧：测试、重置和保存按钮组 */}
                                <Space size="middle">
                                  <Button
                                    size="large"
                                    icon={<ThunderboltOutlined />}
                                    onClick={handleTestConnection}
                                    loading={testingApi}
                                    style={{
                                      borderColor: 'var(--color-success)',
                                      color: 'var(--color-success)',
                                      fontWeight: 500,
                                      minWidth: '100px'
                                    }}
                                  >
                                    {testingApi ? '测试中...' : '测试'}
                                  </Button>
                                  <Button
                                    size="large"
                                    icon={<ReloadOutlined />}
                                    onClick={handleReset}
                                    style={{
                                      minWidth: '100px'
                                    }}
                                  >
                                    重置
                                  </Button>
                                  <Button
                                    type="primary"
                                    size="large"
                                    icon={<SaveOutlined />}
                                    htmlType="submit"
                                    loading={loading}
                                    style={{
                                      background: 'var(--color-primary)',
                                      border: 'none',
                                      minWidth: '120px',
                                      fontWeight: 500
                                    }}
                                  >
                                    保存
                                  </Button>
                                </Space>
                              </div>
                            )}
                          </Form.Item>
                        </Form>
                      </Spin>
                    </Space>
                  ),
                },
                {
                  key: 'presets',
                  label: '配置预设',
                  children: renderPresetsList(),
                },
              ]}
            />
          </Card>
        </div>

        {/* 预设编辑对话框 */}
        <Modal
          title={editingPreset ? '编辑预设' : '创建预设'}
          open={isPresetModalVisible}
          onOk={handlePresetSave}
          onCancel={handlePresetCancel}
          width={isMobile ? '95%' : 640}
          centered
          okText="保存"
          cancelText="取消"
          styles={{
            body: {
              padding: isMobile ? '16px' : '20px 24px'
            }
          }}
        >
          <Form
            form={presetForm}
            layout="vertical"
            size={isMobile ? 'middle' : 'large'}
          >
            {/* 基本信息 */}
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Form.Item
                  name="name"
                  label="预设名称"
                  rules={[
                    { required: true, message: '请输入预设名称' },
                    { max: 50, message: '名称不能超过50个字符' },
                  ]}
                  style={{ marginBottom: 16 }}
                >
                  <Input placeholder="例如：工作账号-GPT4" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="api_provider"
                  label="API 提供商"
                  rules={[{ required: true, message: '请选择' }]}
                  style={{ marginBottom: 16 }}
                >
                  <Select placeholder="选择提供商" onChange={handlePresetProviderChange}>
                    <Select.Option value="openai">OpenAI</Select.Option>
                    <Select.Option value="gemini">Google Gemini</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="description"
              label="预设描述"
              rules={[{ max: 200, message: '描述不能超过200个字符' }]}
              style={{ marginBottom: 16 }}
            >
              <Input placeholder="例如：用于日常写作任务（可选）" />
            </Form.Item>

            {/* API 配置 */}
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="api_key"
                  label="API Key"
                  rules={[{ required: true, message: '请输入API Key' }]}
                  style={{ marginBottom: 16 }}
                >
                  <Input.Password placeholder="sk-..." />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="api_base_url"
                  label="API Base URL"
                  style={{ marginBottom: 16 }}
                >
                  <Input placeholder="https://api.openai.com/v1" />
                </Form.Item>
              </Col>
            </Row>

            {/* 模型配置 */}
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="llm_model"
                  label={
                    <Space size={4}>
                      <span>模型名称</span>
                      <InfoCircleOutlined
                        title="AI模型的名称，点击下拉框自动获取可用模型"
                        style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}
                      />
                    </Space>
                  }
                  rules={[{ required: true, message: '请选择或输入模型名称' }]}
                  style={{ marginBottom: 16 }}
                >
                  <Select
                    showSearch
                    placeholder="点击获取模型列表或直接输入"
                    optionFilterProp="label"
                    loading={fetchingPresetModels}
                    onFocus={handlePresetModelSelectFocus}
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                      (option?.description ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        {fetchingPresetModels && (
                          <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '12px' }}>
                            <Spin size="small" /> 正在获取模型列表...
                          </div>
                        )}
                        {!fetchingPresetModels && presetModelOptions.length === 0 && presetModelsFetched && (
                          <div style={{ padding: '8px 12px', color: '#ff4d4f', textAlign: 'center', fontSize: '12px' }}>
                            未能获取到模型列表，请检查 API 配置
                          </div>
                        )}
                        {!fetchingPresetModels && presetModelOptions.length === 0 && !presetModelsFetched && (
                          <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '12px' }}>
                            点击输入框自动获取模型列表
                          </div>
                        )}
                      </>
                    )}
                    notFoundContent={
                      fetchingPresetModels ? (
                        <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px' }}>
                          <Spin size="small" /> 加载中...
                        </div>
                      ) : (
                        <div style={{ padding: '8px 12px', color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '12px' }}>
                          未找到匹配的模型
                        </div>
                      )
                    }
                    suffixIcon={
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!fetchingPresetModels) {
                            setPresetModelsFetched(false);
                            handleFetchPresetModels(false);
                          }
                        }}
                        style={{
                          cursor: fetchingPresetModels ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 4px',
                          height: '100%',
                          marginRight: -8
                        }}
                        title="获取模型列表"
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={fetchingPresetModels}
                          style={{ pointerEvents: 'none' }}
                        >
                          获取
                        </Button>
                      </div>
                    }
                    options={presetModelOptions.map(model => ({
                      value: model.value,
                      label: model.label,
                      description: model.description
                    }))}
                    optionRender={(option) => (
                      <div>
                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{option.data.label}</div>
                        {option.data.description && (
                          <div style={{ fontSize: '11px', color: '#8c8c8c', marginTop: '2px' }}>
                            {option.data.description}
                          </div>
                        )}
                      </div>
                    )}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item
                  name="temperature"
                  label="温度"
                  rules={[{ required: true, message: '必填' }]}
                  style={{ marginBottom: 16 }}
                >
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.1}
                    style={{ width: '100%' }}
                    placeholder="0.7"
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={6}>
                <Form.Item
                  name="max_tokens"
                  label="最大Tokens"
                  rules={[{ required: true, message: '必填' }]}
                  style={{ marginBottom: 16 }}
                >
                  <InputNumber
                    min={1}
                    max={100000}
                    style={{ width: '100%' }}
                    placeholder="2000"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="system_prompt"
              label="系统提示词"
              style={{ marginBottom: 0 }}
            >
              <TextArea
                rows={isMobile ? 2 : 3}
                placeholder="例如：你是一个专业的小说创作助手...（可选）"
                maxLength={10000}
                showCount
              />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </>
  );
}
