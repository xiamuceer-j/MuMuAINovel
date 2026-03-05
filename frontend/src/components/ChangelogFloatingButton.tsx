import { useState } from 'react';
import { FloatButton } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import ChangelogModal from './ChangelogModal';
import { useViewport } from '../hooks/useViewport';

export default function ChangelogFloatingButton() {
  const [showChangelog, setShowChangelog] = useState(false);
  const { isMobile } = useViewport();

  // 移动端不显示悬浮按钮，避免遮挡主内容与底部操作区域
  if (isMobile) {
    return null;
  }

  return (
    <>
      <FloatButton
        icon={<FileTextOutlined />}
        type="primary"
        tooltip="查看更新日志"
        style={{
          right: 24,
          bottom: 100,
          // 确保 zIndex 低于侧边栏但高于内容
          zIndex: 999,
        }}
        onClick={() => setShowChangelog(true)}
      />

      <ChangelogModal
        visible={showChangelog}
        onClose={() => setShowChangelog(false)}
      />
    </>
  );
}
