import { ApiOutlined, BookOutlined, BulbOutlined, CalendarOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileSearchOutlined, FileTextOutlined, LoadingOutlined, MenuUnfoldOutlined, RocketOutlined, SettingOutlined, TrophyOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Drawer, Menu, message, Modal, Progress, Space, Spin, Tag, Tooltip, Typography, Upload } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cardHoverHandlers, cardStyles } from '../components/CardStyles';
import ChangelogFloatingButton from '../components/ChangelogFloatingButton';
import UserMenu from '../components/UserMenu';
import { projectApi } from '../services/api';
import { useViewport } from '../hooks/useViewport';
import { useStore } from '../store';
import { eventBus, EventNames } from '../store/eventBus';
import { useProjectSync } from '../store/hooks';
import BookImport from './BookImport';
import MCPPluginsPage from './MCPPlugins';
import PromptTemplates from './PromptTemplates';
import SettingsPage from './Settings';

const { Title, Text, Paragraph } = Typography;

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

export default function ProjectList() {
  const navigate = useNavigate();
  const { projects, loading } = useStore();
  const [activeView, setActiveView] = useState<'projects' | 'settings' | 'mcp' | 'prompts' | 'book-import'>('projects');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [modal, contextHolder] = Modal.useModal();
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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { isDesktop, isMobile, isMobilePortrait, isMobileLandscape } = useViewport();

  // 处理切换到 MCP 视图的事件
  const handleSwitchToMcp = useCallback(() => {
    setActiveView('mcp');
  }, []);

  useEffect(() => {
    refreshProjects();
    
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEnterProject = async (project: any) => {
    if (project.wizard_status === 'incomplete') {
      navigate(`/wizard?project_id=${project.id}`);
    } else {
      navigate(`/project/${project.id}`);
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
    if (progress >= 80) return '#52c41a';
    if (progress >= 50) return '#1890ff';
    if (progress >= 20) return '#faad14';
    return '#ff4d4f';
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


  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row', // 改为行布局，容纳侧边栏
      background: 'var(--color-bg-base)',
      overflow: 'hidden',
      height: isMobile ? '100dvh' : '100vh'
    }}>
      {contextHolder}

      {/* 侧边栏 - 仅桌面端显示 - 样式对齐 ProjectDetail */}
      {isDesktop && (
        <div style={{
          width: 220, // 对齐 ProjectDetail 的宽度
          background: '#fff',
          borderRight: 'none',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          position: 'fixed', // 固定定位，与 ProjectDetail 一致
          left: 0,
          top: 0,
          bottom: 0,
          boxShadow: '4px 0 16px rgba(0,0,0,0.02)'
        }}>
          {/* Logo 区域 - 保持 Primary Color 风格 */}
          <div style={{
            height: 70,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            background: 'var(--color-primary)',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 32,
                height: 32,
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 18,
                backdropFilter: 'blur(4px)'
              }}>
                <BookOutlined />
              </div>
              <Title level={5} style={{ margin: 0, color: '#fff', fontWeight: 600 }}>
                MuMuAINovel
              </Title>
            </div>
          </div>

          {/* 侧边栏菜单 - 使用 Menu 组件以保持风格一致 */}
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 16 }}>
             {/* 模拟 Menu 样式 */}
             <div style={{ padding: '0 12px 12px 12px' }}>
                <div
                  onClick={() => setActiveView('projects')}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                    borderRadius: 4,
                    color: activeView === 'projects' ? 'var(--color-primary)' : 'rgba(0,0,0,0.85)',
                    background: activeView === 'projects' ? '#e6f7ff' : 'transparent',
                    marginBottom: 4,
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.3s',
                    borderRight: activeView === 'projects' ? '3px solid var(--color-primary)' : '3px solid transparent'
                  }}
                  onMouseEnter={e => activeView !== 'projects' && (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={e => activeView !== 'projects' && (e.currentTarget.style.background = 'transparent')}
                >
                   <BookOutlined />
                   我的书架
                </div>

                <div style={{ padding: '0 12px', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8, marginTop: 16 }}>创作工具</div>
                <div
                  onClick={() => setActiveView('book-import')}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                    borderRadius: 4,
                    color: activeView === 'book-import' ? 'var(--color-primary)' : 'rgba(0,0,0,0.85)',
                    background: activeView === 'book-import' ? '#e6f7ff' : 'transparent',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.3s',
                    marginBottom: 4,
                    borderRight: activeView === 'book-import' ? '3px solid var(--color-primary)' : '3px solid transparent'
                  }}
                  onMouseEnter={e => activeView !== 'book-import' && (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={e => activeView !== 'book-import' && (e.currentTarget.style.background = 'transparent')}
                >
                   <UploadOutlined />
                   拆书导入
                </div>
                <div
                  onClick={() => setActiveView('mcp')}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                    borderRadius: 4,
                    color: activeView === 'mcp' ? 'var(--color-primary)' : 'rgba(0,0,0,0.85)',
                    background: activeView === 'mcp' ? '#e6f7ff' : 'transparent',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.3s',
                    marginBottom: 4,
                    borderRight: activeView === 'mcp' ? '3px solid var(--color-primary)' : '3px solid transparent'
                  }}
                  onMouseEnter={e => activeView !== 'mcp' && (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={e => activeView !== 'mcp' && (e.currentTarget.style.background = 'transparent')}
                >
                   <ApiOutlined />
                   MCP 插件
                </div>
                <div
                  onClick={() => setActiveView('prompts')}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                    borderRadius: 4,
                    color: activeView === 'prompts' ? 'var(--color-primary)' : 'rgba(0,0,0,0.85)',
                    background: activeView === 'prompts' ? '#e6f7ff' : 'transparent',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.3s',
                    marginBottom: 4,
                    borderRight: activeView === 'prompts' ? '3px solid var(--color-primary)' : '3px solid transparent'
                  }}
                  onMouseEnter={e => activeView !== 'prompts' && (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={e => activeView !== 'prompts' && (e.currentTarget.style.background = 'transparent')}
                >
                   <FileSearchOutlined />
                   提示词管理
                </div>

                <div style={{ padding: '0 12px', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8, marginTop: 16 }}>系统设置</div>
                <div
                  onClick={() => setActiveView('settings')}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    cursor: 'pointer',
                    borderRadius: 4,
                    color: activeView === 'settings' ? 'var(--color-primary)' : 'rgba(0,0,0,0.85)',
                    background: activeView === 'settings' ? '#e6f7ff' : 'transparent',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.3s',
                    marginBottom: 4,
                    borderRight: activeView === 'settings' ? '3px solid var(--color-primary)' : '3px solid transparent'
                  }}
                  onMouseEnter={e => activeView !== 'settings' && (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={e => activeView !== 'settings' && (e.currentTarget.style.background = 'transparent')}
                >
                   <SettingOutlined />
                   API 设置
                </div>
             </div>
          </div>

          {/* 底部用户信息 */}
          <div style={{ padding: 16, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
             <UserMenu showFullInfo />
          </div>
        </div>
      )}

      {/* 主内容区域容器 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        marginLeft: isDesktop ? 220 : 0 // 为固定定位的侧边栏留出空间
      }}>
      
        {/* 移动端顶部导航栏 */}
        {isMobile && (
          <div style={{
            flexShrink: 0,
            background: 'var(--color-primary)',
            boxShadow: 'var(--shadow-header)',
            height: isMobileLandscape ? 48 : 56,
            padding: isMobileLandscape ? '0 10px' : '0 12px',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100
          }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button
                  type="text"
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => setDrawerVisible(true)}
                  style={{
                    fontSize: isMobileLandscape ? 16 : 18,
                    color: '#fff',
                    width: isMobileLandscape ? 32 : 36,
                    height: isMobileLandscape ? 32 : 36
                  }}
                />
             </div>
             
              <span style={{
                color: '#fff',
                fontWeight: 600,
                fontSize: isMobileLandscape ? 14 : 16,
                flex: 1,
                textAlign: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                paddingRight: 36  // 为了与左侧菜单按钮对称
              }}>
                {activeView === 'projects' ? '我的书架' :
                 activeView === 'prompts' ? '提示词模板' :
                 activeView === 'book-import' ? '拆书导入' :
                 activeView === 'mcp' ? 'MCP 插件' : 'API 设置'}
              </span>
           </div>
        )}

        {/* 移动端侧边栏 Drawer */}
        {isMobile && (
          <Drawer
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  background: 'var(--color-primary)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 16,
                }}>
                  <BookOutlined />
                </div>
               <span style={{ fontWeight: 600, fontSize: isMobileLandscape ? 14 : 16 }}>MuMuAINovel</span>
              </div>
            }
            closeIcon={null}
            extra={
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={() => setDrawerVisible(false)}
                style={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }}
              />
            }
            placement="left"
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
            width={isMobilePortrait ? '82%' : '56%'}
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
          >
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <Menu
                mode="inline"
                selectedKeys={[activeView]}
                style={{ borderRight: 0, paddingTop: 8 }}
                onClick={({ key }) => {
                  setActiveView(key as 'projects' | 'settings' | 'mcp' | 'prompts' | 'book-import');
                  setDrawerVisible(false);
                }}
                items={[
                  {
                    key: 'projects',
                    icon: <BookOutlined />,
                    label: '我的书架',
                  },
                  {
                    type: 'group',
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
                    type: 'group',
                    label: '系统设置',
                    children: [
                      {
                        key: 'settings',
                        icon: <SettingOutlined />,
                        label: 'API 设置',
                      },
                    ],
                  },
                ]}
              />
              
              {/* 导入导出操作 */}
              <div style={{ padding: '16px', borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Button
                    icon={<UploadOutlined />}
                    block
                    onClick={() => {
                      setImportModalVisible(true);
                      setDrawerVisible(false);
                    }}
                  >
                    导入项目
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    block
                    onClick={() => {
                      handleOpenExportModal();
                      setDrawerVisible(false);
                    }}
                    disabled={exportableProjects.length === 0}
                  >
                    导出项目
                  </Button>
                </Space>
              </div>
            </div>
            
            {/* 底部用户信息 */}
            <div style={{ padding: 16, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <UserMenu showFullInfo />
            </div>
          </Drawer>
        )}

        {/* 桌面端顶部标题栏 */}
        {isDesktop && (
          <div style={{
             height: 70, // 与 ProjectDetail header 高度一致
             padding: '0 24px',
             background: 'var(--color-primary)', // 使用主题色背景
             boxShadow: 'var(--shadow-header)',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'space-between',
             flexShrink: 0,
             zIndex: 100
          }}>
             <h2 style={{
                margin: 0,
                color: '#fff',
                fontSize: '24px',
                fontWeight: 600,
                textShadow: '0 2px 4px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 12
             }}>
                {activeView === 'projects' ? '我的书架' :
                 activeView === 'prompts' ? '提示词模板' :
                 activeView === 'book-import' ? '拆书导入' :
                 activeView === 'mcp' ? 'MCP 插件' : 'API 设置'}
             </h2>
             
             {activeView === 'projects' && (
               <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  {/* 导入导出按钮 */}
                  <Space>
                     <Button ghost icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>导入</Button>
                     <Button ghost icon={<DownloadOutlined />} onClick={handleOpenExportModal} disabled={exportableProjects.length === 0} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.6)' }}>导出</Button>
                  </Space>
                  
                  {/* 统计数据：创作中 已完结 总字数 */}
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
                            borderRadius: '28px', // 圆角风格
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
                          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '2px', lineHeight: 1 }}>
                            {item.label}
                          </span>
                          <span style={{ fontSize: '15px', fontWeight: '600', color: '#fff', lineHeight: 1, fontFamily: 'Monaco, monospace' }}>
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
        )}

        {/* 内容显示区 */}
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: (activeView === 'projects' || activeView === 'book-import')
              ? `${isMobile ? (isMobilePortrait ? 16 : 12) : 24}px ${isMobile ? (isMobilePortrait ? 16 : 14) : 32}px`
              : 0,
            background: 'var(--color-bg-base)',
          }}
        >
          {activeView === 'settings' && <SettingsPage />}
          {activeView === 'mcp' && <MCPPluginsPage />}
          {activeView === 'prompts' && <PromptTemplates />}
          
          {activeView === 'book-import' && (
            <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
              <BookImport />
            </div>
          )}
          
          {activeView === 'projects' && (
            <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 60 }}>
            
            {showApiTip && projects.length === 0 && (
              <Alert
                message="欢迎使用 MuMuAINovel"
                description={
                  <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'flex-start' : 'center',
                    gap: isMobile ? 12 : 16,
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontSize: isMobile ? 12 : 14 }}>
                      在开始创作之前，请先配置您的AI接口（支持 OpenAI / Anthropic）。
                    </span>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setActiveView('settings')}
                      style={{ flexShrink: 0 }}
                    >
                      去配置
                    </Button>
                  </div>
                }
                type="info"
                showIcon
                closable
                onClose={() => setShowApiTip(false)}
                style={{
                  marginBottom: isMobile ? 16 : 24,
                  borderRadius: 12
                }}
              />
            )}

            <Spin spinning={loading}>
              <div style={{
                ...cardStyles.bookshelf,
                // 移动端竖屏一列，横屏双列
                ...(isMobile && {
                  gridTemplateColumns: isMobilePortrait ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                  gap: isMobilePortrait ? '16px' : '12px',
                  padding: isMobilePortrait ? '16px 0' : '12px 0',
                })
              }}>
                {/* 新建/灵感卡片 */}
                <div style={{ position: 'relative', width: '100%', minWidth: 0, minHeight: isMobile ? (isMobilePortrait ? 300 : 250) : 330 }}>
                  <Card
                    hoverable
                    style={{ ...cardStyles.newProjectBook, minHeight: isMobile ? (isMobilePortrait ? 300 : 250) : 330 }}
                    styles={{ body: { padding: isMobile ? (isMobilePortrait ? '16px' : '12px') : '24px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' } }}
                    {...cardHoverHandlers}
                    data-type="new-project"
                  >
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: isMobile ? 10 : 16,
                        justifyContent: 'center'
                      }}>
                        <Button
                          type="primary"
                          size={isMobile ? 'middle' : 'large'}
                          icon={<RocketOutlined />}
                          onClick={() => navigate('/wizard')}
                          style={{ height: isMobile ? '38px' : '50px', fontSize: isMobile ? '14px' : '16px' }}
                          block
                        >
                          快速开始
                        </Button>
                        <Button
                          size={isMobile ? 'middle' : 'large'}
                          icon={<BulbOutlined />}
                          onClick={() => navigate('/inspiration')}
                          style={{
                            height: isMobile ? '38px' : '50px',
                            fontSize: isMobile ? '14px' : '16px',
                            borderColor: '#faad14',
                            color: '#faad14',
                            background: 'rgba(250, 173, 20, 0.1)'
                          }}
                          block
                        >
                          灵感模式
                        </Button>
                        <div style={{ textAlign: 'center', color: '#999', fontSize: isMobile ? 11 : 12, marginTop: isMobile ? 4 : 8 }}>
                            开始一个新的创作旅程
                        </div>
                      </div>
                  </Card>
                </div>

                {Array.isArray(projects) && projects.map((project) => {
                    const progress = getProgress(project.current_words, project.target_words || 0);
                    const isWizardIncomplete = project.wizard_status === 'incomplete';
                    // 解析标签（假设存储在 genre 字段，用逗号或顿号分隔）
                    const tags = project.genre ? project.genre.split(/[,、，]/).map((t: string) => t.trim()).filter((t: string) => t) : [];

                    return (
                      <div key={project.id} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
                        <Card
                          hoverable
                          style={cardStyles.project}
                          styles={{ body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column' } }}
                          {...cardHoverHandlers}
                          onClick={() => handleEnterProject(project)}
                        >
                          {/* 卡片头部 - 参考图片样式 */}
                          <div style={{
                            padding: isMobile ? '14px 14px 10px' : '18px 20px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            position: 'relative'
                          }}>
                            <div style={{ flex: 1, minWidth: 0, marginRight: isMobile ? 8 : 12 }}>
                              {/* 标题行：图标 + 标题 */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 10 }}>
                                <BookOutlined style={{
                                  fontSize: isMobile ? 14 : 16,
                                  color: 'var(--color-primary)',
                                  flexShrink: 0
                                }} />
                                <Tooltip title={project.title}>
                                  <div style={{
                                    fontSize: isMobile ? 14 : 16,
                                    fontWeight: 600,
                                    color: 'var(--color-text-primary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: 1.3
                                  }}>
                                    {project.title}
                                  </div>
                                </Tooltip>
                              </div>
                              {/* 标签行 - 单行不换行 */}
                              <div style={{
                                  display: 'flex',
                                  gap: isMobile ? 4 : 6,
                                  overflow: 'hidden',
                                  flexWrap: 'nowrap'
                              }}>
                                {tags.length > 0 ? tags.slice(0, 3).map((tag: string, idx: number) => (
                                  <Tag key={idx} style={{
                                      margin: 0,
                                      fontSize: isMobile ? 10 : 11,
                                      lineHeight: isMobile ? '18px' : '20px',
                                      padding: isMobile ? '0 6px' : '0 8px',
                                      border: 'none',
                                      borderRadius: 4,
                                      background: 'rgba(82, 196, 26, 0.1)',
                                      color: '#52c41a',
                                      fontWeight: 500
                                  }}>
                                      {tag}
                                  </Tag>
                                )) : (
                                  <Tag style={{
                                      margin: 0,
                                      fontSize: isMobile ? 10 : 11,
                                      lineHeight: isMobile ? '18px' : '20px',
                                      padding: isMobile ? '0 6px' : '0 8px',
                                      border: 'none',
                                      borderRadius: 4,
                                      background: 'rgba(82, 196, 26, 0.1)',
                                      color: '#52c41a',
                                      fontWeight: 500
                                  }}>
                                      未分类
                                  </Tag>
                                )}
                              </div>
                            </div>
                            
                            {/* 右上角状态标签 - 带文字和图标 */}
                            <div style={{ flexShrink: 0 }}>
                               {isWizardIncomplete ? (
                                  <Tag
                                    color="warning"
                                    icon={<LoadingOutlined />}
                                    style={{
                                      margin: 0,
                                      borderRadius: 4,
                                      fontSize: isMobile ? 10 : 12,
                                      padding: isMobile ? '0 6px' : '2px 10px',
                                      fontWeight: 500
                                    }}
                                  >
                                    生成中
                                  </Tag>
                                ) : (
                                  getStatusTag(getDisplayStatus(project.status, progress))
                                )}
                            </div>
                          </div>

                          {/* 描述区域 */}
                          <div style={{ padding: isMobile ? '0 14px 10px' : '0 20px 14px' }}>
                             <Paragraph
                               ellipsis={{ rows: isMobile ? 2 : 2 }}
                               style={{
                                 fontSize: isMobile ? 12 : 13,
                                 color: 'var(--color-text-secondary)',
                                 marginBottom: 0,
                                 lineHeight: 1.6
                               }}
                             >
                               {project.description || '暂无描述...'}
                             </Paragraph>
                          </div>

                          {/* 进度条区域 */}
                          <div style={{ padding: isMobile ? '0 14px 12px' : '0 20px 16px' }}>
                             <div style={{
                               display: 'flex',
                               justifyContent: 'space-between',
                               alignItems: 'center',
                               marginBottom: isMobile ? 6 : 8
                             }}>
                                <span style={{
                                  fontSize: isMobile ? 11 : 12,
                                  color: 'var(--color-text-tertiary)'
                                }}>
                                  完成进度
                                </span>
                                <span style={{
                                  fontSize: isMobile ? 11 : 12,
                                  color: getProgressColor(progress),
                                  fontWeight: 600
                                }}>
                                  {progress}%
                                </span>
                             </div>
                             <Progress
                                percent={progress}
                                showInfo={false}
                                strokeColor={getProgressColor(progress)}
                                trailColor="rgba(0, 0, 0, 0.04)"
                                size="small"
                                style={{ marginBottom: 0 }}
                             />
                          </div>

                          {/* 字数统计区域 */}
                          <div style={{
                            padding: isMobile ? '12px 14px' : '16px 20px',
                            background: 'rgba(0, 0, 0, 0.02)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                             <div style={{ textAlign: 'center', flex: 1 }}>
                               <div style={{
                                   fontSize: isMobile ? 18 : 22,
                                   fontWeight: 700,
                                   color: 'var(--color-text-primary)',
                                   lineHeight: 1.2,
                                   fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial'
                               }}>
                                 {formatWordCount(project.current_words || 0)}
                               </div>
                               <div style={{
                                 fontSize: isMobile ? 10 : 11,
                                 color: 'var(--color-text-tertiary)',
                                 marginTop: 2
                               }}>
                                 已写字数
                               </div>
                             </div>
                             <div style={{
                               width: 1,
                               height: isMobile ? 28 : 36,
                               background: 'rgba(0, 0, 0, 0.06)'
                             }} />
                             <div style={{ textAlign: 'center', flex: 1 }}>
                               <div style={{
                                   fontSize: isMobile ? 18 : 22,
                                   fontWeight: 700,
                                   color: '#52c41a',
                                   lineHeight: 1.2,
                                   fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial'
                               }}>
                                 {formatWordCount(project.target_words || 0)}
                               </div>
                               <div style={{
                                 fontSize: isMobile ? 10 : 11,
                                 color: 'var(--color-text-tertiary)',
                                 marginTop: 2
                               }}>
                                 目标字数
                               </div>
                             </div>
                          </div>

                          {/* 卡片底部 - 时间和操作 */}
                          <div style={{
                            padding: isMobile ? '10px 14px' : '12px 20px',
                            borderTop: '1px solid rgba(0,0,0,0.04)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 'auto'
                          }}>
                             <Space size={4} style={{ fontSize: isMobile ? 11 : 12, color: 'var(--color-text-tertiary)' }}>
                               <CalendarOutlined style={{ fontSize: isMobile ? 10 : 12 }} /> {formatDate(project.updated_at)}
                             </Space>
                             
                             <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined style={{ fontSize: isMobile ? 12 : 14 }} />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(project.id);
                                }}
                                style={{ padding: isMobile ? '2px 4px' : '4px 8px' }}
                             />
                          </div>
                        </Card>
                      </div>
                    );
                  })}
                </div>
            </Spin>
          </div>
          )}
        
        <ChangelogFloatingButton />
        </div>
      </div>

      {/* 导入项目对话框 */}
      <Modal
        title="导入项目"
        open={importModalVisible}
        onOk={handleImport}
        onCancel={handleCloseImportModal}
        confirmLoading={importing}
        okText="导入"
        cancelText="取消"
        width={isMobile ? (isMobilePortrait ? '90%' : '72%') : 500}
        centered
        okButtonProps={{ disabled: !validationResult?.valid }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <p style={{ marginBottom: '12px', color: '#666' }}>
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
            <Card size="small" style={{ background: validationResult.valid ? '#f6ffed' : '#fff2f0' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Text strong style={{ color: validationResult.valid ? '#52c41a' : '#ff4d4f' }}>
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
                     <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: '#faad14', fontSize: 12 }}>
                       {validationResult.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                     </ul>
                   </div>
                )}
                {validationResult.errors?.length > 0 && (
                   <div>
                     <Text type="danger" strong>错误：</Text>
                     <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: '#ff4d4f', fontSize: 13 }}>
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
        width={isMobile ? (isMobilePortrait ? '90%' : '82%') : 700}
        centered
        okButtonProps={{ disabled: selectedProjectIds.length === 0 }}
      >
         <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" style={{ background: '#f5f5f5' }}>
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
               <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {exportableProjects.map(p => (
                      <div 
                        key={p.id}
                        style={{ 
                          padding: '8px 12px', 
                          background: selectedProjectIds.includes(p.id) ? '#e6f7ff' : '#fff',
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
                           <div style={{ fontSize: 12, color: '#999' }}>{formatWordCount(p.current_words || 0)} 字 · {getStatusTag(getDisplayStatus(p.status, getProgress(p.current_words || 0, p.target_words || 0)))}</div>
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
