import { Card, Select, Space, Typography } from 'antd';
import { useThemeStore } from './store';
import { getAvailableThemes } from './index';
import { useEffect } from 'react';

const { Text } = Typography;

export function ThemeSettingsCard() {
  const { currentThemeId, setCurrentTheme, availableThemes, setAvailableThemes } = useThemeStore();

  const themes = availableThemes;
  const activeTheme = themes.find((t) => t.id === currentThemeId);

  useEffect(() => {
    if (!themes.length) {
      setAvailableThemes(getAvailableThemes());
    }
  }, [themes.length, setAvailableThemes]);

  return (
    <Card
      title="界面主题"
      style={{
        marginBottom: 16,
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        background: 'var(--color-bg-container)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Select
          value={currentThemeId}
          onChange={setCurrentTheme}
          style={{ width: '100%' }}
          options={themes.map((t) => ({ value: t.id, label: t.name }))}
        />
        {activeTheme?.description ? (
          <Text type="secondary">{activeTheme.description}</Text>
        ) : (
          <Text type="secondary">切换后将即时生效（覆盖 AntD 主题与部分全局 CSS 变量）。</Text>
        )}
      </Space>
    </Card>
  );
}
