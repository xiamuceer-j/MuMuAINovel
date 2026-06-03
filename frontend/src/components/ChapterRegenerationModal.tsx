import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Checkbox,
  InputNumber,
  Space,
  Alert,
  Divider,
  Tag,
  message,
  Collapse,
  Card,
  Radio,
  Select
} from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { ssePost } from '../utils/sseClient';
import { SSEProgressModal } from './SSEProgressModal';

const { TextArea } = Input;
const { Panel } = Collapse;

interface Suggestion {
  category: string;
  content: string;
  priority: string;
}

interface ChapterRegenerationModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: (newContent: string, wordCount: number) => void;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  suggestions?: Suggestion[];
  hasAnalysis: boolean;
}


const ChapterRegenerationModal: React.FC<ChapterRegenerationModalProps> = ({
  visible,
  onCancel,
  onSuccess,
  chapterId,
  chapterTitle,
  chapterNumber,
  suggestions = [],
  hasAnalysis
}) => {
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [selectedSuggestions, setSelectedSuggestions] = useState<number[]>([]);
  const [modificationSource, setModificationSource] = useState<'custom' | 'analysis_suggestions' | 'mixed'>('custom');
  const [availableModels, setAvailableModels] = useState<Array<{ value: string; label: string }>>([]);

  // 加载可用模型
  const loadAvailableModels = async () => {
    try {
      const settingsResponse = await fetch('/api/settings');
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        const { api_key, api_base_url, api_provider } = settings;
        if (api_key && api_base_url) {
          try {
            const modelsResponse = await fetch(
              `/api/settings/models?api_key=${encodeURIComponent(api_key)}&api_base_url=${encodeURIComponent(api_base_url)}&provider=${api_provider}`
            );
            if (modelsResponse.ok) {
              const data = await modelsResponse.json();
              if (data.models && data.models.length > 0) {
                setAvailableModels(data.models);
              }
            }
          } catch {
            console.log('获取模型列表失败');
          }
        }
      }
    } catch (error) {
      console.error('加载可用模型失败:', error);
    }
  };

  useEffect(() => {
    if (visible) {
      // 重置状态
      setStatus('idle');
      setProgress(0);
      setErrorMessage('');
      setWordCount(0);
      setSelectedSuggestions([]);
      
      // 如果有分析建议，默认选择混合模式
      if (hasAnalysis && suggestions.length > 0) {
        setModificationSource('mixed');
      } else {
        setModificationSource('custom');
      }
      
      // 设置默认值
      form.setFieldsValue({
        modification_source: hasAnalysis && suggestions.length > 0 ? 'mixed' : 'custom',
        target_word_count: 3000,
        preserve_structure: false,
        preserve_character_traits: true,
        focus_areas: [],
        model: undefined
      });

      // 加载模型列表
      loadAvailableModels();
    }
  }, [visible, hasAnalysis, suggestions.length, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      // 验证至少提供一种修改指令
      if (values.modification_source === 'custom' && !values.custom_instructions?.trim()) {
        message.error('请输入自定义修改要求');
        return;
      }
      
      if (values.modification_source === 'analysis_suggestions' && selectedSuggestions.length === 0) {
        message.error('请选择至少一条分析建议');
        return;
      }
      
      if (values.modification_source === 'mixed' && 
          selectedSuggestions.length === 0 && 
          !values.custom_instructions?.trim()) {
        message.error('请至少选择一条建议或输入自定义要求');
        return;
      }

      setLoading(true);
      setStatus('generating');
      setProgress(0);
      setWordCount(0);

      // 构建请求数据
      const requestData: Record<string, unknown> = {
        modification_source: values.modification_source,
        custom_instructions: values.custom_instructions,
        selected_suggestion_indices: selectedSuggestions,
        preserve_elements: {
          preserve_structure: values.preserve_structure,
          preserve_dialogues: values.preserve_dialogues || [],
          preserve_plot_points: values.preserve_plot_points || [],
          preserve_character_traits: values.preserve_character_traits
        },
        style_id: values.style_id,
        target_word_count: values.target_word_count,
        focus_areas: values.focus_areas || [],
        model: values.model || undefined
      };

      let accumulatedContent = '';
      let currentWordCount = 0;

      // 使用SSE流式生成
      await ssePost(
        `/api/chapters/${chapterId}/regenerate-stream`,
        requestData,
        {
          onProgress: (_msg: string, prog: number, _status: string, wordCount?: number) => {
            // 后端发送的进度消息
            setProgress(prog);
            // 如果后端提供了word_count，使用它；否则使用累积的字数
            if (wordCount !== undefined) {
              setWordCount(wordCount);
              currentWordCount = wordCount;
            }
          },
          onChunk: (content: string) => {
            // 累积内容块
            accumulatedContent += content;
            // 仅作为备用字数统计
            currentWordCount = accumulatedContent.length;
            // 不再自己计算进度，完全依赖后端发送的progress消息
          },
          onResult: (data: { word_count?: number }) => {
            // 生成完成，确保使用最新的累积内容
            setProgress(100);
            setStatus('success');
            const finalWordCount = data.word_count || currentWordCount;
            setWordCount(finalWordCount);
            message.success('重新生成完成！');
            
            // 直接调用onSuccess打开对比界面，传递最终的累积内容
            setTimeout(() => {
              onSuccess(accumulatedContent, finalWordCount);
            }, 500);
          },
          onComplete: () => {
            // SSE完成
          },
          onError: (error: string, code?: number) => {
            console.error('SSE Error:', error, code);
            setStatus('error');
            setErrorMessage(error || '生成失败');
            message.error('重新生成失败: ' + (error || '未知错误'));
          }
        }
      );

    } catch (error: unknown) {
      console.error('提交失败:', error);
      setStatus('error');
      const err = error as Error;
      setErrorMessage(err.message || '提交失败');
      message.error('操作失败: ' + (err.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionSelect = (index: number, checked: boolean) => {
    if (checked) {
      setSelectedSuggestions([...selectedSuggestions, index]);
    } else {
      setSelectedSuggestions(selectedSuggestions.filter(i => i !== index));
    }
  };

  const handleCancel = () => {
    if (loading) {
      modal.confirm({
        title: '确认取消',
        content: '生成正在进行中，确定要取消吗？',
        centered: true,
        onOk: () => {
          setLoading(false);
          setStatus('idle');
          onCancel();
        }
      });
    } else {
      onCancel();
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
      title={`重新生成章节 - 第${chapterNumber}章：${chapterTitle}`}
      open={visible}
      onCancel={handleCancel}
      width={800}
      centered
      footer={
        status === 'success' ? null : (
          [
            <Button key="cancel" onClick={handleCancel} disabled={loading}>
              取消
            </Button>,
            <Button
              key="submit"
              type="primary"
              onClick={handleSubmit}
              loading={loading}
              icon={<ReloadOutlined />}
            >
              开始重新生成
            </Button>
          ]
        )
      }
    >

      {status === 'success' && (
        <Alert
          message="重新生成成功！"
          description={`共生成 ${wordCount} 字`}
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      {status === 'error' && (
        <Alert
          message="生成失败"
          description={errorMessage}
          type="error"
          showIcon
          icon={<CloseCircleOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        disabled={loading || status === 'success'}
      >
        {/* 修改来源 */}
        <Form.Item
          name="modification_source"
          label="修改来源"
          rules={[{ required: true, message: '请选择修改来源' }]}
        >
          <Radio.Group onChange={(e) => setModificationSource(e.target.value)}>
            <Radio value="custom">仅自定义修改</Radio>
            {hasAnalysis && suggestions.length > 0 && (
              <>
                <Radio value="analysis_suggestions">仅分析建议</Radio>
                <Radio value="mixed">混合模式</Radio>
              </>
            )}
          </Radio.Group>
        </Form.Item>

        {/* 分析建议选择 */}
        {hasAnalysis && suggestions.length > 0 && 
         (modificationSource === 'analysis_suggestions' || modificationSource === 'mixed') && (
          <Form.Item label={`选择分析建议 (${selectedSuggestions.length}/${suggestions.length})`}>
            <Card size="small" style={{ maxHeight: 300, overflow: 'auto' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {suggestions.map((suggestion, index) => (
                  <Checkbox
                    key={index}
                    checked={selectedSuggestions.includes(index)}
                    onChange={(e) => handleSuggestionSelect(index, e.target.checked)}
                  >
                    <Space>
                      <Tag color={
                        suggestion.priority === 'high' ? 'red' :
                        suggestion.priority === 'medium' ? 'orange' : 'blue'
                      }>
                        {suggestion.category}
                      </Tag>
                      <span style={{ fontSize: 13 }}>{suggestion.content}</span>
                    </Space>
                  </Checkbox>
                ))}
              </Space>
            </Card>
          </Form.Item>
        )}

        {/* 自定义修改要求 */}
        {(modificationSource === 'custom' || modificationSource === 'mixed') && (
          <Form.Item
            name="custom_instructions"
            label="自定义修改要求"
            tooltip="描述你希望如何改进这个章节"
          >
            <TextArea
              rows={4}
              placeholder="例如：增强情感渲染，让主角的内心戏更加细腻..."
              showCount
              maxLength={1000}
            />
          </Form.Item>
        )}

        {/* 高级选项 */}
        <Collapse ghost>
          <Panel header="高级选项" key="advanced">
            {/* 重点优化方向 */}
            <Form.Item
              name="focus_areas"
              label="重点优化方向"
            >
              <Checkbox.Group>
                <Space direction="vertical">
                  <Checkbox value="pacing">节奏把控</Checkbox>
                  <Checkbox value="emotion">情感渲染</Checkbox>
                  <Checkbox value="description">场景描写</Checkbox>
                  <Checkbox value="dialogue">对话质量</Checkbox>
                  <Checkbox value="conflict">冲突强度</Checkbox>
                </Space>
              </Checkbox.Group>
            </Form.Item>

            <Divider />

            {/* 保留元素 */}
            <Form.Item label="保留元素">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Form.Item name="preserve_structure" valuePropName="checked" noStyle>
                  <Checkbox>保留整体结构和情节框架</Checkbox>
                </Form.Item>
                <Form.Item name="preserve_character_traits" valuePropName="checked" noStyle>
                  <Checkbox>保持角色性格一致</Checkbox>
                </Form.Item>
              </Space>
            </Form.Item>

            <Divider />

            {/* AI模型 */}
            {availableModels.length > 0 && (
              <Form.Item
                name="model"
                label="AI模型"
                tooltip="选择用于重新生成的AI模型，不选则使用默认模型"
              >
                <Select
                  placeholder="使用默认模型"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                >
                  {availableModels.map(model => (
                    <Select.Option key={model.value} value={model.value} label={model.label}>
                      {model.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}

            <Divider />

            {/* 生成参数 */}
            <Form.Item
              name="target_word_count"
              label="目标字数"
              tooltip="生成内容的目标字数，实际字数可能有±20%的浮动"
            >
              <InputNumber min={500} max={10000} step={500} style={{ width: '100%' }} />
            </Form.Item>

          </Panel>
        </Collapse>
      </Form>

      {/* 使用统一的进度显示组件 */}
      <SSEProgressModal
        visible={status === 'generating'}
        progress={progress}
        message={`正在重新生成中... (已生成 ${wordCount} 字)`}
        title="重新生成章节"
      />
      </Modal>
    </>
  );
};

export default ChapterRegenerationModal;