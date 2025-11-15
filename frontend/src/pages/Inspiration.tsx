import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Button, Space, Typography, message, Spin, Progress } from 'antd';
import { SendOutlined, ArrowLeftOutlined, CheckCircleOutlined, LoadingOutlined, RocketOutlined } from '@ant-design/icons';
import { inspirationApi, wizardStreamApi } from '../services/api';
import type { ApiError } from '../types';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type Step = 'idea' | 'title' | 'description' | 'theme' | 'genre' | 'perspective' | 'confirm' | 'generating' | 'complete';

interface Message {
  type: 'ai' | 'user';
  content: string;
  options?: string[];
  isMultiSelect?: boolean;
}

interface WizardData {
  idea: string;
  title: string;
  description: string;
  theme: string;
  genre: string[];
  narrative_perspective: string;
}

const Inspiration: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>('idea');
  const [messages, setMessages] = useState<Message[]>([
    {
      type: 'ai',
      content: '🚀 欢迎来到灵感模式！我是你的爆款小说生成师！\n\n在这里，你的每个想法都能被我打造成千万阅读的爆款！\n\n💡 先告诉我你的脑洞，让我为你设计一个惊艳的开局吧！',
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  
  // 收集的数据
  const [wizardData, setWizardData] = useState<Partial<WizardData>>({});
  
  // 项目生成状态
  const [projectId, setProjectId] = useState<string>('');
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [generationSteps, setGenerationSteps] = useState<{
    worldBuilding: 'pending' | 'processing' | 'completed' | 'error';
    characters: 'pending' | 'processing' | 'completed' | 'error';
    outline: 'pending' | 'processing' | 'completed' | 'error';
  }>({
    worldBuilding: 'pending',
    characters: 'pending',
    outline: 'pending'
  });
  
  // 滚动容器引用
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // 记录上次失败的请求参数，用于重试
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    step: 'title' | 'description' | 'theme' | 'genre';
    context: Partial<WizardData>;
  } | null>(null);

  // 自动滚动到底部 - 使用更丝滑的方式
  const scrollToBottom = () => {
    // 使用 setTimeout 确保 DOM 已更新
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  // 当消息更新时自动滚动
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 重试生成
  const handleRetry = async () => {
    if (!lastFailedRequest) return;
    
    setLoading(true);
    try {
      const response = await inspirationApi.generateOptions({
        step: lastFailedRequest.step,
        context: lastFailedRequest.context,
        user_feedback: ""  // 重试时不传递用户反馈
      });

      if (response.error) {
        message.error(response.error);
        return;
      }

      // 移除失败消息，添加成功的AI消息
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages[newMessages.length - 1].type === 'ai' &&
            (newMessages[newMessages.length - 1].content.includes('生成失败') ||
             newMessages[newMessages.length - 1].content.includes('出错了'))) {
          newMessages.pop();
        }
        return newMessages;
      });

      const aiMessage: Message = {
        type: 'ai',
        content: response.prompt || '请选择一个选项，或者输入你自己的：',
        options: response.options || [],
        isMultiSelect: lastFailedRequest.step === 'genre'
      };
      setMessages(prev => [...prev, aiMessage]);
      setLastFailedRequest(null);
    } catch (error: any) {
      console.error('重试失败:', error);
      message.error('重试失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  // 步骤顺序
  const stepOrder: Step[] = ['idea', 'title', 'description', 'theme', 'genre', 'perspective', 'confirm'];

  const handleSendMessage = async () => {
    if (!inputValue.trim()) {
      message.warning('请输入内容');
      return;
    }

    const userMessage: Message = {
      type: 'user',
      content: inputValue,
    };
    setMessages(prev => [...prev, userMessage]);

    const userInput = inputValue;
    setInputValue('');
    setLoading(true);

    try {
      if (currentStep === 'idea') {
        const requestData = {
          step: 'title' as const,
          context: { idea: userInput },
          user_feedback: ""  // 初始生成时不传递用户反馈
        };

        const response = await inspirationApi.generateOptions(requestData);

        // 前端格式校验：检查是否有错误或选项数量不足
        if (response.error || !response.options || response.options.length < 3) {
          const errorMessage: Message = {
            type: 'ai',
            content: response.error
              ? `生成书名时出错：${response.error}\n\n你可以选择：`
              : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
            options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入书名']
          };
          setMessages(prev => [...prev, errorMessage]);
          setLastFailedRequest(requestData);
          return;
        }

        const aiMessage: Message = {
          type: 'ai',
          content: response.prompt || '请选择一个书名，或者输入你自己的：',
          options: response.options
        };
        setMessages(prev => [...prev, aiMessage]);
        setCurrentStep('title');
        setWizardData(prev => ({ ...prev, idea: userInput }));
        setLastFailedRequest(null);
      } else {
        // 对于其他步骤，用户输入应该重新生成当前步骤的选项，而不是进入下一步
        await handleCustomInput(userInput);
      }
    } catch (error: any) {
      console.error('发送消息失败:', error);
      message.error(error.response?.data?.detail || '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = async (option: string) => {
    if (option === '重新生成' && lastFailedRequest) {
      await handleRetry();
      return;
    }
    
    if (option === '我自己输入书名' || option === '我自己输入') {
      message.info('请在下方输入框中输入您的内容');
      return;
    }
    
    if (currentStep === 'genre') {
      const newSelected = selectedOptions.includes(option)
        ? selectedOptions.filter(o => o !== option)
        : [...selectedOptions, option];
      setSelectedOptions(newSelected);
      return;
    }
    
    if (currentStep === 'perspective') {
      // 叙事视角是单选
      const userMessage: Message = {
        type: 'user',
        content: option,
      };
      setMessages(prev => [...prev, userMessage]);
      
      const updatedData = { ...wizardData, narrative_perspective: option, genre: wizardData.genre || [] } as WizardData;
      setWizardData(updatedData);
      
      // 显示预览和确认选项
      const summary = `
太棒了！你的小说设定已完成，请确认：

💡 想法：${updatedData.idea}
📖 书名：${updatedData.title}
📝 简介：${updatedData.description}
🎯 主题：${updatedData.theme}
🏷️ 类型：${updatedData.genre.join('、')}
👁️ 视角：${updatedData.narrative_perspective}

请选择下一步操作：
      `.trim();

      const aiMessage: Message = {
        type: 'ai',
        content: summary,
        options: ['✅ 确认创建', '🔄 重新开始']
      };
      setMessages(prev => [...prev, aiMessage]);
      setCurrentStep('confirm');
      return;
    }
    
    if (currentStep === 'confirm') {
      if (option === '✅ 确认创建') {
        const userMessage: Message = {
          type: 'user',
          content: '确认创建',
        };
        setMessages(prev => [...prev, userMessage]);
        
        const aiMessage: Message = {
          type: 'ai',
          content: '好的！正在为你创建项目，这可能需要几分钟时间...'
        };
        setMessages(prev => [...prev, aiMessage]);
        
        // 开始生成项目
        await handleAutoGenerate(wizardData as WizardData);
        return;
      } else if (option === '🔄 重新开始') {
        handleRestart();
        return;
      }
    }

    const userMessage: Message = {
      type: 'user',
      content: option,
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const updatedData = { ...wizardData };
      if (currentStep === 'title') {
        updatedData.title = option;
      } else if (currentStep === 'description') {
        updatedData.description = option;
      } else if (currentStep === 'theme') {
        updatedData.theme = option;
      }
      setWizardData(updatedData);

      await generateNextStep(updatedData);
    } catch (error: any) {
      console.error('选择选项失败:', error);
      message.error(error.response?.data?.detail || '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomInput = async (input: string) => {
    setLoading(true);
    try {
      const updatedData = { ...wizardData };

      // 根据当前步骤更新数据
      if (currentStep === 'idea') {
        updatedData.idea = input;
      } else if (currentStep === 'title') {
        updatedData.title = input;
      } else if (currentStep === 'description') {
        updatedData.description = input;
      } else if (currentStep === 'theme') {
        updatedData.theme = input;
      } else if (currentStep === 'genre') {
        updatedData.genre = [input];
      } else if (currentStep === 'perspective') {
        updatedData.narrative_perspective = input;
      }

      setWizardData(updatedData);

      // 用户自定义输入时，重新生成当前步骤的选项（不进入下一步）
      if (currentStep === 'title') {
        // 重新生成标题选项，传递用户反馈
        const requestData = {
          step: 'title' as const,
          context: { idea: wizardData.idea || updatedData.idea },
          user_feedback: input  // 传递用户反馈
        };

        const response = await inspirationApi.generateOptions(requestData);

        if (response.error || !response.options || response.options.length < 3) {
          const errorMessage: Message = {
            type: 'ai',
            content: response.error
              ? `根据你的新想法重新生成书名时出错：${response.error}\n\n你可以选择：`
              : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
            options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入书名']
          };
          setMessages(prev => [...prev, errorMessage]);
          setLastFailedRequest(requestData);
          return;
        }

        const aiMessage: Message = {
          type: 'ai',
          content: response.prompt || '根据你的想法，我重新准备了几个书名：',
          options: response.options
        };
        setMessages(prev => [...prev, aiMessage]);
        setLastFailedRequest(null);
      } else if (currentStep === 'description') {
        // 重新生成简介选项，传递用户反馈
        const requestData = {
          step: 'description' as const,
          context: { idea: wizardData.idea, title: wizardData.title },
          user_feedback: input  // 传递用户反馈
        };

        const response = await inspirationApi.generateOptions(requestData);

        if (response.error || !response.options || response.options.length < 3) {
          const errorMessage: Message = {
            type: 'ai',
            content: response.error
              ? `重新生成简介时出错：${response.error}\n\n你可以选择：`
              : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
            options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入']
          };
          setMessages(prev => [...prev, errorMessage]);
          setLastFailedRequest(requestData);
          return;
        }

        const aiMessage: Message = {
          type: 'ai',
          content: response.prompt || '根据你的想法，我重新准备了几个简介：',
          options: response.options
        };
        setMessages(prev => [...prev, aiMessage]);
        setLastFailedRequest(null);
      } else if (currentStep === 'theme') {
        // 重新生成主题选项，传递用户反馈
        const requestData = {
          step: 'theme' as const,
          context: { idea: wizardData.idea, title: wizardData.title, description: wizardData.description },
          user_feedback: input  // 传递用户反馈
        };

        const response = await inspirationApi.generateOptions(requestData);

        if (response.error || !response.options || response.options.length < 3) {
          const errorMessage: Message = {
            type: 'ai',
            content: response.error
              ? `重新生成主题时出错：${response.error}\n\n你可以选择：`
              : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
            options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入']
          };
          setMessages(prev => [...prev, errorMessage]);
          setLastFailedRequest(requestData);
          return;
        }

        const aiMessage: Message = {
          type: 'ai',
          content: response.prompt || '根据你的想法，我重新准备了几个主题：',
          options: response.options
        };
        setMessages(prev => [...prev, aiMessage]);
        setLastFailedRequest(null);
      } else if (currentStep === 'genre') {
        // 重新生成类型选项，传递用户反馈
        const requestData = {
          step: 'genre' as const,
          context: { idea: wizardData.idea, title: wizardData.title, description: wizardData.description, theme: wizardData.theme },
          user_feedback: input  // 传递用户反馈
        };

        const response = await inspirationApi.generateOptions(requestData);

        if (response.error || !response.options || response.options.length < 3) {
          const errorMessage: Message = {
            type: 'ai',
            content: response.error
              ? `重新生成类型时出错：${response.error}\n\n你可以选择：`
              : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
            options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入']
          };
          setMessages(prev => [...prev, errorMessage]);
          setLastFailedRequest(requestData);
          return;
        }

        const aiMessage: Message = {
          type: 'ai',
          content: response.prompt || '根据你的想法，我重新准备了几个类型：',
          options: response.options,
          isMultiSelect: true
        };
        setMessages(prev => [...prev, aiMessage]);
        setLastFailedRequest(null);
      }
    } catch (error: any) {
      console.error('处理自定义输入失败:', error);
      message.error(error.response?.data?.detail || '处理失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 自动化生成项目流程
  const handleAutoGenerate = async (data: WizardData) => {
    try {
      setLoading(true);
      setCurrentStep('generating');
      setProjectTitle(data.title);
      setProgress(0);
      setProgressMessage('开始创建项目...');

      // 步骤1: 生成世界观并创建项目
      setGenerationSteps(prev => ({ ...prev, worldBuilding: 'processing' }));
      setProgressMessage('正在生成世界观...');
      
      const worldResult = await wizardStreamApi.generateWorldBuildingStream(
        {
          title: data.title,
          description: data.description,
          theme: data.theme,
          genre: data.genre.join('、'),
          narrative_perspective: data.narrative_perspective,
          target_words: 100000,
          chapter_count: 5,
          character_count: 5,
        },
        {
          onProgress: (msg, prog) => {
            setProgress(Math.floor(prog / 3));
            setProgressMessage(msg);
          },
          onResult: (result) => {
            setProjectId(result.project_id);
            setGenerationSteps(prev => ({ ...prev, worldBuilding: 'completed' }));
          },
          onError: (error) => {
            setGenerationSteps(prev => ({ ...prev, worldBuilding: 'error' }));
            throw new Error(error);
          },
          onComplete: () => {
            console.log('世界观生成完成');
          }
        }
      );

      if (!worldResult?.project_id) {
        throw new Error('项目创建失败');
      }

      const createdProjectId = worldResult.project_id;
      setProjectId(createdProjectId);

      // 步骤2: 生成角色
      setGenerationSteps(prev => ({ ...prev, characters: 'processing' }));
      setProgressMessage('正在生成角色...');
      
      await wizardStreamApi.generateCharactersStream(
        {
          project_id: createdProjectId,
          count: 5,
          world_context: {
            time_period: worldResult.time_period || '',
            location: worldResult.location || '',
            atmosphere: worldResult.atmosphere || '',
            rules: worldResult.rules || '',
          },
          theme: data.theme,
          genre: data.genre.join('、'),
        },
        {
          onProgress: (msg, prog) => {
            setProgress(33 + Math.floor(prog / 3));
            setProgressMessage(msg);
          },
          onResult: (result) => {
            console.log(`成功生成${result.characters?.length || 0}个角色`);
            setGenerationSteps(prev => ({ ...prev, characters: 'completed' }));
          },
          onError: (error) => {
            setGenerationSteps(prev => ({ ...prev, characters: 'error' }));
            throw new Error(error);
          },
          onComplete: () => {
            console.log('角色生成完成');
          }
        }
      );

      // 步骤3: 生成大纲
      setGenerationSteps(prev => ({ ...prev, outline: 'processing' }));
      setProgressMessage('正在生成大纲...');
      
      await wizardStreamApi.generateCompleteOutlineStream(
        {
          project_id: createdProjectId,
          chapter_count: 5,
          narrative_perspective: data.narrative_perspective,
          target_words: 100000,
        },
        {
          onProgress: (msg, prog) => {
            setProgress(66 + Math.floor(prog / 3));
            setProgressMessage(msg);
          },
          onResult: () => {
            console.log('大纲生成完成');
            setGenerationSteps(prev => ({ ...prev, outline: 'completed' }));
          },
          onError: (error) => {
            setGenerationSteps(prev => ({ ...prev, outline: 'error' }));
            throw new Error(error);
          },
          onComplete: () => {
            console.log('大纲生成完成');
          }
        }
      );

      // 全部完成
      setProgress(100);
      setProgressMessage('项目创建完成！');
      setCurrentStep('complete');
      message.success('项目创建成功！');
      
    } catch (error) {
      const apiError = error as ApiError;
      message.error('创建项目失败：' + (apiError.response?.data?.detail || apiError.message || '未知错误'));
      setCurrentStep('genre');
      setGenerationSteps({
        worldBuilding: 'pending',
        characters: 'pending',
        outline: 'pending'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmGenres = async () => {
    if (selectedOptions.length === 0) {
      message.warning('请至少选择一个类型');
      return;
    }

    const userMessage: Message = {
      type: 'user',
      content: selectedOptions.join('、'),
    };
    setMessages(prev => [...prev, userMessage]);

    const updatedData = { ...wizardData, genre: selectedOptions };
    setWizardData(updatedData);
    setSelectedOptions([]);
    
    // 进入叙事视角选择
    setLoading(true);
    try {
      const aiMessage: Message = {
        type: 'ai',
        content: '很好！最后一步，请选择小说的叙事视角：',
        options: ['第一人称', '第三人称', '全知视角']
      };
      setMessages(prev => [...prev, aiMessage]);
      setCurrentStep('perspective');
    } finally {
      setLoading(false);
    }
  };

  const generateNextStep = async (data: Partial<WizardData>) => {
    const currentIndex = stepOrder.indexOf(currentStep);
    const nextStep = stepOrder[currentIndex + 1];

    if (nextStep === 'description') {
      const requestData = {
        step: 'description' as const,
        context: { idea: wizardData.idea, title: data.title },
        user_feedback: ""  // 下一步骤不传递用户反馈
      };
      const response = await inspirationApi.generateOptions(requestData);

      // 前端格式校验
      if (response.error || !response.options || response.options.length < 3) {
        const errorMessage: Message = {
          type: 'ai',
          content: response.error
            ? `生成简介时出错：${response.error}\n\n你可以选择：`
            : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
          options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入']
        };
        setMessages(prev => [...prev, errorMessage]);
        setLastFailedRequest(requestData);
        return;
      }

      const aiMessage: Message = {
        type: 'ai',
        content: response.prompt || '请选择一个简介，或者输入你自己的：',
        options: response.options
      };
      setMessages(prev => [...prev, aiMessage]);
      setCurrentStep('description');
      setLastFailedRequest(null);

    } else if (nextStep === 'theme') {
      const requestData = {
        step: 'theme' as const,
        context: { title: data.title, description: data.description },
        user_feedback: ""  // 下一步骤不传递用户反馈
      };
      const response = await inspirationApi.generateOptions(requestData);

      // 前端格式校验
      if (response.error || !response.options || response.options.length < 3) {
        const errorMessage: Message = {
          type: 'ai',
          content: response.error
            ? `生成主题时出错：${response.error}\n\n你可以选择：`
            : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
          options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入']
        };
        setMessages(prev => [...prev, errorMessage]);
        setLastFailedRequest(requestData);
        return;
      }

      const aiMessage: Message = {
        type: 'ai',
        content: response.prompt || '请选择一个主题，或者输入你自己的：',
        options: response.options
      };
      setMessages(prev => [...prev, aiMessage]);
      setCurrentStep('theme');
      setLastFailedRequest(null);

    } else if (nextStep === 'genre') {
      const requestData = {
        step: 'genre' as const,
        context: {
          title: data.title,
          description: data.description,
          theme: data.theme
        },
        user_feedback: ""  // 下一步骤不传递用户反馈
      };
      const response = await inspirationApi.generateOptions(requestData);

      // 前端格式校验
      if (response.error || !response.options || response.options.length < 3) {
        const errorMessage: Message = {
          type: 'ai',
          content: response.error
            ? `生成类型时出错：${response.error}\n\n你可以选择：`
            : `生成的选项格式不正确（至少需要3个有效选项）\n\n你可以选择：`,
          options: response.options && response.options.length > 0 ? response.options : ['重新生成', '我自己输入'],
          isMultiSelect: false
        };
        setMessages(prev => [...prev, errorMessage]);
        setLastFailedRequest(requestData);
        return;
      }

      const aiMessage: Message = {
        type: 'ai',
        content: response.prompt || '请选择类型标签（可多选）：',
        options: response.options,
        isMultiSelect: true
      };
      setMessages(prev => [...prev, aiMessage]);
      setCurrentStep('genre');
      setLastFailedRequest(null);
    }
  };

  const handleRestart = () => {
    setCurrentStep('idea');
    setMessages([
      {
        type: 'ai',
        content: '🔄 好的！让我们重新来过！\n\n💪 带上你的新脑洞，我们再搞个大的！\n\n告诉我你这次想创造什么奇迹？',
      }
    ]);
    setWizardData({});
    setSelectedOptions([]);
    setLoading(false);
  };

  const handleBack = () => {
    navigate('/projects');
  };

  // 渲染生成进度页面
  const renderGenerating = () => {
    const getStepStatus = (step: 'pending' | 'processing' | 'completed' | 'error') => {
      if (step === 'completed') return { icon: <CheckCircleOutlined />, color: '#52c41a' };
      if (step === 'processing') return { icon: <LoadingOutlined />, color: '#1890ff' };
      if (step === 'error') return { icon: '✗', color: '#ff4d4f' };
      return { icon: '○', color: '#d9d9d9' };
    };

    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <Title level={3} style={{ marginBottom: 32, color: '#fff' }}>
          正在为《{projectTitle}》生成内容
        </Title>

        <Card style={{ marginBottom: 24 }}>
          <Progress
            percent={progress}
            status={progress === 100 ? 'success' : 'active'}
            strokeColor={{
              '0%': '#667eea',
              '100%': '#764ba2',
            }}
            style={{ marginBottom: 24 }}
          />

          <Paragraph style={{ fontSize: 16, marginBottom: 32, color: '#666' }}>
            {progressMessage}
          </Paragraph>

          <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>
            {[
              { key: 'worldBuilding', label: '生成世界观', step: generationSteps.worldBuilding },
              { key: 'characters', label: '生成角色', step: generationSteps.characters },
              { key: 'outline', label: '生成大纲', step: generationSteps.outline },
            ].map(({ key, label, step }) => {
              const status = getStepStatus(step);
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 20px',
                    background: step === 'processing' ? '#f0f5ff' : '#fafafa',
                    borderRadius: 8,
                    border: `1px solid ${step === 'processing' ? '#d6e4ff' : '#f0f0f0'}`,
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: step === 'processing' ? 600 : 400 }}>
                    {label}
                  </Text>
                  <span style={{ fontSize: 20, color: status.color }}>
                    {status.icon}
                  </span>
                </div>
              );
            })}
          </Space>
        </Card>

        <Paragraph type="secondary" style={{ color: '#fff', opacity: 0.9 }}>
          请耐心等待，AI正在为您精心创作...
        </Paragraph>
      </div>
    );
  };

  // 渲染完成页面
  const renderComplete = () => (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <Card>
        <div style={{ fontSize: 72, color: '#52c41a', marginBottom: 24 }}>
          ✓
        </div>
        <Title level={2} style={{ color: '#52c41a', marginBottom: 16 }}>
          项目创建完成！
        </Title>
        <Paragraph style={{ fontSize: 16, marginTop: 24, marginBottom: 48 }}>
          《{projectTitle}》已成功创建，包含完整的世界观、角色和开局大纲
        </Paragraph>
        
        <Space size={16}>
          <Button size="large" onClick={() => navigate('/')}>
            返回首页
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<RocketOutlined />}
            onClick={() => navigate(`/project/${projectId}`)}
          >
            进入项目
          </Button>
        </Space>
      </Card>
    </div>
  );

  // 渲染对话界面
  const renderChat = () => (
    <>
      {/* 对话区域 */}
      <Card
        ref={chatContainerRef}
        style={{
          height: window.innerWidth <= 768 ? 'calc(100vh - 280px)' : 600,
          overflowY: 'auto',
          marginBottom: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          scrollBehavior: 'smooth'
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {messages.map((msg, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: msg.type === 'ai' ? 'flex-start' : 'flex-end',
                alignItems: 'flex-start',
                animation: 'fadeInUp 0.5s ease-out',
                animationFillMode: 'both',
                animationDelay: `${index * 0.1}s`
              }}
            >
              <div style={{
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: 12,
                background: msg.type === 'ai' ? '#f0f0f0' : '#1890ff',
                color: msg.type === 'ai' ? '#000' : '#fff',
                boxShadow: msg.type === 'ai'
                  ? '0 2px 8px rgba(0,0,0,0.08)'
                  : '0 2px 8px rgba(24,144,255,0.3)',
              }}>
                <Paragraph 
                  style={{ 
                    margin: 0, 
                    color: msg.type === 'ai' ? '#000' : '#fff',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {msg.content}
                </Paragraph>
                
                {/* 选项卡片 */}
                {msg.options && msg.options.length > 0 && (
                  <Space
                    direction="vertical"
                    style={{ width: '100%', marginTop: 12 }}
                    size="small"
                  >
                    {msg.options.map((option, optIndex) => (
                      <Card
                        key={optIndex}
                        hoverable
                        size="small"
                        onClick={() => handleSelectOption(option)}
                        style={{
                          cursor: 'pointer',
                          border: msg.isMultiSelect && selectedOptions.includes(option)
                            ? '2px solid #1890ff'
                            : '1px solid #d9d9d9',
                          background: msg.isMultiSelect && selectedOptions.includes(option)
                            ? '#e6f7ff'
                            : '#fff',
                          animation: 'floatIn 0.6s ease-out',
                          animationDelay: `${optIndex * 0.1}s`,
                          animationFillMode: 'both',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(24,144,255,0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0) scale(1)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        {option}
                      </Card>
                    ))}
                    
                    {/* 多选确认按钮 */}
                    {msg.isMultiSelect && (
                      <Button
                        type="primary"
                        block
                        onClick={handleConfirmGenres}
                        disabled={selectedOptions.length === 0}
                      >
                        确认选择 ({selectedOptions.length})
                      </Button>
                    )}
                  </Space>
                )}
              </div>
            </div>
          ))}
          
          {loading && (
            <div style={{
              textAlign: 'center',
              padding: 20,
              animation: 'fadeIn 0.3s ease-in'
            }}>
              <Spin tip="AI思考中..." />
            </div>
          )}
          
          {/* 滚动锚点 */}
          <div ref={messagesEndRef} />
        </Space>
      </Card>

      {/* 输入区域 */}
      <Card
        style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
        styles={{ body: { padding: 12 } }}
      >
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              currentStep === 'idea' 
                ? '例如：我想写一本关于时间旅行的科幻小说...'
                : '输入自定义内容，或点击上方选项卡片...'
            }
            autoSize={{ minRows: 2, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={loading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendMessage}
            loading={loading}
            style={{ height: 'auto' }}
          >
            发送
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          💡 提示：按 Enter 发送，Shift+Enter 换行
        </Text>
      </Card>
    </>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: window.innerWidth <= 768 ? '12px' : '24px'
    }}>
      <style>
        {`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          @keyframes floatIn {
            0% {
              opacity: 0;
              transform: translateY(10px) scale(0.95);
            }
            60% {
              transform: translateY(-5px) scale(1.02);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        `}
      </style>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{
          marginBottom: window.innerWidth <= 768 ? 12 : 24,
          position: 'relative'
        }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
            type="text"
            size={window.innerWidth <= 768 ? 'small' : 'middle'}
            style={{
              color: '#fff',
              padding: window.innerWidth <= 768 ? '4px 8px' : '4px 15px',
              height: window.innerWidth <= 768 ? 32 : 'auto',
              position: window.innerWidth <= 768 ? 'absolute' : 'static',
              left: 0,
              top: 0,
              zIndex: 1
            }}
          >
            {window.innerWidth <= 768 ? '返回' : '返回项目列表'}
          </Button>
          <div style={{
            textAlign: 'center',
            paddingTop: window.innerWidth <= 768 ? 0 : 0
          }}>
            <Title
              level={window.innerWidth <= 768 ? 4 : 2}
              style={{
                color: '#fff',
                margin: 0,
                marginBottom: window.innerWidth <= 768 ? 4 : 8
              }}
            >
              ✨ 灵感模式
            </Title>
            <Text style={{
              color: '#fff',
              display: 'block',
              fontSize: window.innerWidth <= 768 ? 12 : 14,
              opacity: 0.9
            }}>
              通过对话快速创建你的小说项目
            </Text>
          </div>
        </div>

        {/* 根据当前步骤渲染不同内容 */}
        {(currentStep === 'idea' || currentStep === 'title' || currentStep === 'description' ||
          currentStep === 'theme' || currentStep === 'genre' || currentStep === 'perspective' ||
          currentStep === 'confirm') && renderChat()}
        {currentStep === 'generating' && renderGenerating()}
        {currentStep === 'complete' && renderComplete()}
      </div>
    </div>
  );
};

export default Inspiration;
              