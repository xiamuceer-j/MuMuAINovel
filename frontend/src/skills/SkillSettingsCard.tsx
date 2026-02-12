import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Select, Space, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { skillsApi, settingsApi } from '../services/api';
import type { SkillSpecResponse, Settings } from '../types';

const { Text } = Typography;

function safeParsePreferences(preferences?: string): Record<string, unknown> {
  if (!preferences) return {};
  try {
    return JSON.parse(preferences) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function SkillSettingsCard() {
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<SkillSpecResponse[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const options = useMemo(() => {
    return [
      { value: '__none__', label: '不启用技能' },
      ...skills.map((s) => ({ value: s.skill_key, label: s.name })),
    ];
  }, [skills]);

  const activeSkill = useMemo(() => {
    if (!activeKey) return null;
    return skills.find((s) => s.skill_key === activeKey) || null;
  }, [activeKey, skills]);

  async function reloadAll() {
    setLoading(true);
    try {
      await skillsApi.sync();
      const list = await skillsApi.list();
      setSkills(list.items || []);

      const settings: Settings = await settingsApi.getSettings();
      const prefs = safeParsePreferences(settings.preferences);
      const key = typeof prefs.active_skill_key === 'string' ? (prefs.active_skill_key as string) : null;
      setActiveKey(key);
    } finally {
      setLoading(false);
    }
  }

  async function activate(next: string) {
    const nextKey = next === '__none__' ? null : next;
    setLoading(true);
    try {
      await skillsApi.activate(nextKey);
      setActiveKey(nextKey);
      message.success(nextKey ? '技能已启用' : '技能已关闭');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadAll();
  }, []);

  return (
    <Card
      title="技能"
      style={{
        marginBottom: 16,
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        background: 'var(--color-bg-container)',
        border: '1px solid var(--color-border-light)',
      }}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reloadAll}>
          同步
        </Button>
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Select
          value={activeKey ?? '__none__'}
          onChange={activate}
          options={options}
          loading={loading}
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
        />
        <Text type="secondary">同步会从 .opencode/skills 导入最新技能规范，并让 AI 调用自动应用到系统提示词。</Text>

        {activeSkill ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {activeSkill.allowed_tools ? (
              <Text type="secondary">允许工具：{activeSkill.allowed_tools}</Text>
            ) : (
              <Text type="secondary">允许工具：不限制</Text>
            )}
            {activeSkill.api_provider_override ? (
              <Text type="secondary">Provider 覆盖：{activeSkill.api_provider_override}</Text>
            ) : null}
            {activeSkill.model_override ? (
              <Text type="secondary">模型覆盖：{activeSkill.model_override}</Text>
            ) : null}
            {activeSkill.temperature_override ? (
              <Text type="secondary">温度覆盖：{activeSkill.temperature_override}</Text>
            ) : null}
            {activeSkill.max_tokens_override ? (
              <Text type="secondary">Max tokens 覆盖：{activeSkill.max_tokens_override}</Text>
            ) : null}
          </Space>
        ) : null}
      </Space>
    </Card>
  );
}
