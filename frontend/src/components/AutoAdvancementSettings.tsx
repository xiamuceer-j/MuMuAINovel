import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { projectApi, projectAutomationApi, settingsApi } from '../services/api';
import type { Project, ProjectGenerationSchedule, ProjectGenerationScheduleUpdate } from '../types';
import { buildCronExpression, parseCronExpression, WEEKDAY_OPTIONS, HOUR_OPTIONS, MINUTE_OPTIONS } from '../utils/cronUtils';
import type { CronFrequency, CronMode } from '../utils/cronUtils';

const { Text } = Typography;

const defaultValues: ProjectGenerationScheduleUpdate = {
  enabled: false,
  cron_expr: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  chapters_per_run: 1,
  target_word_count: 3000,
  enable_analysis: false,
  enable_mcp: false,
  max_retries: 3,
  model: '',
  min_ready_chapters: 3,
  outline_batch_size: 1,
  chapters_per_outline: 3,
  expansion_strategy: 'balanced',
  enable_scene_analysis: false,
};

function normalizeExpansionStrategy(value?: string | null): 'balanced' | 'climax' | 'detail' {
  if (value === 'climax' || value === 'detail') return value;
  return 'balanced';
}

function getRunStatusMeta(status?: string) {
  switch (status) {
    case 'success': return { color: 'green', icon: <CheckCircleOutlined />, text: '成功' };
    case 'skipped_conflict': return { color: 'orange', icon: <ClockCircleOutlined />, text: '跳过（任务冲突）' };
    case 'skipped_no_pending': return { color: 'default', icon: <ClockCircleOutlined />, text: '跳过（无待写章节）' };
    case 'failed_expand': return { color: 'red', icon: <ExclamationCircleOutlined />, text: '展开失败' };
    case 'failed_content': return { color: 'red', icon: <ExclamationCircleOutlined />, text: '生成失败' };
    default: return { color: 'default', icon: <ClockCircleOutlined />, text: status || '未执行' };
  }
}

function getPipelineStageLabel(stage?: string) {
  switch (stage) {
    case 'expand': return '大纲展开';
    case 'chapter_create': return '章节创建';
    case 'content': return '正文生成';
    case 'skip': return '跳过';
    default: return stage || '-';
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const utcValue = value.endsWith('Z') ? value : value + 'Z';
  return new Date(utcValue).toLocaleString();
}

interface ModelOption { value: string; label: string; description: string; }

export default function AutoAdvancementSettings() {
  const [form] = Form.useForm<ProjectGenerationScheduleUpdate>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [schedule, setSchedule] = useState<ProjectGenerationSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [cronMode, setCronMode] = useState<CronMode>('visual');
  const [cronFrequency, setCronFrequency] = useState<CronFrequency>('daily');
  const [cronHour, setCronHour] = useState(9);
  const [cronMinute, setCronMinute] = useState(0);
  const [cronWeekday, setCronWeekday] = useState('1');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 加载项目列表
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await projectApi.getProjects();
        const list = Array.isArray(data) ? data : (data as any).items || [];
        setProjects(list);
        if (list.length > 0 && !selectedProjectId) {
          setSelectedProjectId(list[0].id);
        }
      } catch (err) {
        console.error('加载项目列表失败:', err);
      }
    };
    void loadProjects();
  }, []);

  // 加载自动推进配置
  useEffect(() => {
    if (!selectedProjectId) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const load = async () => {
      setLoaded(false);
      setLoading(true);
      try {
        const data = await projectAutomationApi.getSchedule(selectedProjectId, controller.signal);
        if (controller.signal.aborted) return;

        const project = projects.find((p) => p.id === selectedProjectId);
        if (data) {
          const merged = { ...defaultValues, ...data, model: data.model || '', expansion_strategy: normalizeExpansionStrategy(data.expansion_strategy) };
          form.setFieldsValue(merged);
          setSchedule({ ...merged, outline_mode: data.outline_mode || project?.outline_mode } as ProjectGenerationSchedule);
          // 解析 cron
          const parsed = parseCronExpression(data.cron_expr);
          setCronMode(parsed.mode);
          setCronFrequency(parsed.frequency);
          setCronHour(parsed.hour);
          setCronMinute(parsed.minute);
          setCronWeekday(parsed.weekday);
        } else {
          form.setFieldsValue(defaultValues);
          setSchedule(null);
          setCronMode('visual');
          setCronFrequency('daily');
          setCronHour(9);
          setCronMinute(0);
        }
      } catch (err: any) {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        console.error('加载自动推进配置失败:', err);
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    };
    void load();
  }, [selectedProjectId]);

  const updateVisualCron = (next: Partial<{ frequency: CronFrequency; hour: number; minute: number; weekday: string }>) => {
    const freq = next.frequency ?? cronFrequency;
    const hour = next.hour ?? cronHour;
    const minute = next.minute ?? cronMinute;
    const weekday = next.weekday ?? cronWeekday;
    setCronFrequency(freq);
    if (next.hour !== undefined) setCronHour(hour);
    if (next.minute !== undefined) setCronMinute(minute);
    if (next.weekday !== undefined) setCronWeekday(weekday);
    form.setFieldValue('cron_expr', buildCronExpression(freq, hour, minute, weekday));
  };

  const handleSave = async (values: ProjectGenerationScheduleUpdate) => {
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      const cronExpr = cronMode === 'advanced' ? values.cron_expr : buildCronExpression(cronFrequency, cronHour, cronMinute, cronWeekday);
      const payload: ProjectGenerationScheduleUpdate = {
        ...values,
        cron_expr: cronExpr,
        model: (values.model || '').trim() || undefined,
        expansion_strategy: normalizeExpansionStrategy(values.expansion_strategy),
      };
      const saved = await projectAutomationApi.saveSchedule(selectedProjectId, payload);
      setSchedule(saved);
      message.success('自动推进配置已保存');
    } catch (err) {
      console.error('保存失败:', err);
      message.error('保存自动推进配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProjectId) return;
    try {
      await projectAutomationApi.deleteSchedule(selectedProjectId);
      setSchedule(null);
      form.setFieldsValue(defaultValues);
      message.success('自动推进配置已删除');
    } catch (err) {
      message.error('删除失败');
    }
  };

  const handleTrigger = async () => {
    if (!selectedProjectId) return;
    setTriggering(true);
    try {
      const updated = await projectAutomationApi.triggerSchedule(selectedProjectId);
      setSchedule(updated);
      message.success('已触发一次自动推进');
    } catch (err) {
      message.error('触发失败');
    } finally {
      setTriggering(false);
    }
  };

  const handleModelSearch = async () => {
    setModelLoading(true);
    try {
      const settings = await settingsApi.getSettings();
      if (!settings?.api_key || !settings?.api_provider) {
        message.warning('请先在普通设置中配置 API 密钥和提供商');
        return;
      }
      const result = await settingsApi.getAvailableModels({
        api_key: settings.api_key,
        api_base_url: settings.api_base_url,
        provider: settings.api_provider,
      });
      setModelOptions(result.models || []);
    } catch (err) {
      message.error('获取模型列表失败');
    } finally {
      setModelLoading(false);
    }
  };

  const statusMeta = getRunStatusMeta(schedule?.last_run_status);

  return (
    <Spin spinning={loading}>
      <Row gutter={24}>
        <Col xs={24} xl={16}>
          {/* 项目选择 */}
          <Card bordered={false} style={{ borderRadius: 16, marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>选择项目</Text>
              <Select
                style={{ width: '100%' }}
                placeholder="请选择项目"
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                options={projects.map((p) => ({ value: p.id, label: p.title }))}
                showSearch
                filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
              />
            </Space>
          </Card>

          {/* 配置表单 */}
          <Form form={form} layout="vertical" initialValues={defaultValues} onFinish={handleSave}>
            <Card title={<><SettingOutlined /> 调度与触发规则</>} bordered={false} style={{ borderRadius: 16, marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="enabled" label="启用自动推进" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="配置方式">
                    <Select
                      value={cronMode}
                      onChange={(v: CronMode) => {
                        setCronMode(v);
                        if (v === 'visual') {
                          form.setFieldValue('cron_expr', buildCronExpression(cronFrequency, cronHour, cronMinute, cronWeekday));
                        }
                      }}
                      options={[{ value: 'visual', label: '可视化' }, { value: 'advanced', label: '高级（Cron）' }]}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="timezone" label="时区">
                    <Select options={[{ value: 'Asia/Shanghai', label: 'Asia/Shanghai' }, { value: 'UTC', label: 'UTC' }]} />
                  </Form.Item>
                </Col>
              </Row>

              {cronMode === 'visual' ? (
                <Row gutter={16}>
                  <Col xs={24} md={6}>
                    <Form.Item label="频率">
                      <Select value={cronFrequency} onChange={(v: CronFrequency) => updateVisualCron({ frequency: v })} options={[
                        { value: 'daily', label: '每天' },
                        { value: 'weekdays', label: '工作日' },
                        { value: 'weekly', label: '每周' },
                        { value: 'every_30_minutes', label: '每30分钟' },
                      ]} />
                    </Form.Item>
                  </Col>
                  {cronFrequency === 'weekly' && (
                    <Col xs={24} md={6}>
                      <Form.Item label="星期">
                        <Select value={cronWeekday} onChange={(v: string) => updateVisualCron({ weekday: v })} options={WEEKDAY_OPTIONS} />
                      </Form.Item>
                    </Col>
                  )}
                  {cronFrequency !== 'every_30_minutes' && (
                    <>
                      <Col xs={12} md={6}>
                        <Form.Item label="小时">
                          <Select value={cronHour} onChange={(v: number) => updateVisualCron({ hour: v })} options={HOUR_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={6}>
                        <Form.Item label="分钟">
                          <Select value={cronMinute} onChange={(v: number) => updateVisualCron({ minute: v })} options={MINUTE_OPTIONS} />
                        </Form.Item>
                      </Col>
                    </>
                  )}
                  <Col xs={24}>
                    <Text type="secondary">当前 Cron：{buildCronExpression(cronFrequency, cronHour, cronMinute, cronWeekday)}</Text>
                  </Col>
                </Row>
              ) : (
                <Form.Item name="cron_expr" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]}>
                  <Select mode="tags" style={{ width: '100%' }} placeholder="例如：0 9 * * *" />
                </Form.Item>
              )}
            </Card>

            <Card title={<><ThunderboltOutlined /> 生成策略与模型</>} bordered={false} style={{ borderRadius: 16, marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="chapters_per_run" label="每次生成章节数" rules={[{ required: true }]}>
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="target_word_count" label="目标字数" rules={[{ required: true }]}>
                    <InputNumber min={100} max={50000} step={500} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="max_retries" label="最大重试次数" rules={[{ required: true }]}>
                    <InputNumber min={0} max={10} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="model" label="指定模型（留空使用默认）">
                    <Select
                      showSearch
                      allowClear
                      placeholder="留空使用系统默认模型"
                      options={modelOptions}
                      loading={modelLoading}
                      onDropdownVisibleChange={(open) => { if (open && modelOptions.length === 0) void handleModelSearch(); }}
                      filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
                      notFoundContent={modelLoading ? <Spin size="small" /> : '暂无模型，请先配置 API'}
                      dropdownRender={(menu) => (
                        <>
                          {menu}
                          <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0' }}>
                            <a onClick={handleModelSearch}><ReloadOutlined /> 刷新模型列表</a>
                          </div>
                        </>
                      )}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="min_ready_chapters" label="最少待写章节缓冲数">
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Collapse
                ghost
                items={[{
                  key: 'advanced',
                  label: '高级参数',
                  children: (
                    <Row gutter={16}>
                      <Col xs={24} md={8}>
                        <Form.Item name="outline_batch_size" label="每次补充大纲数量">
                          <InputNumber min={1} max={10} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="chapters_per_outline" label="每个大纲展开章节数">
                          <InputNumber min={1} max={10} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="expansion_strategy" label="展开策略">
                          <Select options={[
                            { value: 'balanced', label: '均衡展开' },
                            { value: 'climax', label: '高潮优先' },
                            { value: 'detail', label: '细节展开' },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="enable_analysis" label="同步分析" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="enable_mcp" label="MCP 增强" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name="enable_scene_analysis" label="场景分析" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                }]}
              />
            </Card>

            <Card bordered={false} style={{ borderRadius: 16, marginBottom: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>保存配置</Button>
                <Popconfirm title="确定删除自动推进配置？" onConfirm={handleDelete} okText="删除" cancelText="取消">
                  <Button danger icon={<DeleteOutlined />}>删除配置</Button>
                </Popconfirm>
              </Space>
            </Card>
          </Form>
        </Col>

        {/* 右侧状态面板 */}
        <Col xs={24} xl={8}>
          <Card title="项目概览" bordered={false} style={{ borderRadius: 16, marginBottom: 16 }}>
            {schedule ? (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Text type="secondary">大纲模式</Text>
                  <div><Tag>{schedule.outline_mode || '未设置'}</Tag></Text>
                </div>
                <div>
                  <Text type="secondary">最近执行状态</Text>
                  <div><Tag icon={statusMeta.icon} color={statusMeta.color}>{statusMeta.text}</Tag></div>
                </div>
                <div>
                  <Text type="secondary">流水线阶段</Text>
                  <div>{getPipelineStageLabel(schedule.last_pipeline_stage)}</div>
                </div>
                <div>
                  <Text type="secondary">最近触发时间</Text>
                  <div>{formatDateTime(schedule.last_triggered_at)}</div>
                </div>
                <div>
                  <Text type="secondary">最近完成时间</Text>
                  <div>{formatDateTime(schedule.last_finished_at)}</div>
                </div>
                <div>
                  <Text type="secondary">下次运行时间</Text>
                  <div><Text strong>{formatDateTime(schedule.next_run_at)}</Text></div>
                </div>
                {schedule.current_batch_task_id && (
                  <div>
                    <Text type="secondary">当前任务 ID</Text>
                    <div><Text code>{schedule.current_batch_task_id}</Text></div>
                  </div>
                )}
                {schedule.last_error && (
                  <Alert type="error" showIcon message="最近错误" description={schedule.last_error} />
                )}
              </Space>
            ) : (
              <Text type="secondary">{loaded ? '尚未配置自动推进' : '加载中...'}</Text>
            )}
          </Card>

          <Card bordered={false} style={{ borderRadius: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                type="dashed"
                block
                icon={<PlayCircleOutlined />}
                loading={triggering}
                disabled={!schedule}
                onClick={handleTrigger}
              >
                立即执行一次
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </Spin>
  );
}
