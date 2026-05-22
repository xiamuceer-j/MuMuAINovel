import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Button, Modal, message, Spin, Space, Tag, Typography, Upload, Checkbox, Tooltip, Drawer, Menu, theme, Badge } from 'antd';
import { EditOutlined, BookOutlined, CalendarOutlined, FileTextOutlined, TrophyOutlined, SettingOutlined, UploadOutlined, ApiOutlined, FileSearchOutlined, MenuUnfoldOutlined, MenuFoldOutlined, BulbOutlined, MoonOutlined, DesktopOutlined, MailOutlined, BellOutlined } from '@ant-design/icons';
import { authApi, projectApi } from '../services/api';
import { useStore } from '../store';
import { useProjectSync } from '../store/hooks';
import { eventBus, EventNames } from '../store/eventBus';
import type { ReactNode } from 'react';
import type { Project, User } from '../types';
import UserMenu from '../components/UserMenu';
import ChangelogFloatingButton from '../components/ChangelogFloatingButton';
import ThemeSwitch from '../components/ThemeSwitch';
import { useThemeMode } from '../theme/useThemeMode';
import SettingsPage from './Settings';
import SystemSettingsPage from './SystemSettings';
import MCPPluginsPage from './MCPPlugins';
import PromptTemplates from './PromptTemplates';
import BookImport from './BookImport';
import BookshelfPage from './BookshelfPage';
import { getStoredSidebarCollapsed, setStoredSidebarCollapsed } from '../utils/sidebarState';
import AnnouncementTimelineModal from '../components/AnnouncementTimelineModal';
import { useAnnouncements } from '../hooks/useAnnouncements';

const { Text } = Typography;

/**
 * 格式化字数显示
 * @param count 字数
 * @returns 格式化后的字符串，如 "1.2K", "3.5W", "1.2M"
 */
const formatWordCount = (count: number): string => {
  if (count < 1000) {
    return count.toString();
  } else if (count < 10000) {
    // 1K - 9.9K
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  } else if (count < 1000000) {
    // 1W - 99.9W (万)
    return (count / 10000).toFixed(1).replace(/\.0$/, '') + 'W';
  } else {
    // 1M+ (百万)
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
};

type ProjectListView = 'projects' | 'settings' | 'system-settings' | 'mcp' | 'prompts' | 'book-import';

const parseViewFromSearch = (search: string): ProjectListView => {
  const view = new URLSearchParams(search).get('view');
  if (view === 'settings' || view === 'system-settings' || view === 'mcp' || view === 'prompts' || view === 'book-import' || view === 'projects') {
    return view;
  }
  return 'projects';
};

export default function ProjectList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projects, loading } = useStore();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [announcementVisible, setAnnouncementVisible] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [modal, contextHolder] = Modal.useModal();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showApiTip, setShowApiTip] = useState(true);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [exportOptions, setExportOptions] = useState({
    includeWritingStyles: true,
    includeGenerationHistory: false,
    includeCareers: true,
    includeMemories: false,
    includePlotAnalysis: false,
  });
  const { refreshProjects, deleteProject } = useProjectSync();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const { token } = theme.useToken();
  const alphaColor = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, transparent)`;

  const { announcements, loading: announcementsLoading, hasUnread: hasUnreadAnnouncements, refresh: refreshAnnouncements, markAllRead: markAllAnnouncementsRead } = useAnnouncements();

  const activeView = useMemo<ProjectListView>(() => parseViewFromSearch(location.search), [location.search]);
  const cycleThemeMode = () => {
    const nextMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setMode(nextMode);
  };
  const collapsedThemeIcon = mode === 'light' ? <BulbOutlined /> : mode === 'dark' ? <MoonOutlined /> : <DesktopOutlined />;

  const changeView = useCallback((view: ProjectListView) => {
    const searchParams = new URLSearchParams(location.search);
    if (view === 'projects') {
      searchParams.delete('view');
    } else {
      searchParams.set('view', view);
    }

    const search = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : '',
      },
      { replace: false }
    );
  }, [location.pathname, location.search, navigate]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 处理切换到 MCP 视图的事件
  const handleSwitchToMcp = useCallback(() => {
    changeView('mcp');
  }, [changeView]);

  useEffect(() => {
    refreshProjects();
    authApi.getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
    
    // 监听切换到 MCP 视图的事件
    eventBus.on(EventNames.SWITCH_TO_MCP_VIEW, handleSwitchToMcp);
    
    return () => {
      eventBus.off(EventNames.SWITCH_TO_MCP_VIEW, handleSwitchToMcp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSwitchToMcp]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshProjects();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setStoredSidebarCollapsed(collapsed);
  }, [collapsed]);

  const handleDelete = (id: string) => {
    const isMobile = window.innerWidth <= 768;
    modal.confirm({
      title: '确认删除',
      content: '删除项目将同时删除所有相关数据，此操作不可恢复。确定要删除吗？',
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      centered: true,
      ...(isMobile && {
        style: { top: 'auto' }
      }),
      onOk: async () => {
        try {
          await deleteProject(id);
          message.success('项目删除成功');
        } catch {
          message.error('删除项目失败');
        }
      },
    });
  };

  const handleEnterProject = async (project: Project) => {
    if (project.wizard_status === 'incomplete') {
      navigate(`/wizard?project_id=${project.id}`);
    } else {
      navigate(`/project/${project.id}`);
    }
  };

  const handleGenerateCover = async (project: Project, overwrite: boolean = true) => {
    try {
      message.loading({ content: `正在为《${project.title}》生成封面...`, key: `cover-${project.id}` });
      await projectApi.generateCover(project.id, overwrite);
      message.success({ content: `《${project.title}》封面生成成功`, key: `cover-${project.id}` });
      await refreshProjects();
    } catch (error) {
      console.error('生成封面失败:', error);
      message.error({ content: `《${project.title}》封面生成失败`, key: `cover-${project.id}` });
    }
  };

  const handleDownloadCover = async (project: Project) => {
    try {
      await projectApi.downloadCover(project.id, `${project.title}-cover.png`);
      message.success(`《${project.title}》封面已开始下载`);
    } catch (error) {
      console.error('下载封面失败:', error);
      message.error('下载封面失败');
    }
  };

  const getStatusTag = (status: string) => {
    const statusConfig: Record<string, { color: string; text: string; icon: ReactNode }> = {
      planning: { color: 'blue', text: '规划', icon: <CalendarOutlined /> },
      writing: { color: 'green', text: '创作', icon: <EditOutlined /> },
      revising: { color: 'orange', text: '修订', icon: <FileTextOutlined /> },
      completed: { color: 'purple', text: '已完结', icon: <TrophyOutlined /> },
    };
    const config = statusConfig[status] || statusConfig.planning;
    return (
      <Tag color={config.color} icon={config.icon} style={{ margin: 0, borderRadius: 4, flexShrink: 0 }}>
        {config.text}
      </Tag>
    );
  };

  // 根据进度获取显示状态（进度达到100%时显示已完结）
  const getDisplayStatus = (status: string, progress: number): string => {
    if (progress >= 100) {
      return 'completed';
    }
    return status;
  };

  const getProgress = (current: number, target: number) => {
    if (!target) return 0;
    return Math.min(Math.round((current / target) * 100), 100);
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return token.colorSuccess;
    if (progress >= 50) return token.colorPrimary;
    if (progress >= 20) return token.colorWarning;
    return token.colorError;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const totalWords = projects.reduce((sum, p) => sum + (p.current_words || 0), 0);
  const activeProjects = projects.filter(p => p.status === 'writing').length;
  // 计算已完结项目数（进度>=100%或状态为completed）
  const completedProjects = projects.filter(p => {
    const progress = getProgress(p.current_words || 0, p.target_words || 0);
    return progress >= 100 || p.status === 'completed';
  }).length;

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setValidationResult(null);
    try {
      setValidating(true);
      const result = await projectApi.validateImportFile(file);
      setValidationResult(result);
      if (!result.valid) {
        message.error('文件验证失败');
      }
    } catch (error) {
      console.error('验证失败:', error);
      message.error('文件验证失败');
    } finally {
      setValidating(false);
    }
    return false;
  };

  const handleImport = async () => {
    if (!selectedFile || !validationResult?.valid) {
      message.warning('请选择有效的导入文件');
      return;
    }
    try {
      setImporting(true);
      const result = await projectApi.importProject(selectedFile);
      if (result.success) {
        message.success(`项目导入成功！${result.message}`);
        setImportModalVisible(false);
        setSelectedFile(null);
        setValidationResult(null);
        await refreshProjects();
        if (result.project_id) {
          navigate(`/project/${result.project_id}`);
        }
      } else {
        message.error(result.message || '导入失败');
      }
    } catch (error) {
      console.error('导入失败:', error);
      message.error('导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const handleCloseImportModal = () => {
    setImportModalVisible(false);
    setSelectedFile(null);
    setValidationResult(null);
  };

  const handleOpenExportModal = () => {
    setExportModalVisible(true);
    setSelectedProjectIds([]);
  };

  const exportableProjects = projects;

  const handleCloseExportModal = () => {
    setExportModalVisible(false);
    setSelectedProjectIds([]);
  };

  const handleToggleProject = (projectId: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleToggleAll = () => {
    if (selectedProjectIds.length === exportableProjects.length) {
      setSelectedProjectIds([]);
    } else {
      setSelectedProjectIds(exportableProjects.map(p => p.id));
    }
  };

  const handleExport = async () => {
    if (selectedProjectIds.length === 0) {
      message.warning('请至少选择一个项目');
      return;
    }
    try {
      setExporting(true);
      if (selectedProjectIds.length === 1) {
        const projectId = selectedProjectIds[0];
        const project = projects.find(p => p.id === projectId);
        await projectApi.exportProjectData(projectId, {
          include_generation_history: exportOptions.includeGenerationHistory,
          include_writing_styles: exportOptions.includeWritingStyles,
          include_careers: exportOptions.includeCareers,
          include_memories: exportOptions.includeMemories,
          include_plot_analysis: exportOptions.includePlotAnalysis
        });
        message.success(`项目 "${project?.title}" 导出成功`);
      } else {
        let successCount = 0;
        let failCount = 0;
        for (const projectId of selectedProjectIds) {
          try {
            await projectApi.exportProjectData(projectId, {
              include_generation_history: exportOptions.includeGenerationHistory,
              include_writing_styles: exportOptions.includeWritingStyles,
              include_careers: exportOptions.includeCareers,
              include_memories: exportOptions.includeMemories,
              include_plot_analysis: exportOptions.includePlotAnalysis
            });
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`导出项目 ${projectId} 失败:`, error);
            failCount++;
          }
        }
        if (failCount === 0) {
          message.success(`成功导出 ${successCount} 个项目`);
        } else {
          message.warning(`导出完成：成功 ${successCount} 个，失败 ${failCount} 个`);
        }
      }
      handleCloseExportModal();
    } catch (error) {
      console.error('导出失败:', error);
      message.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const isMobile = window.innerWidth <= 768;
  const headerHeight = isMobile ? 56 : 70;
  const expandedSiderWidth = 220;
  const collapsedSiderWidth = 60;
  const desktopSiderWidth = collapsed ? collapsedSiderWidth : expandedSiderWidth;

  const currentViewTitle = activeView === 'projects'
    ? '我的书架'
    : activeView === 'prompts'
      ? '提示词模板'
      : activeView === 'book-import'
        ? '拆书导入'
        : activeView === 'mcp'
          ? 'MCP 插件'
          : activeView === 'system-settings'
            ? '系统设置'
            : 'API 设置';

  const isAdmin = !!currentUser?.is_admin;

  const sideMenuItems = [
    {
      key: 'projects',
      icon: <BookOutlined />,
      label: '我的书架',
    },
    {
      type: 'group' as const,
      label: '创作工具',
      children: [
        {
          key: 'book-import',
          icon: <UploadOutlined />,
          label: '拆书导入',
        },
        {
          key: 'mcp',
          icon: <ApiOutlined />,
          label: 'MCP 插件',
        },
        {
          key: 'prompts',
          icon: <FileSearchOutlined />,
          label: '提示词管理',
        },
      ],
    },
    {
      type: 'group' as const,
      label: '系统设置',
      children: [
        {
          key: 'settings',
          icon: <SettingOutlined />,
          label: 'API 设置',
        },
        ...(isAdmin ? [{
          key: 'system-settings',
          icon: <MailOutlined />,
          label: '系统设置',
        }] : []),
        {
          key: 'mumu-api',
          icon: <ApiOutlined />,
          label: 'MuMuのAPI',
        },
      ],
    },
  ];

  const sideMenuItemsCollapsed = [
    {
      key: 'projects',
      icon: <BookOutlined />,
      label: '我的书架',
    },
    {
      key: 'book-import',
      icon: <UploadOutlined />,
      label: '拆书导入',
    },
    {
      key: 'mcp',
      icon: <ApiOutlined />,
      label: 'MCP 插件',
    },
    {
      key: 'prompts',
      icon: <FileSearchOutlined />,
      label: '提示词管理',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'API 设置',
    },
    ...(isAdmin ? [{
      key: 'system-settings',
      icon: <MailOutlined />,
      label: '系统设置',
    }] : []),
    {
      key: 'mumu-api',
      icon: <ApiOutlined />,
      label: 'MuMuのAPI',
    },
  ];

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: token.colorBgLayout,
      overflow: 'hidden'
    }}>
      {contextHolder}

      {!isMobile && (
        <div
          style={{
          width: desktopSiderWidth,
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          height: '100vh',
          overflow: 'hidden',
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: `4px 0 16px ${alphaColor(token.colorText, 0.06)}`,
          zIndex: 1000
        }}>
          <div style={{
            height: 70,
            display: 'flex',
            alignItems: 'center',
            padding: collapsed ? 0 : '0 12px',
            background: token.colorPrimary,
            flexShrink: 0,
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: 8
          }}>
            {collapsed ? (
              <Button
                type="text"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setCollapsed(false)}
                style={{
                  color: token.colorWhite,
                  width: '100%',
                  height: '100%',
                  padding: 0,
                  borderRadius: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              />
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{
                    width: 30,
                    height: 30,
                    background: alphaColor(token.colorWhite, 0.2),
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: token.colorWhite,
                    fontSize: 16,
                    backdropFilter: 'blur(4px)'
                  }}>
                    <BookOutlined />
                  </div>
                  <span style={{
                    color: token.colorWhite,
                    fontWeight: 600,
                    fontSize: 15,
                    fontFamily: token.fontFamily,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    MuMuAINovel
                  </span>
                </div>
                <Button
                  type="text"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setCollapsed(true)}
                  style={{
                    color: token.colorWhite,
                    width: 32,
                    height: 32,
                    padding: 0,
                    flexShrink: 0
                  }}
                />
              </>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Menu
              mode="inline"
              inlineCollapsed={collapsed}
              selectedKeys={[activeView]}
              style={{ borderRight: 0, paddingTop: 12, width: '100%' }}
              onClick={({ key }) => {
                if (key === 'mumu-api') {
                  window.open('https://api.mumuverse.space/register?aff=4NN8', '_blank', 'noopener,noreferrer');
                  return;
                }
                changeView(key as ProjectListView);
              }}
              items={collapsed ? sideMenuItemsCollapsed : sideMenuItems}
            />
          </div>

          <div style={{
            padding: collapsed ? '12px 8px' : 16,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0
          }}>
            {collapsed ? (
              <Space direction="vertical" style={{ width: '100%', alignItems: 'center' }} size={10}>
                <Button
                  type="text"
                  icon={collapsedThemeIcon}
                  onClick={cycleThemeMode}
                  title={`主题模式：${mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}（点击切换）`}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: alphaColor(token.colorBgContainer, 0.65),
                    border: `1px solid ${token.colorBorder}`,
                    color: token.colorTextSecondary,
                  }}
                />
                <UserMenu compact />
              </Space>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: token.colorTextTertiary }}>
                  <span>主题模式</span>
                  <span>{resolvedMode === 'dark' ? '深色' : '浅色'}</span>
                </div>
                <ThemeSwitch block />
                <UserMenu />
              </Space>
            )}
          </div>
        </div>
      )}

      <div style={{
        background: token.colorPrimary,
        padding: isMobile ? '0 12px' : '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        left: isMobile ? 0 : desktopSiderWidth,
        right: 0,
        zIndex: 1000,
        boxShadow: `0 2px 10px ${alphaColor(token.colorText, 0.16)}`,
        height: headerHeight,
        flexShrink: 0,
        transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden'
      }}>
        {isMobile ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="text"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setDrawerVisible(true)}
                style={{
                  fontSize: 18,
                  color: token.colorWhite,
                  width: 36,
                  height: 36
                }}
              />
            </div>

            <h2 style={{
              margin: 0,
              color: token.colorWhite,
              fontSize: 16,
              fontWeight: 600,
              textShadow: `0 2px 4px ${alphaColor(token.colorText, 0.2)}`,
              flex: 1,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              paddingRight: 36
            }}>
              {currentViewTitle}
            </h2>

            <Badge dot={hasUnreadAnnouncements} offset={[-4, 4]}>
              <Button
                type="text"
                icon={<BellOutlined />}
                onClick={() => setAnnouncementVisible(true)}
                style={{
                  fontSize: 18,
                  color: token.colorWhite,
                  width: 36,
                  height: 36
                }}
              />
            </Badge>
          </>
        ) : (
          <>
            <div style={{ width: 40, zIndex: 1 }} />

            <h2 style={{
              margin: 0,
              color: token.colorWhite,
              fontSize: '24px',
              fontWeight: 600,
              textShadow: `0 2px 4px ${alphaColor(token.colorText, 0.2)}`,
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '45%'
            }}>
              {currentViewTitle}
            </h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, zIndex: 1 }}>
              <Badge dot={hasUnreadAnnouncements} offset={[-4, 4]}>
                <Button
                  type="text"
                  icon={<BellOutlined />}
                  onClick={() => setAnnouncementVisible(true)}
                  style={{
                    color: token.colorWhite,
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: alphaColor(token.colorWhite, 0.12),
                    border: `1px solid ${alphaColor(token.colorWhite, 0.18)}`,
                  }}
                  title="系统公告"
                />
              </Badge>
              {activeView === 'projects' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  {projects.length > 0 && (
                    <div style={{ display: 'flex', gap: '16px' }}>
                      {[
                        { label: '创作中', value: activeProjects, unit: '本' },
                        { label: '已完结', value: completedProjects, unit: '本' },
                        { label: '总字数', value: totalWords, unit: '字' },
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
                            boxShadow: `inset 0 0 15px ${alphaColor(token.colorWhite, 0.15)}, 0 4px 10px ${alphaColor(token.colorText, 0.1)}`,
                            cursor: 'default',
                            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)';
                            e.currentTarget.style.boxShadow = `inset 0 0 20px ${alphaColor(token.colorWhite, 0.25)}, 0 8px 16px ${alphaColor(token.colorText, 0.15)}`;
                            e.currentTarget.style.border = `1px solid ${alphaColor(token.colorWhite, 0.1)}`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0) scale(1)';
                            e.currentTarget.style.boxShadow = `inset 0 0 15px ${alphaColor(token.colorWhite, 0.15)}, 0 4px 10px ${alphaColor(token.colorText, 0.1)}`;
                          }}
                        >
                          <span style={{ fontSize: '11px', color: alphaColor(token.colorWhite, 0.9), marginBottom: '2px', lineHeight: 1 }}>
                            {item.label}
                          </span>
                          <span style={{ fontSize: '15px', fontWeight: '600', color: token.colorWhite, lineHeight: 1, fontFamily: 'Monaco, monospace' }}>
                            {item.label === '总字数' ? formatWordCount(item.value) : item.value}
                            {item.unit && <span style={{ fontSize: '10px', marginLeft: '2px', opacity: 0.8 }}>{item.unit}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {isMobile && (
        <Drawer
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30,
                height: 30,
                background: token.colorPrimary,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorWhite,
                fontSize: 16,
              }}>
                <BookOutlined />
              </div>
              <span style={{ fontWeight: 600, fontSize: 16, fontFamily: token.fontFamily }}>MuMuAINovel</span>
            </div>
          }
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          width={280}
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
        >
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Menu
              mode="inline"
              selectedKeys={[activeView]}
              style={{ borderRight: 0, paddingTop: 8 }}
              onClick={({ key }) => {
                if (key === 'mumu-api') {
                  window.open('https://api.mumuverse.space/register?aff=4NN8', '_blank', 'noopener,noreferrer');
                  setDrawerVisible(false);
                  return;
                }
                changeView(key as ProjectListView);
                setDrawerVisible(false);
              }}
              items={sideMenuItems}
            />

          </div>

          <div style={{ padding: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: token.colorTextTertiary }}>
                <span>主题模式</span>
                <span>{resolvedMode === 'dark' ? '深色' : '浅色'}</span>
              </div>
              <ThemeSwitch block />
              <UserMenu showFullInfo />
            </Space>
          </div>
        </Drawer>
      )}

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        marginLeft: isMobile ? 0 : desktopSiderWidth,
        marginTop: headerHeight,
        transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>

        {/* 内容显示区 */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: activeView === 'projects'
              ? (isMobile ? '20px 16px 70px' : '24px 24px 70px')
              : 0,
            background: activeView === 'projects'
              ? `linear-gradient(180deg, ${alphaColor(token.colorPrimary, 0.04)} 0%, ${token.colorBgLayout} 26%)`
              : token.colorBgLayout,
          }}
        >
          {activeView === 'settings' && <SettingsPage />}
          {activeView === 'system-settings' && <SystemSettingsPage />}
          {activeView === 'mcp' && <MCPPluginsPage />}
          {activeView === 'prompts' && <PromptTemplates />}
          
          {activeView === 'book-import' && <BookImport />}
          
          {activeView === 'projects' && (
            <BookshelfPage
              isMobile={isMobile}
              loading={loading}
              projects={projects}
              showApiTip={showApiTip}
              setShowApiTip={setShowApiTip}
              exportableProjectsCount={exportableProjects.length}
              onOpenImportModal={() => setImportModalVisible(true)}
              onOpenExportModal={handleOpenExportModal}
              onGoSettings={() => changeView('settings')}
              onStartWizard={() => navigate('/wizard')}
              onOpenInspiration={() => navigate('/inspiration')}
              onEnterProject={handleEnterProject}
              onDeleteProject={handleDelete}
              onGenerateCover={handleGenerateCover}
              onDownloadCover={handleDownloadCover}
              formatWordCount={formatWordCount}
              getProgress={getProgress}
              getProgressColor={getProgressColor}
              getDisplayStatus={getDisplayStatus}
              getStatusTag={getStatusTag}
              formatDate={formatDate}
            />
          )}
        
        <ChangelogFloatingButton />
        </div>
      </div>

      <AnnouncementTimelineModal
        visible={announcementVisible}
        announcements={announcements}
        loading={announcementsLoading}
        onClose={() => setAnnouncementVisible(false)}
        onRefresh={() => void refreshAnnouncements({ full: true })}
        onMarkAllRead={markAllAnnouncementsRead}
      />

      {/* 导入项目对话框 */}
      <Modal
        title="导入项目"
        open={importModalVisible}
        onOk={handleImport}
        onCancel={handleCloseImportModal}
        confirmLoading={importing}
        okText="导入"
        cancelText="取消"
        width={isMobile ? '90%' : 500}
        centered
        okButtonProps={{ disabled: !validationResult?.valid }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <p style={{ marginBottom: '12px', color: token.colorTextSecondary }}>
              选择之前导出的 JSON 格式项目文件
            </p>
            <Upload
              accept=".json"
              beforeUpload={handleFileSelect}
              maxCount={1}
              onRemove={() => {
                setSelectedFile(null);
                setValidationResult(null);
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fileList={selectedFile ? [{ uid: '-1', name: selectedFile.name, status: 'done' }] as any : []}
            >
              <Button icon={<UploadOutlined />} block>选择文件</Button>
            </Upload>
          </div>

          {validating && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin tip="验证文件中..." />
            </div>
          )}

          {validationResult && (
            <Card size="small" style={{ background: validationResult.valid ? token.colorSuccessBg : token.colorErrorBg }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Text strong style={{ color: validationResult.valid ? token.colorSuccess : token.colorError }}>
                    {validationResult.valid ? '✓ 文件验证通过' : '✗ 文件验证失败'}
                  </Text>
                </div>
                {validationResult.project_name && (
                  <div>
                    <Text type="secondary">项目名称：</Text>
                    <Text strong>{validationResult.project_name}</Text>
                  </div>
                )}
                {validationResult.statistics && (
                   <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>数据统计：</Text>
                      <Space size={[6, 6]} wrap>
                        {validationResult.statistics.chapters > 0 && <Tag color="blue">章节: {validationResult.statistics.chapters}</Tag>}
                        {validationResult.statistics.characters > 0 && <Tag color="green">角色: {validationResult.statistics.characters}</Tag>}
                        {validationResult.statistics.outlines > 0 && <Tag color="cyan">大纲: {validationResult.statistics.outlines}</Tag>}
                        {validationResult.statistics.relationships > 0 && <Tag color="purple">关系: {validationResult.statistics.relationships}</Tag>}
                        {validationResult.statistics.organizations > 0 && <Tag color="orange">组织: {validationResult.statistics.organizations}</Tag>}
                        {validationResult.statistics.careers > 0 && <Tag color="magenta">职业: {validationResult.statistics.careers}</Tag>}
                        {validationResult.statistics.character_careers > 0 && <Tag color="geekblue">职业关联: {validationResult.statistics.character_careers}</Tag>}
                        {validationResult.statistics.writing_styles > 0 && <Tag color="lime">写作风格: {validationResult.statistics.writing_styles}</Tag>}
                        {validationResult.statistics.story_memories > 0 && <Tag color="gold">故事记忆: {validationResult.statistics.story_memories}</Tag>}
                        {validationResult.statistics.plot_analysis > 0 && <Tag color="volcano">剧情分析: {validationResult.statistics.plot_analysis}</Tag>}
                        {validationResult.statistics.generation_history > 0 && <Tag>生成历史: {validationResult.statistics.generation_history}</Tag>}
                        {validationResult.statistics.has_default_style && <Tag color="success">含默认风格</Tag>}
                      </Space>
                   </div>
                )}
                {validationResult.warnings?.length > 0 && (
                   <div style={{ marginTop: 8 }}>
                     <Text type="warning" strong style={{ fontSize: 12 }}>提示：</Text>
                     <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: token.colorWarning, fontSize: 12 }}>
                       {validationResult.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                     </ul>
                   </div>
                )}
                {validationResult.errors?.length > 0 && (
                   <div>
                     <Text type="danger" strong>错误：</Text>
                     <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: token.colorError, fontSize: 13 }}>
                       {validationResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                     </ul>
                   </div>
                )}
              </Space>
            </Card>
          )}
        </Space>
      </Modal>

      {/* 导出项目对话框 */}
      <Modal
        title="导出项目"
        open={exportModalVisible}
        onOk={handleExport}
        onCancel={handleCloseExportModal}
        confirmLoading={exporting}
        okText={selectedProjectIds.length > 0 ? `导出 (${selectedProjectIds.length})` : '导出'}
        cancelText="取消"
        width={isMobile ? '90%' : 700}
        centered
        okButtonProps={{ disabled: selectedProjectIds.length === 0 }}
      >
         <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" style={{ background: token.colorFillTertiary }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Text strong>导出选项</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
                  <Checkbox checked={exportOptions.includeWritingStyles} onChange={e => setExportOptions(prev => ({...prev, includeWritingStyles: e.target.checked}))}>写作风格</Checkbox>
                  <Checkbox checked={exportOptions.includeCareers} onChange={e => setExportOptions(prev => ({...prev, includeCareers: e.target.checked}))}>职业系统</Checkbox>
                  <Tooltip title="包含生成历史记录，文件可能较大">
                    <Checkbox checked={exportOptions.includeGenerationHistory} onChange={e => setExportOptions(prev => ({...prev, includeGenerationHistory: e.target.checked}))}>生成历史</Checkbox>
                  </Tooltip>
                  <Tooltip title="包含故事记忆数据，文件可能较大">
                    <Checkbox checked={exportOptions.includeMemories} onChange={e => setExportOptions(prev => ({...prev, includeMemories: e.target.checked}))}>故事记忆</Checkbox>
                  </Tooltip>
                  <Tooltip title="包含AI剧情分析数据">
                    <Checkbox checked={exportOptions.includePlotAnalysis} onChange={e => setExportOptions(prev => ({...prev, includePlotAnalysis: e.target.checked}))}>剧情分析</Checkbox>
                  </Tooltip>
                </div>
              </Space>
            </Card>

            <div>
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text>选择项目 ({exportableProjects.length})</Text>
                  <Checkbox 
                    checked={selectedProjectIds.length === exportableProjects.length && exportableProjects.length > 0}
                    indeterminate={selectedProjectIds.length > 0 && selectedProjectIds.length < exportableProjects.length}
                    onChange={handleToggleAll}
                  >
                    全选
                  </Checkbox>
               </div>
               <div style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 8 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {exportableProjects.map(p => (
                      <div 
                        key={p.id}
                        style={{ 
                          padding: '8px 12px', 
                          background: selectedProjectIds.includes(p.id) ? token.colorPrimaryBg : token.colorBgContainer,
                          borderRadius: 6,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12
                        }}
                        onClick={() => handleToggleProject(p.id)}
                      >
                        <Checkbox checked={selectedProjectIds.includes(p.id)} />
                        <div style={{ flex: 1 }}>
                           <div>{p.title}</div>
                           <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{formatWordCount(p.current_words || 0)} 字 · {getStatusTag(getDisplayStatus(p.status, getProgress(p.current_words || 0, p.target_words || 0)))}</div>
                        </div>
                      </div>
                    ))}
                  </Space>
               </div>
            </div>
         </Space>
      </Modal>

    </div>
  );
}
