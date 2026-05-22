import { useCallback, useEffect, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Switch, Table, Tag, Tabs, Typography, message, theme } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { BellOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, EyeInvisibleOutlined, MailOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { announcementApi, authApi, settingsApi } from '../services/api';
import type { Announcement, AnnouncementCreate, AnnouncementLevel, AnnouncementStatus, AnnouncementStatusResponse, AnnouncementUpdate, SystemSMTPSettings, SystemSMTPSettingsUpdate, User } from '../types';
import MarkdownRenderer from '../components/MarkdownRenderer';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TextArea, Search } = Input;

const qqDefaults: Pick<SystemSMTPSettings, 'smtp_provider' | 'smtp_host' | 'smtp_port' | 'smtp_use_ssl' | 'smtp_use_tls'> = {
  smtp_provider: 'qq',
  smtp_host: 'smtp.qq.com',
  smtp_port: 465,
  smtp_use_ssl: true,
  smtp_use_tls: false,
};

const announcementLevelText: Record<AnnouncementLevel, string> = {
  info: '通知',
  success: '成功',
  warning: '警告',
  error: '重要',
};

const announcementLevelColor: Record<AnnouncementLevel, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const announcementStatusText: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  hidden: '已隐藏',
};

const announcementStatusColor: Record<AnnouncementStatus, string> = {
  draft: 'default',
  published: 'green',
  hidden: 'red',
};

type AnnouncementStatusFilter = AnnouncementStatus | 'all';

interface AnnouncementFormValues {
  title: string;
  content: string;
  summary?: string;
  level: AnnouncementLevel;
  status: AnnouncementStatus;
  pinned?: boolean;
  publish_at?: Dayjs | null;
  expire_at?: Dayjs | null;
}

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '-';
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm');
};

const toIsoStringOrNull = (value?: Dayjs | null) => {
  if (!value) {
    return null;
  }
  return value.toISOString();
};

export default function SystemSettingsPage() {
  const { token } = theme.useToken();
  const [form] = Form.useForm<SystemSMTPSettingsUpdate>();
  const [announcementForm] = Form.useForm<AnnouncementFormValues>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTargetEmail, setTestTargetEmail] = useState('');
  const [announcementStatus, setAnnouncementStatus] = useState<AnnouncementStatusResponse | null>(null);
  const [announcementStatusLoading, setAnnouncementStatusLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [announcementStatusFilter, setAnnouncementStatusFilter] = useState<AnnouncementStatusFilter>('all');
  const [announcementSearchKeyword, setAnnouncementSearchKeyword] = useState('');
  const [announcementPagination, setAnnouncementPagination] = useState({ current: 1, pageSize: 10, total: 0 });

  const announcementContent = Form.useWatch('content', announcementForm) || '';

  const pageBackground = `linear-gradient(180deg, ${token.colorBgLayout} 0%, ${token.colorFillSecondary} 100%)`;
  const headerBackground = `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`;
  const footerSafeOffset = 88;
  const announcementAdminAvailable = announcementStatus?.mode === 'server';

  const loadAnnouncementStatus = useCallback(async () => {
    setAnnouncementStatusLoading(true);
    try {
      const status = await announcementApi.getStatus();
      setAnnouncementStatus(status);
      return status;
    } catch (error) {
      console.error('加载公告服务状态失败:', error);
      message.error('加载公告服务状态失败');
      return null;
    } finally {
      setAnnouncementStatusLoading(false);
    }
  }, []);

  const loadAnnouncements = useCallback(async (page = announcementPagination.current, pageSize = announcementPagination.pageSize, keyword = announcementSearchKeyword) => {
    if (!announcementAdminAvailable) {
      setAnnouncements([]);
      setAnnouncementPagination(prev => ({ ...prev, total: 0 }));
      return;
    }

    setAnnouncementLoading(true);
    try {
      const result = await announcementApi.adminList({
        status: announcementStatusFilter,
        q: keyword.trim() || undefined,
        page,
        limit: pageSize,
        include_expired: true,
      });
      setAnnouncements(result.data?.items || []);
      setAnnouncementPagination({
        current: result.data?.page || page,
        pageSize: result.data?.limit || pageSize,
        total: result.data?.total || 0,
      });
    } catch (error) {
      console.error('加载公告列表失败:', error);
      message.error('加载公告列表失败，请确认当前实例为服务端模式且账号拥有管理员权限');
    } finally {
      setAnnouncementLoading(false);
    }
  }, [announcementAdminAvailable, announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword, announcementStatusFilter]);

  const loadData = async () => {
    setInitialLoading(true);
    try {
      const [user, smtpSettings, status] = await Promise.all([
        authApi.getCurrentUser(),
        settingsApi.getSystemSMTPSettings(),
        announcementApi.getStatus().catch(() => null),
      ]);
      setCurrentUser(user);
      setAnnouncementStatus(status);
      form.setFieldsValue(smtpSettings);
    } catch (error) {
      console.error('加载系统设置失败:', error);
      message.error('加载系统设置失败');
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentUser?.is_admin && announcementAdminAvailable) {
      void loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    }
    if (currentUser?.is_admin && announcementStatus && !announcementAdminAvailable) {
      setAnnouncements([]);
      setAnnouncementPagination(prev => ({ ...prev, total: 0 }));
    }
  }, [currentUser?.is_admin, announcementAdminAvailable, announcementStatus, announcementStatusFilter, loadAnnouncements]);

  const handleProviderChange = (value: string) => {
    if (value === 'qq') {
      form.setFieldsValue(qqDefaults);
    }
  };

  const handleSave = async (values: SystemSMTPSettingsUpdate) => {
    setSaving(true);
    try {
      const payload = values.smtp_provider === 'qq'
        ? {
            ...values,
            ...qqDefaults,
            smtp_username: values.smtp_username,
            smtp_password: values.smtp_password,
            smtp_from_email: values.smtp_from_email,
            smtp_from_name: values.smtp_from_name,
            email_auth_enabled: values.email_auth_enabled,
            email_register_enabled: values.email_register_enabled,
            verification_code_ttl_minutes: values.verification_code_ttl_minutes,
            verification_resend_interval_seconds: values.verification_resend_interval_seconds,
          }
        : values;
      const result = await settingsApi.updateSystemSMTPSettings(payload);
      form.setFieldsValue(result);
      message.success('系统 SMTP 设置已保存');
    } catch (error) {
      console.error('保存系统设置失败:', error);
      message.error('保存系统设置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const toEmail = testTargetEmail.trim();
    if (!toEmail) {
      message.warning('请先填写测试目标邮箱');
      return;
    }

    setTesting(true);
    try {
      const result = await settingsApi.testSystemSMTPSettings({ to_email: toEmail });
      if (result.success) {
        message.success(result.message);
      } else {
        message.error(result.message || 'SMTP 测试失败');
      }
    } catch (error) {
      console.error('测试 SMTP 配置失败:', error);
      message.error('测试 SMTP 配置失败');
    } finally {
      setTesting(false);
    }
  };

  const openCreateAnnouncementModal = () => {
    if (!announcementAdminAvailable) {
      message.warning('公告发布仅在服务端模式可用');
      return;
    }
    setEditingAnnouncement(null);
    announcementForm.setFieldsValue({
      title: '',
      summary: '',
      content: '',
      level: 'info',
      status: 'published',
      pinned: false,
      publish_at: dayjs(),
      expire_at: null,
    });
    setAnnouncementModalOpen(true);
  };

  const openEditAnnouncementModal = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    announcementForm.setFieldsValue({
      title: announcement.title,
      summary: announcement.summary || '',
      content: announcement.content,
      level: announcement.level,
      status: announcement.status || 'published',
      pinned: announcement.pinned,
      publish_at: announcement.publish_at ? dayjs(announcement.publish_at) : null,
      expire_at: announcement.expire_at ? dayjs(announcement.expire_at) : null,
    });
    setAnnouncementModalOpen(true);
  };

  const closeAnnouncementModal = () => {
    setAnnouncementModalOpen(false);
    setEditingAnnouncement(null);
    announcementForm.resetFields();
  };

  const validateAnnouncementWindow = (values: AnnouncementFormValues) => {
    if (values.publish_at && values.expire_at && !values.expire_at.isAfter(values.publish_at)) {
      message.warning('过期时间必须晚于发布时间');
      return false;
    }
    return true;
  };

  const appendMarkdownSnippet = (snippet: string) => {
    const currentContent = announcementForm.getFieldValue('content') || '';
    const separator = currentContent && !currentContent.endsWith('\n') ? '\n\n' : '';
    announcementForm.setFieldsValue({ content: `${currentContent}${separator}${snippet}` });
  };

  const buildAnnouncementCreatePayload = (values: AnnouncementFormValues): AnnouncementCreate => {
    const publishAt = toIsoStringOrNull(values.publish_at);
    const expireAt = toIsoStringOrNull(values.expire_at);
    const payload: AnnouncementCreate = {
      title: values.title.trim(),
      content: values.content.trim(),
      summary: values.summary?.trim() || undefined,
      level: values.level,
      status: values.status,
      pinned: Boolean(values.pinned),
    };

    if (publishAt) {
      payload.publish_at = publishAt;
    }
    if (expireAt) {
      payload.expire_at = expireAt;
    }

    return payload;
  };

  const buildAnnouncementUpdatePayload = (values: AnnouncementFormValues): AnnouncementUpdate => ({
    title: values.title.trim(),
    content: values.content.trim(),
    summary: values.summary?.trim() || undefined,
    level: values.level,
    status: values.status,
    pinned: Boolean(values.pinned),
    publish_at: toIsoStringOrNull(values.publish_at),
    expire_at: toIsoStringOrNull(values.expire_at),
  });

  const handleSaveAnnouncement = async (values: AnnouncementFormValues) => {
    if (!validateAnnouncementWindow(values)) {
      return;
    }

    setAnnouncementSaving(true);
    try {
      if (editingAnnouncement) {
        await announcementApi.adminUpdate(editingAnnouncement.id, buildAnnouncementUpdatePayload(values));
        message.success('公告已更新');
      } else {
        await announcementApi.adminCreate(buildAnnouncementCreatePayload(values));
        message.success('公告已创建');
      }
      closeAnnouncementModal();
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('保存公告失败:', error);
      message.error('保存公告失败，请确认当前实例为服务端模式且账号拥有管理员权限');
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    try {
      await announcementApi.adminDelete(announcementId);
      message.success('公告已删除');
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('删除公告失败:', error);
      message.error('删除公告失败');
    }
  };

  const handleAnnouncementStatusChange = async (announcementId: string, action: 'publish' | 'hide') => {
    try {
      if (action === 'publish') {
        await announcementApi.adminPublish(announcementId);
        message.success('公告已发布');
      } else {
        await announcementApi.adminHide(announcementId);
        message.success('公告已隐藏');
      }
      await loadAnnouncements(announcementPagination.current, announcementPagination.pageSize, announcementSearchKeyword);
    } catch (error) {
      console.error('更新公告状态失败:', error);
      message.error('更新公告状态失败');
    }
  };

  const handleAnnouncementSearch = (value: string) => {
    const keyword = value.trim();
    setAnnouncementSearchKeyword(keyword);
    setAnnouncementPagination(prev => ({ ...prev, current: 1 }));
    void loadAnnouncements(1, announcementPagination.pageSize, keyword);
  };

  const handleAnnouncementTableChange = (pagination: TablePaginationConfig) => {
    const nextPage = pagination.current || 1;
    const nextPageSize = pagination.pageSize || announcementPagination.pageSize;
    void loadAnnouncements(nextPage, nextPageSize, announcementSearchKeyword);
  };

  const announcementColumns: ColumnsType<Announcement> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 240,
      render: (title: string, record) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Text strong>{title}</Text>
            {record.pinned && <Tag color="gold">置顶</Tag>}
          </Space>
          {record.summary && <Text type="secondary" style={{ fontSize: 12 }}>{record.summary}</Text>}
        </Space>
      ),
    },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: AnnouncementLevel) => <Tag color={announcementLevelColor[level]}>{announcementLevelText[level]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: AnnouncementStatus) => {
        const currentStatus = status || 'published';
        return <Tag color={announcementStatusColor[currentStatus]}>{announcementStatusText[currentStatus]}</Tag>;
      },
    },
    {
      title: '发布时间',
      dataIndex: 'publish_at',
      key: 'publish_at',
      width: 150,
      render: (value?: string | null) => <Text type="secondary">{formatDateTime(value)}</Text>,
    },
    {
      title: '过期时间',
      dataIndex: 'expire_at',
      key: 'expire_at',
      width: 150,
      render: (value?: string | null) => <Text type="secondary">{formatDateTime(value)}</Text>,
    },
    {
      title: '作者',
      dataIndex: 'author_name',
      key: 'author_name',
      width: 120,
      render: (value?: string | null) => value || '-',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 240,
      render: (_, record) => {
        const currentStatus = record.status || 'published';
        return (
          <Space size="small" wrap>
            <Button size="small" icon={<EditOutlined />} disabled={!announcementAdminAvailable} onClick={() => openEditAnnouncementModal(record)}>
              编辑
            </Button>
            {currentStatus !== 'published' ? (
              <Button size="small" type="primary" icon={<SendOutlined />} disabled={!announcementAdminAvailable} onClick={() => void handleAnnouncementStatusChange(record.id, 'publish')}>
                发布
              </Button>
            ) : (
              <Button size="small" icon={<EyeInvisibleOutlined />} disabled={!announcementAdminAvailable} onClick={() => void handleAnnouncementStatusChange(record.id, 'hide')}>
                隐藏
              </Button>
            )}
            <Popconfirm
              title="删除公告"
              description="删除后客户端将不再同步该公告，确认删除吗？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteAnnouncement(record.id)}
              disabled={!announcementAdminAvailable}
            >
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!announcementAdminAvailable}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  if (initialLoading) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!currentUser?.is_admin) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon message="无权限访问" description="只有管理员可以访问系统设置。" />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: `calc(100vh - ${footerSafeOffset}px)`,
        boxSizing: 'border-box',
        background: pageBackground,
        padding: 24,
        paddingBottom: footerSafeOffset,
      }}
    >
      <div style={{ maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      <Card
        bordered={false}
        style={{
          marginBottom: 24,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: `0 12px 32px ${token.colorFillSecondary}`,
        }}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ background: headerBackground, padding: '28px 32px', color: '#fff' }}>
          <Space direction="vertical" size={6}>
            <Space>
              <SettingOutlined />
              <Title level={3} style={{ color: '#fff', margin: 0 }}>系统设置</Title>
            </Space>
            <Paragraph style={{ color: 'rgba(255,255,255,0.88)', margin: 0 }}>
              仅管理员可见，用于维护 SMTP 发信能力、邮箱注册参数与服务端公告发布。
            </Paragraph>
          </Space>
        </div>
      </Card>

      <Tabs
        defaultActiveKey="smtp"
        items={[
          {
            key: 'smtp',
            label: (
              <Space>
                <MailOutlined />
                SMTP 配置
              </Space>
            ),
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave}>
                <Row gutter={24}>
                  <Col xs={24} xl={16}>
                    <Card title="邮件服务配置" bordered={false} style={{ borderRadius: 16 }}>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 20 }}
                        message="QQ 邮箱配置说明"
                        description="如果选择 QQ 邮箱，请使用完整 QQ 邮箱地址作为用户名，密码处填写 SMTP 授权码，而不是 QQ 登录密码。默认推荐 smtp.qq.com + SSL 465。"
                      />

                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_provider" label="邮件服务商" rules={[{ required: true, message: '请选择邮件服务商' }]}>
                            <Select onChange={handleProviderChange}>
                              <Option value="qq">QQ 邮箱</Option>
                              <Option value="custom">自定义 SMTP</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_host" label="SMTP 主机" rules={[{ required: true, message: '请输入 SMTP 主机' }]}>
                            <Input placeholder="例如：smtp.qq.com" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_port" label="SMTP 端口" rules={[{ required: true, message: '请输入 SMTP 端口' }]}>
                            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_username" label="SMTP 用户名" rules={[{ required: true, message: '请输入 SMTP 用户名' }]}>
                            <Input placeholder="完整邮箱地址" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_password" label="SMTP 密码 / 授权码" rules={[{ required: true, message: '请输入 SMTP 授权码' }]}>
                            <Input.Password placeholder="QQ 邮箱请填写授权码" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_from_email" label="发件人邮箱">
                            <Input placeholder="默认可与用户名一致" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_from_name" label="发件人名称" rules={[{ required: true, message: '请输入发件人名称' }]}>
                            <Input placeholder="MuMuAINovel" />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_use_ssl" label="启用 SSL" valuePropName="checked">
                            <Switch />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="smtp_use_tls" label="启用 TLS" valuePropName="checked">
                            <Switch />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>

                  <Col xs={24} xl={8}>
                    <Card title="注册与验证码策略" bordered={false} style={{ borderRadius: 16, marginBottom: 24 }}>
                      <Form.Item name="email_auth_enabled" label="启用邮箱认证" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item name="email_register_enabled" label="启用邮箱注册" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item name="verification_code_ttl_minutes" label="验证码有效期（分钟）" rules={[{ required: true, message: '请输入验证码有效期' }]}>
                        <InputNumber style={{ width: '100%' }} min={1} max={120} />
                      </Form.Item>
                      <Form.Item name="verification_resend_interval_seconds" label="验证码重发间隔（秒）" rules={[{ required: true, message: '请输入验证码重发间隔' }]}>
                        <InputNumber style={{ width: '100%' }} min={10} max={3600} />
                      </Form.Item>
                    </Card>

                    <Card title="操作" bordered={false} style={{ borderRadius: 16 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        <Input
                          value={testTargetEmail}
                          onChange={(e) => setTestTargetEmail(e.target.value)}
                          placeholder="请输入测试目标邮箱，如 123456@qq.com"
                        />
                        <Button icon={<ReloadOutlined />} onClick={loadData} block>
                          重新加载
                        </Button>
                        <Button icon={<SendOutlined />} loading={testing} onClick={handleTest} block>
                          发送测试邮件
                        </Button>
                        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} block onClick={() => form.submit()}>
                          保存系统设置
                        </Button>
                        <Alert
                          type="success"
                          showIcon
                          icon={<CheckCircleOutlined />}
                          message="建议使用 QQ 默认配置"
                          description={<Text type="secondary">先保存 SMTP 配置，再填写测试目标邮箱，点击“发送测试邮件”后由后端通过 SMTP 实际发信。</Text>}
                        />
                      </Space>
                    </Card>
                  </Col>
                </Row>
              </Form>
            ),
          },
          {
            key: 'announcements',
            label: (
              <Space>
                <BellOutlined />
                公告管理
              </Space>
            ),
            children: (
              <Card bordered={false} style={{ borderRadius: 16 }}>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Alert
                    type={announcementAdminAvailable ? 'info' : 'warning'}
                    showIcon
                    message={announcementAdminAvailable ? '公告发布入口' : '当前实例不是公告发布端'}
                    description={announcementAdminAvailable
                      ? '公告只能由服务端模式下的管理员发布、编辑、隐藏或删除；客户端实例会定时从服务端同步已发布且未过期的公告。'
                      : `公告发布仅在云端服务端可用。当前模式：${announcementStatus?.mode || '未知'}${announcementStatus?.cloud_url ? `，云端地址：${announcementStatus.cloud_url}` : ''}`}
                  />

                  <Row gutter={[16, 16]} justify="space-between" align="middle">
                    <Col xs={24} lg={14}>
                      <Space wrap>
                        <Button type="primary" icon={<PlusOutlined />} disabled={!announcementAdminAvailable} onClick={openCreateAnnouncementModal}>
                          新建公告
                        </Button>
                        <Button icon={<ReloadOutlined />} loading={announcementLoading || announcementStatusLoading} onClick={() => { void loadAnnouncementStatus(); void loadAnnouncements(); }}>
                          刷新列表
                        </Button>
                        {announcementStatus && (
                          <Tag color={announcementAdminAvailable ? 'green' : 'orange'}>
                            {announcementStatus.mode === 'server' ? '服务端模式' : '客户端模式'}
                          </Tag>
                        )}
                      </Space>
                    </Col>
                    <Col xs={24} lg={10} style={{ textAlign: 'right' }}>
                      <Space wrap>
                        <Search
                          allowClear
                          placeholder="搜索标题、摘要或正文"
                          style={{ width: 220 }}
                          onSearch={handleAnnouncementSearch}
                          disabled={!announcementAdminAvailable}
                        />
                        <Text type="secondary">状态</Text>
                        <Select<AnnouncementStatusFilter>
                          style={{ width: 120, textAlign: 'left' }}
                          value={announcementStatusFilter}
                          disabled={!announcementAdminAvailable}
                          onChange={(value) => {
                            setAnnouncementStatusFilter(value);
                            setAnnouncementPagination(prev => ({ ...prev, current: 1 }));
                          }}
                          options={[
                            { label: '全部', value: 'all' },
                            { label: '草稿', value: 'draft' },
                            { label: '已发布', value: 'published' },
                            { label: '已隐藏', value: 'hidden' },
                          ]}
                        />
                      </Space>
                    </Col>
                  </Row>

                  <Table<Announcement>
                    rowKey="id"
                    columns={announcementColumns}
                    dataSource={announcements}
                    loading={announcementLoading}
                    pagination={{
                      current: announcementPagination.current,
                      pageSize: announcementPagination.pageSize,
                      total: announcementPagination.total,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 条公告`,
                    }}
                    onChange={handleAnnouncementTableChange}
                    scroll={{ x: 1200 }}
                  />
                </Space>
              </Card>
            ),
          },
        ]}
      />
      </div>

      <Modal
        title={editingAnnouncement ? '编辑公告' : '新建公告'}
        open={announcementModalOpen}
        onCancel={closeAnnouncementModal}
        onOk={() => announcementForm.submit()}
        confirmLoading={announcementSaving}
        okText={editingAnnouncement ? '保存修改' : '创建公告'}
        cancelText="取消"
        width={1200}
        destroyOnClose
      >
        <Form form={announcementForm} layout="vertical" onFinish={handleSaveAnnouncement} preserve={false}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item
                name="title"
                label="公告标题"
                rules={[
                  { required: true, message: '请输入公告标题' },
                  { max: 120, message: '公告标题不能超过 120 个字符' },
                  { whitespace: true, message: '公告标题不能为空白字符' },
                ]}
              >
                <Input placeholder="请输入公告标题" maxLength={120} showCount />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="level" label="公告级别" rules={[{ required: true, message: '请选择公告级别' }]}>
                <Select>
                  <Option value="info">通知</Option>
                  <Option value="success">成功</Option>
                  <Option value="warning">警告</Option>
                  <Option value="error">重要</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="summary" label="摘要" rules={[{ max: 255, message: '摘要不能超过 255 个字符' }]}>
            <Input placeholder="可选，用于列表和时间轴的简短说明" maxLength={255} showCount />
          </Form.Item>

          <Card
            size="small"
            title="公告正文（Markdown）"
            style={{ marginBottom: 24, borderRadius: 12 }}
            extra={<Text type="secondary">支持标题、列表、引用、代码块、链接、粗体等 Markdown 语法</Text>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap>
                <Button size="small" onClick={() => appendMarkdownSnippet('## 小标题')}>标题</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('**重点内容**')}>粗体</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('- 列表项\n- 列表项')}>列表</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('> 引用说明')}>引用</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('[链接文字](https://example.com)')}>链接</Button>
                <Button size="small" onClick={() => appendMarkdownSnippet('```\n代码内容\n```')}>代码块</Button>
              </Space>

              <Row gutter={16}>
                <Col xs={24} lg={12}>
                  <Form.Item
                    name="content"
                    label="编辑"
                    rules={[
                      { required: true, message: '请输入公告正文' },
                      { whitespace: true, message: '公告正文不能为空白字符' },
                    ]}
                    style={{ marginBottom: 0 }}
                  >
                    <TextArea
                      style={{ height: 420, resize: 'vertical' }}
                      placeholder={[
                        '请输入 Markdown 公告内容，例如：',
                        '## 更新说明',
                        '- 支持列表',
                        '- 支持 **重点内容**',
                        '> 支持引用说明',
                        '[查看详情](https://example.com)',
                      ].join('\n')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={12}>
                  <Text strong>预览</Text>
                  <div
                    style={{
                      marginTop: 8,
                      minHeight: 336,
                      maxHeight: 420,
                      overflow: 'auto',
                      padding: 16,
                      borderRadius: 10,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: token.colorFillQuaternary,
                    }}
                  >
                    <MarkdownRenderer content={announcementContent} />
                  </div>
                </Col>
              </Row>
            </Space>
          </Card>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="status" label="发布状态" rules={[{ required: true, message: '请选择发布状态' }]}>
                <Select>
                  <Option value="draft">草稿</Option>
                  <Option value="published">立即发布</Option>
                  <Option value="hidden">隐藏</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="publish_at" label="发布时间">
                <DatePicker style={{ width: '100%' }} showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="expire_at"
                label="过期时间"
                dependencies={['publish_at']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs | null) {
                      const publishAt = getFieldValue('publish_at') as Dayjs | null;
                      if (!value || !publishAt || value.isAfter(publishAt)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('过期时间必须晚于发布时间'));
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: '100%' }} showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="pinned" label="置顶公告" valuePropName="checked" extra="置顶公告会优先展示在客户端公告时间轴顶部。">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
