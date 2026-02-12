import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Button, Drawer, Modal, Select, Space, Typography, message } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  TeamOutlined,
  BookOutlined,
  // ToolOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ApartmentOutlined,
  BankOutlined,
  EditOutlined,
  FundOutlined,
  HeartOutlined,
  TrophyOutlined,
  BulbOutlined,
  CloudOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { useCharacterSync, useOutlineSync, useChapterSync } from '../store/hooks';
import { projectApi, skillsApi } from '../services/api';
import type { SkillSpecResponse } from '../types';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// 判断是否为移动端
const isMobile = () => window.innerWidth <= 768;

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [mobile, setMobile] = useState(isMobile());

  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillSpecResponse[]>([]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setMobile(isMobile());
      if (!isMobile()) {
        setDrawerVisible(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const {
    currentProject,
    setCurrentProject,
    clearProjectData,
    loading,
    setLoading,
    outlines,
    characters,
    chapters,
  } = useStore();

  // 使用同步 hooks
  const { refreshCharacters } = useCharacterSync();
  const { refreshOutlines } = useOutlineSync();
  const { refreshChapters } = useChapterSync();

  useEffect(() => {
    const loadProjectData = async (id: string) => {
      try {
        setLoading(true);
        // 加载项目基本信息
        const project = await projectApi.getProject(id);
        setCurrentProject(project);

        // 并行加载其他数据
        await Promise.all([
          refreshOutlines(id),
          refreshCharacters(id),
          refreshChapters(id),
        ]);
      } catch (error) {
        console.error('加载项目数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    if (projectId) {
      loadProjectData(projectId);
    }

    return () => {
      clearProjectData();
    };
  }, [projectId, clearProjectData, setLoading, setCurrentProject, refreshOutlines, refreshCharacters, refreshChapters]);

  const activeProjectSkillKey = currentProject?.active_skill_key ?? null;

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await skillsApi.list();
      setSkills(res.items || []);
    } finally {
      setSkillsLoading(false);
    }
  };

  const openSkillModal = async () => {
    setSkillModalOpen(true);
    if (!skills.length) {
      await loadSkills();
    }
  };

  const updateProjectSkill = async (next: string) => {
    if (!projectId) return;
    const nextKey = next === '__none__' ? null : next;
    setSkillsLoading(true);
    try {
      const updated = await projectApi.updateProject(projectId, { active_skill_key: nextKey });
      setCurrentProject(updated);
      message.success(nextKey ? '已设置项目技能（覆盖用户技能）' : '已清空项目技能（回退到用户技能）');
    } finally {
      setSkillsLoading(false);
    }
  };

  // 移除事件监听，避免无限循环
  // Hook 内部已经更新了 store，不需要再次刷新

  const menuItems = [
    {
      key: 'sponsor',
      icon: <HeartOutlined />,
      label: <Link to={`/project/${projectId}/sponsor`}>赞助支持</Link>,
    },
    {
      key: 'world-setting',
      icon: <GlobalOutlined />,
      label: <Link to={`/project/${projectId}/world-setting`}>世界设定</Link>,
    },
    {
      key: 'careers',
      icon: <TrophyOutlined />,
      label: <Link to={`/project/${projectId}/careers`}>职业管理</Link>,
    },
    {
      key: 'characters',
      icon: <TeamOutlined />,
      label: <Link to={`/project/${projectId}/characters`}>角色管理</Link>,
    },
    {
      key: 'relationships',
      icon: <ApartmentOutlined />,
      label: <Link to={`/project/${projectId}/relationships`}>关系管理</Link>,
    },
    {
      key: 'organizations',
      icon: <BankOutlined />,
      label: <Link to={`/project/${projectId}/organizations`}>组织管理</Link>,
    },
    {
      key: 'outline',
      icon: <FileTextOutlined />,
      label: <Link to={`/project/${projectId}/outline`}>大纲管理</Link>,
    },
    {
      key: 'chapters',
      icon: <BookOutlined />,
      label: <Link to={`/project/${projectId}/chapters`}>章节管理</Link>,
    },
    {
      key: 'chapter-analysis',
      icon: <FundOutlined />,
      label: <Link to={`/project/${projectId}/chapter-analysis`}>剧情分析</Link>,
    },
    {
      key: 'foreshadows',
      icon: <BulbOutlined />,
      label: <Link to={`/project/${projectId}/foreshadows`}>伏笔管理</Link>,
    },
    {
      key: 'writing-styles',
      icon: <EditOutlined />,
      label: <Link to={`/project/${projectId}/writing-styles`}>写作风格</Link>,
    },
    {
      key: 'prompt-workshop',
      icon: <CloudOutlined />,
      label: <Link to={`/project/${projectId}/prompt-workshop`}>提示词工坊</Link>,
    },
    // {
    //   key: 'polish',
    //   icon: <ToolOutlined />,
    //   label: <Link to={`/project/${projectId}/polish`}>AI去味</Link>,
    // },
  ];

  // 根据当前路径动态确定选中的菜单项
  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/world-setting')) return 'world-setting';
    if (path.includes('/careers')) return 'careers';
    if (path.includes('/relationships')) return 'relationships';
    if (path.includes('/organizations')) return 'organizations';
    if (path.includes('/outline')) return 'outline';
    if (path.includes('/characters')) return 'characters';
    if (path.includes('/chapter-analysis')) return 'chapter-analysis';
    if (path.includes('/foreshadows')) return 'foreshadows';
    if (path.includes('/chapters')) return 'chapters';
    if (path.includes('/writing-styles')) return 'writing-styles';
    if (path.includes('/prompt-workshop')) return 'prompt-workshop';
    if (path.includes('/sponsor')) return 'sponsor';
    // if (path.includes('/polish')) return 'polish';
    return 'sponsor'; // 默认选中赞助支持
  }, [location.pathname]);

  if (loading || !currentProject) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 渲染菜单内容
  const renderMenu = () => (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden'
    }}>
      <Menu
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={[selectedKey]}
        style={{
          borderRight: 0,
          paddingTop: '16px'
        }}
        items={menuItems}
        onClick={() => mobile && setDrawerVisible(false)}
      />
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <Header style={{
        background: 'var(--color-primary)',
        padding: mobile ? '0 12px' : '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        boxShadow: 'var(--shadow-header)',
        height: mobile ? 56 : 70
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 1 }}>
          <Button
            type="text"
            icon={mobile ? <MenuUnfoldOutlined /> : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
            onClick={() => mobile ? setDrawerVisible(true) : setCollapsed(!collapsed)}
            style={{
              fontSize: mobile ? '18px' : '20px',
              color: '#fff',
              width: mobile ? '36px' : '40px',
              height: mobile ? '36px' : '40px'
            }}
          />
          {!mobile && (
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/')}
              style={{
                fontSize: '16px',
                color: '#fff',
                height: '40px',
                padding: '0 16px'
              }}
            >
              返回主页
            </Button>
          )}
        </div>

        <h2 style={{
          margin: 0,
          color: '#fff',
          fontSize: mobile ? '16px' : '24px',
          fontWeight: 600,
          textShadow: '0 2px 4px rgba(0,0,0,0.1)',
          position: mobile ? 'static' : 'absolute',
          left: mobile ? 'auto' : '50%',
          transform: mobile ? 'none' : 'translateX(-50%)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: mobile ? 1 : 'none',
          textAlign: mobile ? 'center' : 'left',
          paddingLeft: mobile ? '8px' : '0',
          paddingRight: mobile ? '8px' : '0'
        }}>
          {currentProject.title}
        </h2>

        {mobile && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            style={{
              fontSize: '14px',
              color: '#fff',
              height: '36px',
              padding: '0 8px',
              zIndex: 1
            }}
          >
            主页
          </Button>
        )}

        {!mobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', zIndex: 1 }}>
            <div style={{ display: 'flex', gap: '16px' }}>
              {[
                { label: '大纲', value: outlines.length, unit: '条' },
                { label: '角色', value: characters.length, unit: '个' },
                { label: '章节', value: chapters.length, unit: '章' },
                { label: '已写', value: currentProject.current_words, unit: '字' },
              ].map((item, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                    borderRadius: '28px',
                    minWidth: '56px',
                    height: '56px',
                    padding: '0 12px',
                    boxShadow: 'inset 0 0 15px rgba(255, 255, 255, 0.15), 0 4px 10px rgba(0, 0, 0, 0.1)',
                    cursor: 'default',
                    transition: 'all 0.3s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)';
                    e.currentTarget.style.boxShadow = 'inset 0 0 20px rgba(255, 255, 255, 0.25), 0 8px 16px rgba(0, 0, 0, 0.15)';
                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                    e.currentTarget.style.boxShadow = 'inset 0 0 15px rgba(255, 255, 255, 0.15), 0 4px 10px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  <span style={{
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.9)',
                    marginBottom: '2px',
                    lineHeight: 1
                  }}>
                    {item.label}
                  </span>
                  <span style={{
                    fontSize: '15px',
                    fontWeight: '600',
                    color: '#fff',
                    lineHeight: 1,
                    fontFamily: 'Monaco, monospace'
                  }}>
                    {item.value > 10000 ? (item.value / 10000).toFixed(1) + 'w' : item.value}
                    <span style={{ fontSize: '10px', marginLeft: '2px', opacity: 0.8 }}>{item.unit}</span>
                  </span>
                </div>
              ))}
            </div>

            <Button
              icon={<SettingOutlined />}
              onClick={openSkillModal}
              style={{
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                background: 'rgba(255, 255, 255, 0.12)',
              }}
            >
              项目技能
            </Button>
          </div>
        )}
      </Header>

      <Modal
        title="项目技能（覆盖用户技能）"
        open={skillModalOpen}
        onCancel={() => setSkillModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Select
            value={activeProjectSkillKey ?? '__none__'}
            onChange={updateProjectSkill}
            loading={skillsLoading}
            style={{ width: '100%' }}
            options={[
              { value: '__none__', label: '不设置（使用用户技能）' },
              ...skills.map((s) => ({ value: s.skill_key, label: s.name })),
            ]}
            showSearch
            optionFilterProp="label"
          />
          <Text type="secondary">
            设置后，该项目下的 AI 调用会优先使用项目技能；如不设置，将回退使用“设置页”中的用户技能。
          </Text>
          <Text type="secondary">
            技能列表来自技能规范同步结果（.opencode/skills）。如果看不到新技能，请先在“设置-技能”中点击同步。
          </Text>
        </Space>
      </Modal>

      <Layout style={{ marginTop: mobile ? 56 : 70 }}>
        {mobile ? (
          <Drawer
            title="导航菜单"
            placement="left"
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
            width={280}
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
          >
            {renderMenu()}
          </Drawer>
        ) : (
          <Sider
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            trigger={null}
            width={220}
            collapsedWidth={60}
            className="modern-sider"
            style={{
              position: 'fixed',
              left: 0,
              top: 70,
              bottom: 0,
              overflow: 'hidden',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              height: 'calc(100vh - 70px)'
            }}
          >
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {renderMenu()}
            </div>
          </Sider>
        )}

        <Layout style={{
          marginLeft: mobile ? 0 : (collapsed ? 60 : 220),
          transition: 'all 0.2s'
        }}>
          <Content
            style={{
              background: 'var(--color-bg-base)',
              padding: mobile ? 12 : 24,
              height: mobile ? 'calc(100vh - 56px)' : 'calc(100vh - 70px)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{
              background: 'var(--color-bg-container)',
              padding: mobile ? 12 : 24,
              borderRadius: mobile ? '8px' : '12px',
              boxShadow: 'var(--shadow-card)',
              height: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <Outlet />
            </div>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}
