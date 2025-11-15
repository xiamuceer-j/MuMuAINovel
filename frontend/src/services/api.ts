import axios from 'axios';

interface MCPPluginSimpleCreate {
  config_json: string;
  enabled: boolean;
}
import { message } from 'antd';
import { ssePost } from '../utils/sseClient';
import type { SSEClientOptions } from '../utils/sseClient';
import type {
  User,
  AuthUrlResponse,
  Project,
  ProjectCreate,
  ProjectUpdate,
  WorldBuildingResponse,
  Outline,
  OutlineCreate,
  OutlineUpdate,
  OutlineReorderRequest,
  Character,
  CharacterUpdate,
  Chapter,
  ChapterCreate,
  ChapterUpdate,
  GenerateOutlineRequest,
  GenerateCharacterRequest,
  PolishTextRequest,
  GenerateCharactersResponse,
  GenerateOutlineResponse,
  Settings,
  SettingsUpdate,
  WritingStyle,
  WritingStyleCreate,
  WritingStyleUpdate,
  PresetStyle,
  WritingStyleListResponse,
  MCPPlugin,
  MCPPluginCreate,
  MCPPluginUpdate,
  MCPTestResult,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    let errorMessage = '请求失败';
    
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      switch (status) {
        case 400:
          errorMessage = data?.detail || '请求参数错误';
          break;
        case 401:
          errorMessage = '未授权，请先登录';
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          break;
        case 403:
          errorMessage = '没有权限访问';
          break;
        case 404:
          errorMessage = data?.detail || '请求的资源不存在';
          break;
        case 422:
          errorMessage = data?.detail || '请求参数验证失败';
          if (data?.errors) {
            console.error('验证错误详情:', data.errors);
          }
          break;
        case 500:
          errorMessage = data?.detail || '服务器内部错误';
          break;
        case 503:
          errorMessage = '服务暂时不可用，请稍后重试';
          break;
        default:
          errorMessage = data?.detail || data?.message || `请求失败 (${status})`;
      }
    } else if (error.request) {
      errorMessage = '网络错误，请检查网络连接';
    } else {
      errorMessage = error.message || '请求失败';
    }
    
    message.error(errorMessage);
    console.error('API Error:', errorMessage, error);
    
    return Promise.reject(error);
  }
);

export const authApi = {
  getAuthConfig: () => api.get<unknown, { local_auth_enabled: boolean; linuxdo_enabled: boolean }>('/auth/config'),
  
  localLogin: (username: string, password: string) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/local/login', { username, password }),
  
  bindAccountLogin: (username: string, password: string) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/bind/login', { username, password }),
  
  getLinuxDOAuthUrl: () => api.get<unknown, AuthUrlResponse>('/auth/linuxdo/url'),
  
  getCurrentUser: () => api.get<unknown, User>('/auth/user'),
  
  getPasswordStatus: () => api.get<unknown, {
    has_password: boolean;
    has_custom_password: boolean;
    username: string | null;
    default_password: string | null;
  }>('/auth/password/status'),
  
  setPassword: (password: string) =>
    api.post<unknown, { success: boolean; message: string }>('/auth/password/set', { password }),
  
  refreshSession: () => api.post<unknown, { message: string; expire_at: number; remaining_minutes: number }>('/auth/refresh'),
  
  logout: () => api.post('/auth/logout'),
};

export const userApi = {
  getCurrentUser: () => api.get<unknown, User>('/users/current'),
  
  listUsers: () => api.get<unknown, User[]>('/users'),
  
  setAdmin: (userId: string, isAdmin: boolean) =>
    api.post('/users/set-admin', { user_id: userId, is_admin: isAdmin }),
  
  deleteUser: (userId: string) => api.delete(`/users/${userId}`),
  
  getUser: (userId: string) => api.get<unknown, User>(`/users/${userId}`),
  
  resetPassword: (userId: string, newPassword?: string) =>
    api.post<unknown, {
      message: string;
      user_id: string;
      username: string;
      default_password?: string;
    }>('/users/reset-password', { user_id: userId, new_password: newPassword }),
};

export const settingsApi = {
  getSettings: () => api.get<unknown, Settings>('/settings'),
  
  saveSettings: (data: SettingsUpdate) =>
    api.post<unknown, Settings>('/settings', data),
  
  updateSettings: (data: SettingsUpdate) =>
    api.put<unknown, Settings>('/settings', data),
  
  deleteSettings: () => api.delete<unknown, { message: string; user_id: string }>('/settings'),
  
  getAvailableModels: (params: { api_key: string; api_base_url: string; provider: string }) =>
    api.get<unknown, { provider: string; models: Array<{ value: string; label: string; description: string }>; count?: number }>('/settings/models', { params }),
  
  testApiConnection: (params: { api_key: string; api_base_url: string; provider: string; llm_model: string }) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      response_time_ms?: number;
      provider?: string;
      model?: string;
      response_preview?: string;
      details?: Record<string, boolean>;
      error?: string;
      error_type?: string;
      suggestions?: string[];
    }>('/settings/test', params),
};

export const projectApi = {
  getProjects: () => api.get<unknown, Project[]>('/projects'),
  
  getProject: (id: string) => api.get<unknown, Project>(`/projects/${id}`),
  
  createProject: (data: ProjectCreate) => api.post<unknown, Project>('/projects', data),
  
  updateProject: (id: string, data: ProjectUpdate) =>
    api.put<unknown, Project>(`/projects/${id}`, data),
  
  deleteProject: (id: string) => api.delete(`/projects/${id}`),
  
  exportProject: (id: string) => {
    window.open(`/api/projects/${id}/export`, '_blank');
  },
  
  // 导出项目数据为JSON
  exportProjectData: async (id: string, options: { include_generation_history?: boolean; include_writing_styles?: boolean }) => {
    const response = await axios.post(
      `/api/projects/${id}/export-data`,
      options,
      {
        responseType: 'blob',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    // 从响应头获取文件名
    const contentDisposition = response.headers['content-disposition'];
    let filename = 'project_export.json';
    if (contentDisposition) {
      const matches = /filename\*=UTF-8''(.+)/.exec(contentDisposition);
      if (matches && matches[1]) {
        filename = decodeURIComponent(matches[1]);
      }
    }
    
    // 创建下载链接
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
  
  // 验证导入文件
  validateImportFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<unknown, {
      valid: boolean;
      version: string;
      project_name?: string;
      statistics: Record<string, number>;
      errors: string[];
      warnings: string[];
    }>('/projects/validate-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  // 导入项目
  importProject: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<unknown, {
      success: boolean;
      project_id?: string;
      message: string;
      statistics: Record<string, number>;
      warnings: string[];
    }>('/projects/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const outlineApi = {
  getOutlines: (projectId: string) =>
    api.get<unknown, { total: number; items: Outline[] }>(`/outlines/project/${projectId}`).then(res => res.items),
  
  getOutline: (id: string) => api.get<unknown, Outline>(`/outlines/${id}`),
  
  createOutline: (data: OutlineCreate) => api.post<unknown, Outline>('/outlines', data),
  
  updateOutline: (id: string, data: OutlineUpdate) =>
    api.put<unknown, Outline>(`/outlines/${id}`, data),
  
  deleteOutline: (id: string) => api.delete(`/outlines/${id}`),
  
  reorderOutlines: (data: OutlineReorderRequest) =>
    api.post<unknown, { message: string; updated_outlines: number; updated_chapters: number }>('/outlines/reorder', data),
  
  generateOutline: (data: GenerateOutlineRequest) =>
    api.post<unknown, { total: number; items: Outline[] }>('/outlines/generate', data).then(res => res.items),
};

export const characterApi = {
  getCharacters: (projectId: string) =>
    api.get<unknown, Character[]>(`/characters/project/${projectId}`),
  
  getCharacter: (id: string) => api.get<unknown, Character>(`/characters/${id}`),
  
  createCharacter: (data: {
    project_id: string;
    name: string;
    age?: string;
    gender?: string;
    is_organization?: boolean;
    role_type?: string;
    personality?: string;
    background?: string;
    appearance?: string;
    relationships?: string;
    organization_type?: string;
    organization_purpose?: string;
    organization_members?: string;
    traits?: string;
    avatar_url?: string;
    power_level?: number;
    location?: string;
    motto?: string;
    color?: string;
  }) =>
    api.post<unknown, Character>('/characters', data),
  
  updateCharacter: (id: string, data: CharacterUpdate) =>
    api.put<unknown, Character>(`/characters/${id}`, data),
  
  deleteCharacter: (id: string) => api.delete(`/characters/${id}`),
  
  generateCharacter: (data: GenerateCharacterRequest) =>
    api.post<unknown, Character>('/characters/generate', data),
};

export const chapterApi = {
  getChapters: (projectId: string) =>
    api.get<unknown, Chapter[]>(`/chapters/project/${projectId}`),
  
  getChapter: (id: string) => api.get<unknown, Chapter>(`/chapters/${id}`),
  
  createChapter: (data: ChapterCreate) => api.post<unknown, Chapter>('/chapters', data),
  
  updateChapter: (id: string, data: ChapterUpdate) =>
    api.put<unknown, Chapter>(`/chapters/${id}`, data),
  
  deleteChapter: (id: string) => api.delete(`/chapters/${id}`),
  
  checkCanGenerate: (chapterId: string) =>
    api.get<unknown, import('../types').ChapterCanGenerateResponse>(`/chapters/${chapterId}/can-generate`),
  
  // 章节重新生成相关
  getRegenerationTasks: (chapterId: string, limit?: number) =>
    api.get<unknown, {
      chapter_id: string;
      total: number;
      tasks: Array<{
        task_id: string;
        status: string;
        version_number: number | null;
        version_note: string | null;
        original_word_count: number | null;
        regenerated_word_count: number | null;
        created_at: string | null;
        completed_at: string | null;
      }>;
    }>(`/chapters/${chapterId}/regeneration/tasks`, { params: { limit } }),
};

export const writingStyleApi = {
  // 获取预设风格列表
  getPresetStyles: () =>
    api.get<unknown, PresetStyle[]>('/writing-styles/presets/list'),
  
  // 获取项目的所有风格
  getProjectStyles: (projectId: string) =>
    api.get<unknown, WritingStyleListResponse>(`/writing-styles/project/${projectId}`),
  
  // 创建新风格（基于预设或自定义）
  createStyle: (data: WritingStyleCreate) =>
    api.post<unknown, WritingStyle>('/writing-styles', data),
  
  // 更新风格
  updateStyle: (styleId: number, data: WritingStyleUpdate) =>
    api.put<unknown, WritingStyle>(`/writing-styles/${styleId}`, data),
  
  // 删除风格
  deleteStyle: (styleId: number) =>
    api.delete<unknown, { message: string }>(`/writing-styles/${styleId}`),
  
  // 设置默认风格
  setDefaultStyle: (styleId: number, projectId: string) =>
    api.post<unknown, WritingStyle>(`/writing-styles/${styleId}/set-default`, { project_id: projectId }),
  
  // 为项目初始化默认风格（如果没有任何风格）
  initializeDefaultStyles: (projectId: string) =>
    api.post<unknown, WritingStyleListResponse>(`/writing-styles/project/${projectId}/initialize`, {}),
};

export const polishApi = {
  polishText: (data: PolishTextRequest) =>
    api.post<unknown, { polished_text: string }>('/polish', data),
  
  polishBatch: (texts: string[]) =>
    api.post<unknown, { polished_texts: string[] }>('/polish/batch', { texts }),
};
export const inspirationApi = {
  // 生成选项建议
  generateOptions: (data: {
    step: 'title' | 'description' | 'theme' | 'genre';
    context: {
      idea?: string;
      title?: string;
      description?: string;
      theme?: string;
    };
    user_feedback?: string;  // 新增：用户反馈字段
  }) =>
    api.post<unknown, {
      prompt?: string;
      options: string[];
      error?: string;
    }>('/inspiration/generate-options', data),
  
  // 智能补全缺失信息
  quickGenerate: (data: {
    title?: string;
    description?: string;
    theme?: string;
    genre?: string | string[];
  }) =>
    api.post<unknown, {
      title: string;
      description: string;
      theme: string;
      genre: string[];
      narrative_perspective: string;
    }>('/inspiration/quick-generate', data),
};

export default api;


export const wizardStreamApi = {
  generateWorldBuildingStream: (
    data: {
      title: string;
      description: string;
      theme: string;
      genre: string | string[];
      narrative_perspective?: string;
      target_words?: number;
      chapter_count?: number;
      character_count?: number;
      provider?: string;
      model?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<WorldBuildingResponse>(
    '/api/wizard-stream/world-building',
    data,
    options
  ),

  generateCharactersStream: (
    data: {
      project_id: string;
      count?: number;
      world_context?: Record<string, string>;
      theme?: string;
      genre?: string;
      requirements?: string;
      provider?: string;
      model?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<GenerateCharactersResponse>(
    '/api/wizard-stream/characters',
    data,
    options
  ),

  generateCompleteOutlineStream: (
    data: {
      project_id: string;
      chapter_count: number;
      narrative_perspective: string;
      target_words?: number;
      requirements?: string;
      provider?: string;
      model?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<GenerateOutlineResponse>(
    '/api/wizard-stream/outline',
    data,
    options
  ),

  updateWorldBuildingStream: (
    projectId: string,
    data: {
      time_period?: string;
      location?: string;
      atmosphere?: string;
      rules?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<WorldBuildingResponse>(
    `/api/wizard-stream/world-building/${projectId}`,
    data,
    options
  ),

  regenerateWorldBuildingStream: (
    projectId: string,
    data?: {
      provider?: string;
      model?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<WorldBuildingResponse>(
    `/api/wizard-stream/world-building/${projectId}/regenerate`,
    data || {},
    options
  ),

  cleanupWizardDataStream: (
    projectId: string,
    options?: SSEClientOptions
  ) => ssePost<{ message: string; deleted: { characters: number; outlines: number; chapters: number } }>(
    `/api/wizard-stream/cleanup/${projectId}`,
    {},
    options
  ),
};

export const mcpPluginApi = {
  // 获取所有插件
  getPlugins: () =>
    api.get<unknown, MCPPlugin[]>('/mcp/plugins'),
  
  // 获取单个插件
  getPlugin: (id: string) =>
    api.get<unknown, MCPPlugin>(`/mcp/plugins/${id}`),
  
  // 创建插件
  createPlugin: (data: MCPPluginCreate) =>
    api.post<unknown, MCPPlugin>('/mcp/plugins', data),
  
  // 简化创建插件（通过标准MCP配置JSON）
  createPluginSimple: (data: MCPPluginSimpleCreate) =>
    api.post<unknown, MCPPlugin>('/mcp/plugins/simple', data),
  
  // 更新插件
  updatePlugin: (id: string, data: MCPPluginUpdate) =>
    api.put<unknown, MCPPlugin>(`/mcp/plugins/${id}`, data),
  
  // 删除插件
  deletePlugin: (id: string) =>
    api.delete<unknown, { message: string }>(`/mcp/plugins/${id}`),
  
  // 启用/禁用插件
  togglePlugin: (id: string, enabled: boolean) =>
    api.post<unknown, MCPPlugin>(`/mcp/plugins/${id}/toggle`, null, { params: { enabled } }),
  
  // 测试插件连接
  testPlugin: (id: string) =>
    api.post<unknown, MCPTestResult>(`/mcp/plugins/${id}/test`),
  
  // 获取插件工具列表
  getPluginTools: (id: string) =>
    api.get<unknown, { tools: MCPTool[] }>(`/mcp/plugins/${id}/tools`),
  
  // 调用工具
  callTool: (data: MCPToolCallRequest) =>
    api.post<unknown, MCPToolCallResponse>('/mcp/call', data),
};

// 管理员API
export const adminApi = {
  // 获取用户列表
  getUsers: () =>
    api.get<unknown, { total: number; users: User[] }>('/admin/users'),
  
  // 添加用户
  createUser: (data: {
    username: string;
    display_name: string;
    password?: string;
    avatar_url?: string;
    trust_level?: number;
    is_admin?: boolean;
  }) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      user: User;
      default_password?: string;
    }>('/admin/users', data),
  
  // 编辑用户
  updateUser: (userId: string, data: {
    display_name?: string;
    avatar_url?: string;
    trust_level?: number;
  }) =>
    api.put<unknown, {
      success: boolean;
      message: string;
      user: User;
    }>(`/admin/users/${userId}`, data),
  
  // 切换用户状态（启用/禁用）
  toggleUserStatus: (userId: string, isActive: boolean) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      is_active: boolean;
    }>(`/admin/users/${userId}/toggle-status`, { is_active: isActive }),
  
  // 重置密码
  resetPassword: (userId: string, newPassword?: string) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      new_password: string;
    }>(`/admin/users/${userId}/reset-password`, { new_password: newPassword }),
  
  // 删除用户
  deleteUser: (userId: string) =>
    api.delete<unknown, {
      success: boolean;
      message: string;
    }>(`/admin/users/${userId}`),
};