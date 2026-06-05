import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Spin, Alert, Button, Space, Switch, Drawer, message, Progress, theme } from 'antd';
import {
  ArrowLeftOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  MenuOutlined,
  ReloadOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import AnnotatedText, { type MemoryAnnotation } from '../components/AnnotatedText';
import MemorySidebar from '../components/MemorySidebar';

interface ChapterData {
  id: string;
  chapter_number: number;
  title: string;
  content: string;
  word_count: number;
}

interface AnnotationsData {
  chapter_id: string;
  chapter_number: number;
  title: string;
  word_count: number;
  annotations: MemoryAnnotation[];
  has_analysis: boolean;
  summary: {
    total_annotations: number;
    hooks: number;
    foreshadows: number;
    plot_points: number;
    character_events: number;
  };
}

interface NavigationData {
  current: {
    id: string;
    chapter_number: number;
    title: string;
  };
  previous: {
    id: string;
    chapter_number: number;
    title: string;
  } | null;
  next: {
    id: string;
    chapter_number: number;
    title: string;
  } | null;
}

/**
 * 章节阅读器页面
 * 展示带有记忆标注的章节内容
 */
const ChapterReader: React.FC = () => {
  const { chapterId } = useParams<{ chapterId: string }>();
  const navigate = useNavigate();

  const { token } = theme.useToken();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [annotationsData, setAnnotationsData] = useState<AnnotationsData | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | undefined>();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [navigation, setNavigation] = useState<NavigationData | null>(null);

  const loadChapterData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 并行加载章节内容、标注数据和导航信息
      // 注意：api拦截器已经解析了response.data，所以直接返回数据对象
      const [chapterData, annotationsData, navigationData] = await Promise.all([
        api.get<unknown, ChapterData>(`/chapters/${chapterId}`).catch(err => {
          console.error('加载章节失败:', err);
          throw err;
        }),
        api.get<unknown, AnnotationsData>(`/chapters/${chapterId}/annotations`).catch(err => {
          console.warn('加载标注失败:', err);
          return null;
        }), // 如果没有分析数据也不报错
        api.get<unknown, NavigationData>(`/chapters/${chapterId}/navigation`).catch(err => {
          console.warn('加载导航信息失败:', err);
          return null;
        }),
      ]);

      console.log('章节数据:', chapterData);
      console.log('标注数据:', annotationsData);
      console.log('导航数据:', navigationData);

      // 验证数据
      if (!chapterData || !chapterData.content) {
        throw new Error('章节数据无效：缺少内容');
      }

      setChapter(chapterData);
      setNavigation(navigationData);
      
      // 验证标注数据
      if (annotationsData) {
        const validAnnotations = annotationsData.annotations.filter(
          (a: MemoryAnnotation) => a.position >= 0 && a.position < chapterData.content.length
        );
        const invalidCount = annotationsData.annotations.length - validAnnotations.length;
        
        if (invalidCount > 0) {
          console.warn(`${invalidCount}个标注位置无效，将仅显示${validAnnotations.length}个有效标注`);
        }
        
        setAnnotationsData(annotationsData);
      } else {
        setAnnotationsData(null);
      }
    } catch (err: unknown) {
      console.error('加载章节数据失败:', err);
      const error = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(error.response?.data?.detail || error.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => {
    if (chapterId) {
      loadChapterData();
    }
  }, [chapterId, loadChapterData]);

  const handleAnnotationClick = (annotation: MemoryAnnotation) => {
    setActiveAnnotationId(annotation.id);
    // 移动端显示侧边栏
    if (window.innerWidth < 768) {
      setSidebarVisible(true);
    }
  };

  const handleBackClick = () => {
    navigate(-1);
  };

  const handlePreviousChapter = () => {
    if (navigation?.previous) {
      navigate(`/chapters/${navigation.previous.id}/reader`);
    }
  };

  const handleNextChapter = () => {
    if (navigation?.next) {
      navigate(`/chapters/${navigation.next.id}/reader`);
    }
  };

  const handleReanalyze = async () => {
    if (!chapterId) return;

    try {
      setAnalyzing(true);
      setAnalysisProgress(0);
      message.loading({ content: '开始分析章节...', key: 'analyze', duration: 0 });

      // 触发分析
      await api.post(`/chapters/${chapterId}/analyze`);

      // 轮询分析状态
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await api.get(`/chapters/${chapterId}/analysis/status`);
          const { status, progress, error_message } = statusRes.data;

          setAnalysisProgress(progress || 0);

          if (status === 'completed') {
            clearInterval(pollInterval);
            setAnalyzing(false);
            message.success({ content: '分析完成！', key: 'analyze' });
            
            // 重新加载标注数据
            const annotationsRes = await api.get(`/chapters/${chapterId}/annotations`);
            setAnnotationsData(annotationsRes.data);
          } else if (status === 'failed') {
            clearInterval(pollInterval);
            setAnalyzing(false);
            message.error({
              content: `分析失败：${error_message || '未知错误'}`,
              key: 'analyze'
            });
          }
        } catch (err) {
          console.error('轮询分析状态失败:', err);
        }
      }, 2000); // 每2秒轮询一次

      // 30秒超时
      setTimeout(() => {
        clearInterval(pollInterval);
        if (analyzing) {
          setAnalyzing(false);
          message.warning({ content: '分析超时，请稍后刷新查看结果', key: 'analyze' });
        }
      }, 30000);

    } catch (err: unknown) {
      setAnalyzing(false);
      const error = err as { response?: { data?: { detail?: string } } };
      message.error({
        content: error.response?.data?.detail || '触发分析失败',
        key: 'analyze'
      });
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" tip="加载章节中..." />
      </div>
    );
  }

  if (error || !chapter) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          message="加载失败"
          description={error || '章节不存在'}
          type="error"
          showIcon
        />
        <Button onClick={handleBackClick} style={{ marginTop: 16 }}>
          返回
        </Button>
      </div>
    );
  }

  const hasAnnotations = annotationsData && annotationsData.annotations.length > 0;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏 */}
      <Card
        size="small"
        style={{
          borderRadius: 0,
          borderLeft: 0,
          borderRight: 0,
          borderTop: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={handleBackClick}>
              返回
            </Button>
            <Button
              icon={<LeftOutlined />}
              onClick={handlePreviousChapter}
              disabled={!navigation?.previous}
              title={navigation?.previous ? `上一章: ${navigation.previous.title}` : '已是第一章'}
            >
              上一章
            </Button>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              第{chapter.chapter_number}章: {chapter.title}
            </span>
            <Button
              icon={<RightOutlined />}
              onClick={handleNextChapter}
              disabled={!navigation?.next}
              title={navigation?.next ? `下一章: ${navigation.next.title}` : '已是最后一章'}
            >
              下一章
            </Button>
          </Space>

          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReanalyze}
              loading={analyzing}
              disabled={analyzing}
            >
              {analyzing ? '分析中...' : '重新分析'}
            </Button>
            {hasAnnotations && (
              <>
                <Switch
                  checked={showAnnotations}
                  onChange={setShowAnnotations}
                  checkedChildren={<EyeOutlined />}
                  unCheckedChildren={<EyeInvisibleOutlined />}
                />
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>显示标注</span>
                <Button
                  icon={<MenuOutlined />}
                  onClick={() => setSidebarVisible(true)}
                  style={{ display: window.innerWidth < 768 ? 'inline-block' : 'none' }}
                >
                  分析
                </Button>
              </>
            )}
          </Space>
        </div>

        {analyzing && (
          <div style={{ marginTop: 12 }}>
            <Progress percent={analysisProgress} size="small" status="active" />
            <span style={{ fontSize: 12, color: token.colorTextSecondary, marginLeft: 8 }}>
              正在分析章节...
            </span>
          </div>
        )}

        {!analyzing && hasAnnotations && annotationsData && (
          <div style={{ marginTop: 12, fontSize: 12, color: token.colorTextTertiary }}>
            共有 {annotationsData.summary.total_annotations} 个标注：
            {annotationsData.summary.hooks > 0 && ` 🎣${annotationsData.summary.hooks}个钩子`}
            {annotationsData.summary.foreshadows > 0 &&
              ` 🌟${annotationsData.summary.foreshadows}个伏笔`}
            {annotationsData.summary.plot_points > 0 &&
              ` 💎${annotationsData.summary.plot_points}个情节点`}
            {annotationsData.summary.character_events > 0 &&
              ` 👤${annotationsData.summary.character_events}个角色事件`}
          </div>
        )}
      </Card>

      {/* 主内容区域 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：章节内容 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '32px 48px',
            maxWidth: hasAnnotations ? 'calc(100% - 400px)' : '100%',
          }}
        >
          <Card>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              {!hasAnnotations && (
                <Alert
                  message="暂无分析数据"
                  description="该章节尚未进行AI分析，无法显示记忆标注。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 24 }}
                />
              )}

              {showAnnotations && hasAnnotations && annotationsData ? (
                <AnnotatedText
                  content={chapter.content}
                  annotations={annotationsData.annotations}
                  onAnnotationClick={handleAnnotationClick}
                  activeAnnotationId={activeAnnotationId}
                />
              ) : (
                <div
                  style={{
                    lineHeight: 2,
                    fontSize: 16,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {chapter.content}
                </div>
              )}

              {/* 底部翻页按钮 */}
              <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Button
                    size="large"
                    icon={<LeftOutlined />}
                    onClick={handlePreviousChapter}
                    disabled={!navigation?.previous}
                  >
                    {navigation?.previous
                      ? `上一章: 第${navigation.previous.chapter_number}章 ${navigation.previous.title}`
                      : '已是第一章'}
                  </Button>
                  <Button
                    size="large"
                    type="primary"
                    icon={<RightOutlined />}
                    onClick={handleNextChapter}
                    disabled={!navigation?.next}
                    iconPosition="end"
                  >
                    {navigation?.next
                      ? `下一章: 第${navigation.next.chapter_number}章 ${navigation.next.title}`
                      : '已是最后一章'}
                  </Button>
                </Space>
              </div>
            </div>
          </Card>
        </div>

        {/* 右侧：记忆侧边栏（桌面端） */}
        {hasAnnotations && annotationsData && window.innerWidth >= 768 && (
          <div
            style={{
              width: 400,
              borderLeft: `1px solid ${token.colorBorderSecondary}`,
              overflowY: 'auto',
              background: token.colorBgLayout,
            }}
          >
            <MemorySidebar
              annotations={annotationsData.annotations}
              activeAnnotationId={activeAnnotationId}
              onAnnotationClick={handleAnnotationClick}
            />
          </div>
        )}
      </div>

      {/* 移动端抽屉 */}
      {hasAnnotations && annotationsData && (
        <Drawer
          title="章节分析"
          placement="right"
          onClose={() => setSidebarVisible(false)}
          open={sidebarVisible}
          width="80%"
        >
          <MemorySidebar
            annotations={annotationsData.annotations}
            activeAnnotationId={activeAnnotationId}
            onAnnotationClick={(annotation) => {
              handleAnnotationClick(annotation);
              setSidebarVisible(false);
            }}
          />
        </Drawer>
      )}
    </div>
  );
};

export default ChapterReader;