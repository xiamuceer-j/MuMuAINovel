import axios from 'axios';
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
  OutlineExpansionRequest,
  OutlineExpansionResponse,
  BatchOutlineExpansionRequest,
  BatchOutlineExpansionResponse,
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
  PromptWorkshopListResponse,
  PromptWorkshopItem,
  PromptSubmission,
  PromptSubmissionCreate,
  Announcement,
  AnnouncementCreate,
  AnnouncementListResponse,
  AnnouncementStatusResponse,
  AnnouncementUpdate,
  MCPPlugin,
  MCPPluginCreate,
  MCPPluginUpdate,
  MCPTestResult,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResponse,
  APIKeyPreset,
  PresetCreateRequest,
  PresetUpdateRequest,
  PresetListResponse,
  ChapterPlanItem,
  BookImportTask,
  BookImportPreview,
  BookImportApplyPayload,
  BookImportCreateTaskPayload,
  BookImportResult,
  BookImportRetryResult,
  BatchAnalysisStatusResponse,
  BatchAnalyzeUnanalyzedRequest,
  BatchAnalyzeUnanalyzedResponse,
} from '../types';

interface MCPPluginSimpleCreate {
  config_json: string;
  enabled: boolean;
}

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
        case 401: {
          const backendDetail = data?.detail || data?.message;
          const unauthenticatedDetails = [
            '未登录',
            '需要登录',
            '未登录或用户ID缺失',
            '未登录，无法刷新会话',
          ];
          const isUnauthenticated = unauthenticatedDetails.includes(backendDetail);

          errorMessage = backendDetail || '登录状态已失效，请重新登录';

          if (isUnauthenticated && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          break;
        }
        case 403:
          errorMessage = data?.detail || '没有权限访问';
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
  getAuthConfig: () => api.get<unknown, {
    local_auth_enabled: boolean;
    linuxdo_enabled: boolean;
    email_auth_enabled: boolean;
    email_register_enabled: boolean;
  }>('/auth/config'),

  localLogin: (username: string, password: string) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/local/login', { username, password }),

  bindAccountLogin: (username: string, password: string) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/bind/login', { username, password }),

  emailLogin: (payload: import('../types').EmailLoginPayload) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/email/login', payload),

  sendEmailCode: (payload: import('../types').EmailSendCodePayload) =>
    api.post<unknown, { success: boolean; message: string; expire_in_seconds: number; resend_interval_seconds: number }>('/auth/email/send-code', payload),

  emailRegister: (payload: import('../types').EmailRegisterPayload) =>
    api.post<unknown, { success: boolean; message: string; user: User }>('/auth/email/register', payload),

  resetEmailPassword: (payload: import('../types').EmailResetPasswordPayload) =>
    api.post<unknown, { success: boolean; message: string }>('/auth/email/reset-password', payload),

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

  initializePassword: (password: string) =>
    api.post<unknown, { success: boolean; message: string }>('/auth/password/initialize', { password }),

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

  getAvailableModels: (params: { api_key?: string; api_base_url?: string; provider: string }) =>
    api.get<unknown, { provider: string; models: Array<{ value: string; label: string; description: string }>; count?: number }>('/settings/models', { params }),

  testApiConnection: (params: { api_key?: string; api_base_url?: string; provider: string; llm_model: string; temperature?: number; max_tokens?: number }) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      response_time_ms?: number;
      provider?: string;
      model?: string;
      response_preview?: string;
      details?: Record<string, boolean | number>;
      error?: string;
      error_type?: string;
      suggestions?: string[];
    }>('/settings/test', params),

  testCoverConnection: (params: { cover_api_provider: string; cover_api_key: string; cover_api_base_url?: string; cover_image_model: string }) =>
    api.post<unknown, {
      success: boolean;
      message: string;
      provider?: string;
      model?: string;
    }>('/settings/cover/test', params),

  checkFunctionCalling: (params: { api_key?: string; api_base_url?: string; provider: string; llm_model: string }) =>
    api.post<unknown, {
      success: boolean;
      supported: boolean;
      message: string;
      response_time_ms?: number;
      provider?: string;
      model?: string;
      details?: {
        finish_reason?: string;
        has_tool_calls?: boolean;
        tool_call_count?: number;
        test_tool?: string;
        test_prompt?: string;
        response_type?: string;
      };
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name: string;
          arguments: string;
        };
      }>;
      response_preview?: string;
      error?: string;
      error_type?: string;
      suggestions?: string[];
    }>('/settings/check-function-calling', params),

  // API配置预设管理
  getPresets: () =>
    api.get<unknown, PresetListResponse>('/settings/presets'),

  createPreset: (data: PresetCreateRequest) =>
    api.post<unknown, APIKeyPreset>('/settings/presets', data),

  updatePreset: (presetId: string, data: PresetUpdateRequest) =>
    api.put<unknown, APIKeyPreset>(`/settings/presets/${presetId}`, data),

  deletePreset: (presetId: string) =>
    api.delete<unknown, { message: string; preset_id: string }>(`/settings/presets/${presetId}`),

  activatePreset: (presetId: string) =>
    api.post<unknown, { message: string; preset_id: string; preset_name: string }>(`/settings/presets/${presetId}/activate`),

  testPreset: (presetId: string) =>
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
    }>(`/settings/presets/${presetId}/test`),

  setChapterAnalysisPresetSelection: (presetId?: string) =>
    api.put<unknown, { message: string; chapter_analysis_preset_id?: string; preset_name?: string }>('/settings/presets/usage/chapter-analysis', {
      preset_id: presetId || null,
    }),

  createPresetFromCurrent: (name: string, description?: string) =>
    api.post<unknown, APIKeyPreset>('/settings/presets/from-current', null, {
      params: { name, description }
    }),

  getSystemSMTPSettings: () =>
    api.get<unknown, import('../types').SystemSMTPSettings>('/settings/system/smtp'),

  updateSystemSMTPSettings: (data: import('../types').SystemSMTPSettingsUpdate) =>
    api.put<unknown, import('../types').SystemSMTPSettings>('/settings/system/smtp', data),

  testSystemSMTPSettings: (data: { to_email: string }) =>
    api.post<unknown, { success: boolean; message: string }>('/settings/system/smtp/test', data),
};

export const projectApi = {
  getProjects: () => api.get<unknown, Project[]>('/projects'),

  getProject: (id: string) => api.get<unknown, Project>(`/projects/${id}`),

  createProject: (data: ProjectCreate) => api.post<unknown, Project>('/projects', data),

  updateProject: (id: string, data: ProjectUpdate) =>
    api.put<unknown, Project>(`/projects/${id}`, data),

  deleteProject: (id: string) => api.delete(`/projects/${id}`),

  generateCover: (id: string, overwrite: boolean = true) =>
    api.post<unknown, {
      project_id: string;
      cover_status: string;
      cover_image_url?: string;
      cover_prompt?: string;
      provider?: string;
      model?: string;
      message: string;
    }>(`/projects/${id}/cover/generate`, { overwrite }),

  downloadCover: async (id: string, filename?: string) => {
    const response = await axios.get(`/api/projects/${id}/cover/download`, {
      responseType: 'blob',
      withCredentials: true,
    });
    const contentDisposition = response.headers['content-disposition'];
    let finalFilename = filename || 'novel-cover.png';
    if (contentDisposition) {
      const utf8Match = /filename\*=UTF-8''(.+)/.exec(contentDisposition);
      const basicMatch = /filename="?([^";]+)"?/.exec(contentDisposition);
      if (utf8Match?.[1]) {
        finalFilename = decodeURIComponent(utf8Match[1]);
      } else if (basicMatch?.[1]) {
        finalFilename = basicMatch[1];
      }
    }
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', finalFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  exportProject: (id: string) => {
    window.open(`/api/projects/${id}/export`, '_blank');
  },

  // 导出项目数据为JSON
  exportProjectData: async (id: string, options: {
    include_generation_history?: boolean;
    include_writing_styles?: boolean;
    include_careers?: boolean;
    include_memories?: boolean;
    include_plot_analysis?: boolean;
  }) => {
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

export const bookImportApi = {
  createTask: (params: BookImportCreateTaskPayload) => {
    const formData = new FormData();
    formData.append('file', params.file);
    const tailChapterCount = params.tail_chapter_count ?? 10;
    formData.append('extract_mode', params.extract_mode ?? 'tail');
    formData.append('tail_chapter_count', String(tailChapterCount));

    return api.post<unknown, { task_id: string; status: BookImportTask['status'] }>(
      '/book-import/tasks',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },

  getTaskStatus: (taskId: string) =>
    api.get<unknown, BookImportTask>(`/book-import/tasks/${taskId}`),

  getPreview: (taskId: string) =>
    api.get<unknown, BookImportPreview>(`/book-import/tasks/${taskId}/preview`),

  applyImport: (taskId: string, payload: BookImportApplyPayload) =>
    api.post<unknown, BookImportResult>(`/book-import/tasks/${taskId}/apply`, payload),

  applyImportStream: (
    taskId: string,
    payload: BookImportApplyPayload,
    options?: SSEClientOptions,
  ) => ssePost<BookImportResult>(
    `/api/book-import/tasks/${taskId}/apply-stream`,
    payload,
    options,
  ),

  retryFailedStepsStream: (
    taskId: string,
    steps: string[],
    options?: SSEClientOptions,
  ) => ssePost<BookImportRetryResult>(
    `/api/book-import/tasks/${taskId}/retry-stream`,
    { steps },
    options,
  ),

  cancelTask: (taskId: string) =>
    api.delete<unknown, { success: boolean; message: string }>(`/book-import/tasks/${taskId}`),
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

  // 获取大纲关联的章节
  getOutlineChapters: (outlineId: string) =>
    api.get<unknown, {
      has_chapters: boolean;
      outline_id: string;
      outline_title: string;
      chapter_count: number;
      chapters: Array<{
        id: string;
        chapter_number: number;
        title: string;
        summary: string;
        sub_index: number;
        status: string;
        word_count: number;
      }>;
      expansion_plans: Array<{
        sub_index: number;
        title: string;
        plot_summary: string;
        key_events: string[];
        character_focus: string[];
        emotional_tone: string;
        narrative_goal: string;
        conflict_type: string;
        estimated_words: number;
        scenes?: Array<{
          location: string;
          characters: string[];
          purpose: string;
        }> | null;
      }> | null;
    }>(`/outlines/${outlineId}/chapters`),

  // 单个大纲展开为多章
  expandOutline: (outlineId: string, data: OutlineExpansionRequest) =>
    api.post<unknown, OutlineExpansionResponse>(`/outlines/${outlineId}/expand`, data),

  // 根据已有规划创建章节（避免重复AI调用）
  createChaptersFromPlans: (outlineId: string, chapterPlans: ChapterPlanItem[]) =>
    api.post<unknown, {
      outline_id: string;
      outline_title: string;
      chapters_created: number;
      created_chapters: Array<{
        id: string;
        chapter_number: number;
        title: string;
        summary: string;
        outline_id: string;
        sub_index: number;
        status: string;
      }>;
    }>(`/outlines/${outlineId}/create-chapters-from-plans`, { chapter_plans: chapterPlans }),

  // 批量展开大纲
  batchExpandOutlines: (data: BatchOutlineExpansionRequest) =>
    api.post<unknown, BatchOutlineExpansionResponse>('/outlines/batch-expand', data),
};

export const characterApi = {
  getCharacters: (projectId: string) =>
    api.get<unknown, { total: number; items: Character[] }>(`/characters/project/${projectId}`).then(res => res.items),

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

  // 导出角色/组织
  exportCharacters: async (characterIds: string[]) => {
    const response = await axios.post(
      '/api/characters/export',
      { character_ids: characterIds },
      {
        responseType: 'blob',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // 从响应头获取文件名
    const contentDisposition = response.headers['content-disposition'];
    let filename = 'characters_export.json';
    if (contentDisposition) {
      const matches = /filename=(.+)/.exec(contentDisposition);
      if (matches && matches[1]) {
        filename = matches[1];
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
  validateImportCharacters: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<unknown, {
      valid: boolean;
      version: string;
      statistics: { characters: number; organizations: number };
      errors: string[];
      warnings: string[];
    }>('/characters/validate-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // 导入角色/组织
  importCharacters: (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<unknown, {
      success: boolean;
      message: string;
      statistics: {
        total: number;
        imported: number;
        skipped: number;
        errors: number;
      };
      details: {
        imported_characters: string[];
        imported_organizations: string[];
        skipped: string[];
        errors: string[];
      };
      warnings: string[];
    }>(`/characters/import?project_id=${projectId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const chapterApi = {
  getChapters: (projectId: string) =>
    api.get<unknown, { total: number; items: Chapter[] }>(`/chapters/project/${projectId}`).then(res => res.items),

  getChapter: (id: string) => api.get<unknown, Chapter>(`/chapters/${id}`),

  createChapter: (data: ChapterCreate) => api.post<unknown, Chapter>('/chapters', data),

  updateChapter: (id: string, data: ChapterUpdate) =>
    api.put<unknown, Chapter>(`/chapters/${id}`, data),

  deleteChapter: (id: string) => api.delete(`/chapters/${id}`),

  checkCanGenerate: (chapterId: string) =>
    api.get<unknown, import('../types').ChapterCanGenerateResponse>(`/chapters/${chapterId}/can-generate`),

  getBatchAnalysisStatuses: (projectId: string, chapterIds?: string[]) =>
    api.post<unknown, BatchAnalysisStatusResponse>(`/chapters/project/${projectId}/analysis/statuses`, {
      chapter_ids: chapterIds && chapterIds.length > 0 ? chapterIds : undefined,
    }),

  batchAnalyzeUnanalyzed: (projectId: string, data?: BatchAnalyzeUnanalyzedRequest) =>
    api.post<unknown, BatchAnalyzeUnanalyzedResponse>(`/chapters/project/${projectId}/analysis/analyze-unanalyzed`, {
      chapter_ids: data?.chapter_ids && data.chapter_ids.length > 0 ? data.chapter_ids : undefined,
    }),

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

  // 局部重写相关
  partialRegenerateStream: (
    chapterId: string,
    data: {
      selected_text: string;
      start_position: number;
      end_position: number;
      user_instructions: string;
      context_chars?: number;
      style_id?: number;
      length_mode?: 'similar' | 'expand' | 'condense' | 'custom';
      target_word_count?: number;
    },
    options?: SSEClientOptions
  ) => ssePost<{
    new_text: string;
    word_count: number;
    original_word_count: number;
    start_position: number;
    end_position: number;
  }>(
    `/api/chapters/${chapterId}/partial-regenerate-stream`,
    data,
    options
  ),

  applyPartialRegenerate: (chapterId: string, data: {
    new_text: string;
    start_position: number;
    end_position: number;
  }) =>
    api.post<unknown, {
      success: boolean;
      chapter_id: string;
      word_count: number;
      old_word_count: number;
      message: string;
    }>(`/chapters/${chapterId}/apply-partial-regenerate`, data),
};

export const writingStyleApi = {
  // 获取预设风格列表
  getPresetStyles: () =>
    api.get<unknown, PresetStyle[]>('/writing-styles/presets/list'),

  // 获取用户的所有风格（新接口）
  getUserStyles: () =>
    api.get<unknown, WritingStyleListResponse>('/writing-styles/user'),

  // 获取项目的所有风格（保留向后兼容）
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

export const promptWorkshopApi = {
  // 检查服务状态
  getStatus: () =>
    api.get<unknown, { mode: string; instance_id: string; cloud_url?: string; cloud_connected?: boolean }>('/prompt-workshop/status'),

  // 获取工坊提示词列表
  getItems: (params?: {
    category?: string;
    search?: string;
    tags?: string;
    sort?: 'newest' | 'popular' | 'downloads';
    page?: number;
    limit?: number;
  }) => api.get<unknown, PromptWorkshopListResponse>('/prompt-workshop/items', { params }),

  // 获取单个提示词
  getItem: (itemId: string) =>
    api.get<unknown, { success: boolean; data: PromptWorkshopItem }>(`/prompt-workshop/items/${itemId}`),

  // 导入到本地
  importItem: (itemId: string, customName?: string) =>
    api.post<unknown, { success: boolean; message: string; writing_style: WritingStyle }>(
      `/prompt-workshop/items/${itemId}/import`,
      { custom_name: customName }
    ),

  // 点赞
  toggleLike: (itemId: string) =>
    api.post<unknown, { success: boolean; liked: boolean; like_count: number }>(
      `/prompt-workshop/items/${itemId}/like`
    ),

  // 提交提示词
  submit: (data: PromptSubmissionCreate) =>
    api.post<unknown, { success: boolean; message: string; submission: PromptSubmission }>('/prompt-workshop/submit', data),

  // 我的提交
  getMySubmissions: (status?: string) =>
    api.get<unknown, { success: boolean; data: { total: number; items: PromptSubmission[] } }>(
      '/prompt-workshop/my-submissions',
      { params: { status } }
    ),

  // 撤回提交（pending状态）
  withdrawSubmission: (submissionId: string) =>
    api.delete<unknown, { success: boolean; message: string }>(`/prompt-workshop/submissions/${submissionId}`),

  // 删除提交记录（所有状态，需要 force=true）
  deleteSubmission: (submissionId: string) =>
    api.delete<unknown, { success: boolean; message: string }>(`/prompt-workshop/submissions/${submissionId}`, {
      params: { force: true }
    }),

  // ========== 管理员 API（仅服务端模式可用） ==========
  
  // 获取待审核列表
  adminGetSubmissions: (params?: { status?: string; source?: string; page?: number; limit?: number }) =>
    api.get<unknown, {
      success: boolean;
      data: {
        total: number;
        pending_count: number;
        page: number;
        limit: number;
        items: PromptSubmission[];
      };
    }>('/prompt-workshop/admin/submissions', { params }),

  // 审核提交
  adminReviewSubmission: (submissionId: string, data: { action: 'approve' | 'reject'; review_note?: string; category?: string; tags?: string[] }) =>
    api.post<unknown, { success: boolean; message: string; workshop_item?: PromptWorkshopItem; submission?: PromptSubmission }>(
      `/prompt-workshop/admin/submissions/${submissionId}/review`,
      data
    ),

  // 添加官方提示词
  adminCreateItem: (data: { name: string; description?: string; prompt_content: string; category: string; tags?: string[] }) =>
    api.post<unknown, { success: boolean; item: PromptWorkshopItem }>('/prompt-workshop/admin/items', data),

  // 编辑提示词
  adminUpdateItem: (itemId: string, data: { name?: string; description?: string; prompt_content?: string; category?: string; tags?: string[]; status?: string }) =>
    api.put<unknown, { success: boolean; item: PromptWorkshopItem }>(`/prompt-workshop/admin/items/${itemId}`, data),

  // 删除提示词
  adminDeleteItem: (itemId: string) =>
    api.delete<unknown, { success: boolean; message: string }>(`/prompt-workshop/admin/items/${itemId}`),

  // 获取统计数据
  adminGetStats: () =>
    api.get<unknown, {
      success: boolean;
      data: {
        total_items: number;
        total_official: number;
        total_pending: number;
        total_downloads: number;
        total_likes: number;
      };
    }>('/prompt-workshop/admin/stats'),
};

export const announcementApi = {
  getStatus: () =>
    api.get<unknown, AnnouncementStatusResponse>('/announcements/status'),

  list: (params?: { page?: number; limit?: number }) =>
    api.get<unknown, AnnouncementListResponse>('/announcements', { params }),

  sync: (params?: { since?: string; limit?: number }) =>
    api.get<unknown, AnnouncementListResponse>('/announcements/sync', { params }),

  adminList: (params?: { status?: string; q?: string; page?: number; limit?: number; include_expired?: boolean }) =>
    api.get<unknown, AnnouncementListResponse>('/announcements/admin/items', { params }),

  adminCreate: (data: AnnouncementCreate) =>
    api.post<unknown, { success: boolean; item: Announcement }>('/announcements/admin/items', data),

  adminUpdate: (id: string, data: AnnouncementUpdate) =>
    api.put<unknown, { success: boolean; item: Announcement }>(`/announcements/admin/items/${id}`, data),

  adminDelete: (id: string) =>
    api.delete<unknown, { success: boolean; message: string }>(`/announcements/admin/items/${id}`),

  adminPublish: (id: string) =>
    api.post<unknown, { success: boolean; item: Announcement }>(`/announcements/admin/items/${id}/publish`),

  adminHide: (id: string) =>
    api.post<unknown, { success: boolean; item: Announcement }>(`/announcements/admin/items/${id}/hide`),
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
      title?: string;
      description?: string;
      theme?: string;
    };
  }) =>
    api.post<unknown, {
      prompt?: string;
      options: string[];
      error?: string;
    }>('/inspiration/generate-options', data),

  // 基于用户反馈重新生成选项（新增）
  refineOptions: (data: {
    step: 'title' | 'description' | 'theme' | 'genre';
    context: {
      initial_idea?: string;
      title?: string;
      description?: string;
      theme?: string;
    };
    feedback: string;
    previous_options?: string[];
  }) =>
    api.post<unknown, {
      prompt?: string;
      options: string[];
      error?: string;
    }>('/inspiration/refine-options', data),

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
      outline_mode?: 'one-to-one' | 'one-to-many';  // 添加大纲模式参数
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

  generateCareerSystemStream: (
    data: {
      project_id: string;
      provider?: string;
      model?: string;
    },
    options?: SSEClientOptions
  ) => ssePost<{
    project_id: string;
    main_careers_count: number;
    sub_careers_count: number;
    main_careers: string[];
    sub_careers: string[];
  }>(
    '/api/wizard-stream/career-system',
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

// 伏笔管理API
export const foreshadowApi = {
  // 获取项目伏笔列表
  getProjectForeshadows: (projectId: string, params?: {
    status?: string;
    category?: string;
    source_type?: string;
    is_long_term?: boolean;
    page?: number;
    limit?: number;
  }) =>
    api.get<unknown, import('../types').ForeshadowListResponse>(
      `/foreshadows/projects/${projectId}`,
      { params }
    ),

  // 获取伏笔统计
  getForeshadowStats: (projectId: string, currentChapter?: number) =>
    api.get<unknown, import('../types').ForeshadowStats>(
      `/foreshadows/projects/${projectId}/stats`,
      { params: { current_chapter: currentChapter } }
    ),

  // 获取章节伏笔上下文
  getChapterContext: (projectId: string, chapterNumber: number, params?: {
    include_pending?: boolean;
    include_overdue?: boolean;
    lookahead?: number;
  }) =>
    api.get<unknown, import('../types').ForeshadowContextResponse>(
      `/foreshadows/projects/${projectId}/context/${chapterNumber}`,
      { params }
    ),

  // 获取待回收伏笔
  getPendingResolveForeshadows: (projectId: string, currentChapter: number, lookahead?: number) =>
    api.get<unknown, { total: number; items: import('../types').Foreshadow[] }>(
      `/foreshadows/projects/${projectId}/pending-resolve`,
      { params: { current_chapter: currentChapter, lookahead } }
    ),

  // 获取单个伏笔
  getForeshadow: (foreshadowId: string) =>
    api.get<unknown, import('../types').Foreshadow>(`/foreshadows/${foreshadowId}`),

  // 创建伏笔
  createForeshadow: (data: import('../types').ForeshadowCreate) =>
    api.post<unknown, import('../types').Foreshadow>('/foreshadows', data),

  // 更新伏笔
  updateForeshadow: (foreshadowId: string, data: import('../types').ForeshadowUpdate) =>
    api.put<unknown, import('../types').Foreshadow>(`/foreshadows/${foreshadowId}`, data),

  // 删除伏笔
  deleteForeshadow: (foreshadowId: string) =>
    api.delete<unknown, { message: string; id: string }>(`/foreshadows/${foreshadowId}`),

  // 标记伏笔为已埋入
  plantForeshadow: (foreshadowId: string, data: import('../types').PlantForeshadowRequest) =>
    api.post<unknown, import('../types').Foreshadow>(`/foreshadows/${foreshadowId}/plant`, data),

  // 标记伏笔为已回收
  resolveForeshadow: (foreshadowId: string, data: import('../types').ResolveForeshadowRequest) =>
    api.post<unknown, import('../types').Foreshadow>(`/foreshadows/${foreshadowId}/resolve`, data),

  // 标记伏笔为已废弃
  abandonForeshadow: (foreshadowId: string, reason?: string) =>
    api.post<unknown, import('../types').Foreshadow>(
      `/foreshadows/${foreshadowId}/abandon`,
      null,
      { params: { reason } }
    ),

  // 从分析结果同步伏笔
  syncFromAnalysis: (projectId: string, data: import('../types').SyncFromAnalysisRequest) =>
    api.post<unknown, import('../types').SyncFromAnalysisResponse>(
      `/foreshadows/projects/${projectId}/sync-from-analysis`,
      data
    ),
};