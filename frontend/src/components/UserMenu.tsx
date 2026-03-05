import { useState, useEffect } from 'react';
import { Dropdown, Avatar, Space, Typography, message, Modal, Form, Input, Button, Switch } from 'antd';
import { UserOutlined, LogoutOutlined, TeamOutlined, CrownOutlined, LockOutlined, GiftOutlined } from '@ant-design/icons';
import { authApi } from '../services/api';
import type { User } from '../types';
import type { MenuProps } from 'antd';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

interface UserMenuProps {
  /** 是否总是显示完整信息（用于移动端侧边栏） */
  showFullInfo?: boolean;
}

export default function UserMenu({ showFullInfo = false }: UserMenuProps) {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm] = Form.useForm();
  const [changingPassword, setChangingPassword] = useState(false);
  const [springFestivalEnabled, setSpringFestivalEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('spring-festival-enabled');
    return saved === null ? true : saved === 'true';
  });

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);
    } catch (error) {
      console.error('获取用户信息失败:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      message.success('已退出登录');
      window.location.href = '/login';
    } catch (error) {
      console.error('退出登录失败:', error);
      message.error('退出登录失败');
    }
  };

  const handleShowUserManagement = () => {
    if (!currentUser?.is_admin) {
      message.warning('只有管理员可以访问用户管理');
      return;
    }
    navigate('/user-management');
  };

  const handleChangePassword = async (values: { oldPassword: string; newPassword: string }) => {
    try {
      setChangingPassword(true);
      await authApi.setPassword(values.newPassword);
      message.success('密码修改成功');
      setShowChangePassword(false);
      changePasswordForm.resetFields();
    } catch (error: unknown) {
      console.error('修改密码失败:', error);
      const err = error as { response?: { data?: { detail?: string } } };
      message.error(err.response?.data?.detail || '修改密码失败');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleToggleSpringFestival = (enabled: boolean) => {
    setSpringFestivalEnabled(enabled);
    localStorage.setItem('spring-festival-enabled', String(enabled));
    window.dispatchEvent(new CustomEvent('spring-festival-toggle', { detail: enabled }));
    message.success(enabled ? '已开启新年特效' : '已关闭新年特效');
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '8px 0' }}>
          <Text strong>{currentUser?.display_name || currentUser?.username}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Trust Level: {currentUser?.trust_level}
            {currentUser?.is_admin && ' · 管理员'}
          </Text>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider',
    },
    ...(currentUser?.is_admin ? [
      {
        key: 'user-management',
        icon: <TeamOutlined />,
        label: '用户管理',
        onClick: handleShowUserManagement,
      },
      {
        type: 'divider' as const,
      }
    ] : []),
    {
      key: 'change-password',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => setShowChangePassword(true),
    },
    {
      type: 'divider',
    },
    {
      key: 'spring-festival-toggle',
      icon: <GiftOutlined />,
      label: '新年特效',
      extra: (
        <Switch
          size="small"
          checked={springFestivalEnabled}
          onClick={(_checked, e) => e?.stopPropagation()}
          onChange={handleToggleSpringFestival}
        />
      ),
      onClick: ({ domEvent }) => domEvent.stopPropagation(),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  if (!currentUser) {
    return null;
  }

  return (
    <>
      <Dropdown menu={{ items: menuItems }} placement={showFullInfo ? 'topLeft' : 'bottomRight'}>
        <div
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 16px',
            background: 'rgba(255, 255, 255, 0.6)', // 保持半透明以配合 Backdrop
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            borderRadius: 24,
            border: '1px solid var(--color-border)',
            transition: 'all 0.3s ease',
            boxShadow: 'var(--shadow-card)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-bg-container)'; // 悬浮时变实
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-elevated)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-card)';
          }}
        >
          <div style={{ position: 'relative' }}>
            <Avatar
              src={currentUser.avatar_url}
              icon={<UserOutlined />}
              size={40}
              style={{
                backgroundColor: 'var(--color-primary)',
                border: '3px solid #fff',
                boxShadow: 'var(--shadow-card)',
              }}
            />
            {currentUser.is_admin && (
              <div style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 18,
                height: 18,
                background: 'linear-gradient(135deg, #ffd700 0%, #ffaa00 100%)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}>
                <CrownOutlined style={{ fontSize: 9, color: '#fff' }} />
              </div>
            )}
          </div>
          <Space direction="vertical" size={0} style={{ display: (window.innerWidth <= 768 && !showFullInfo) ? 'none' : 'flex' }}>
            <Text strong style={{
              color: 'var(--color-text-primary)',
              fontSize: 14,
              lineHeight: '20px',
            }}>
              {currentUser.display_name || currentUser.username}
            </Text>
            <Text style={{
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              lineHeight: '18px',
            }}>
              {currentUser.is_admin ? '👑 管理员' : `🎖️ Trust Level ${currentUser.trust_level}`}
            </Text>
          </Space>
        </div>
      </Dropdown>

      <Modal
        title="修改密码"
        open={showChangePassword}
        onCancel={() => {
          setShowChangePassword(false);
          changePasswordForm.resetFields();
        }}
        footer={null}
        width={480}
        centered
      >
        <Form
          form={changePasswordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          autoComplete="off"
        >
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6个字符' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入新密码（至少6个字符）"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            label="确认密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请再次输入新密码"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => {
                setShowChangePassword(false);
                changePasswordForm.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={changingPassword}>
                确认修改
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
