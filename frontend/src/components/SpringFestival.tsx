/**
 * 🧧 春节喜庆装饰组件
 * 
 * 包含以下元素：
 * - 🏮 悬挂灯笼（左右各两个）
 * - 🎆 烟花效果（canvas-confetti）
 * - 🌸 飘落装饰物（梅花、福字等）
 * - 🧧 新春祝福横幅
 * - 可通过右侧浮动按钮控制开关（支持拖动+自动贴边）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import './SpringFestival.css';

// 春节日期范围检测（农历新年前后各15天左右）
function isSpringFestivalSeason(): boolean {
  // 简单判断：每年1月15日 ~ 3月5日期间显示
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  return (month === 1 && day >= 15) || month === 2 || (month === 3 && day <= 5);
}

// 飘落装饰物配置
const FALLING_ITEMS = ['🌸', '✨', '🧧', '💮', '🎐', '❄️', '🏮'];
const SPRING_COUPLETS = [
  '马年大吉',
  '恭喜发财',
  '红包拿来',
  '万事如意',
  '阖家欢乐',
  '新春快乐',
  '福星高照',
];

interface FallingItem {
  id: number;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
}

interface BtnPosition {
  x: number;
  y: number;
  side: 'left' | 'right';
}

// 默认按钮位置：右侧贴边居中
function getDefaultBtnPosition(): BtnPosition {
  return {
    x: window.innerWidth - 22, // 贴右边
    y: window.innerHeight / 2,
    side: 'right',
  };
}

// 从 localStorage 读取保存的位置
function loadBtnPosition(): BtnPosition {
  try {
    const saved = localStorage.getItem('sf-btn-position');
    if (saved) {
      const pos = JSON.parse(saved) as BtnPosition;
      // 确保在可视区域内
      pos.y = Math.max(22, Math.min(window.innerHeight - 22, pos.y));
      pos.x = pos.side === 'left' ? 22 : window.innerWidth - 22;
      return pos;
    }
  } catch { /* ignore */ }
  return getDefaultBtnPosition();
}

function readEnabled(): boolean {
  const saved = localStorage.getItem('spring-festival-enabled');
  return saved === null ? true : saved === 'true';
}

export default function SpringFestival() {
  const [enabled, setEnabled] = useState(readEnabled);

  const [visible, setVisible] = useState(() => {
    if (!readEnabled()) return false;
    const saved = localStorage.getItem('spring-festival-visible');
    if (saved !== null) return saved === 'true';
    return isSpringFestivalSeason();
  });

  const [showBanner, setShowBanner] = useState(true);
  const [bannerText] = useState(() => {
    return SPRING_COUPLETS[Math.floor(Math.random() * SPRING_COUPLETS.length)];
  });

  // 灯笼文字：从 SPRING_COUPLETS 中取四字词，定时轮换
  const [lanternChars, setLanternChars] = useState<string[]>(() => {
    const text = SPRING_COUPLETS[Math.floor(Math.random() * SPRING_COUPLETS.length)];
    return text.split('');
  });
  const [lanternFading, setLanternFading] = useState(false);
  const lanternIndexRef = useRef(Math.floor(Math.random() * SPRING_COUPLETS.length));

  const [fallingItems, setFallingItems] = useState<FallingItem[]>([]);
  const fireworksIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lanternIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idCounterRef = useRef(0);

  // 按钮拖动相关状态
  const [btnPos, setBtnPos] = useState<BtnPosition>(loadBtnPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; startBtnX: number; startBtnY: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 监听外部开关（例如用户菜单中的开关）
  useEffect(() => {
    const handleExternalToggle = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      const nextEnabled = Boolean(customEvent.detail);
      setEnabled(nextEnabled);
      localStorage.setItem('spring-festival-enabled', String(nextEnabled));

      if (nextEnabled) {
        const savedVisible = localStorage.getItem('spring-festival-visible');
        const nextVisible = savedVisible !== null ? savedVisible === 'true' : true;
        setVisible(nextVisible);
        setShowBanner(true);
      } else {
        setVisible(false);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'spring-festival-enabled' && event.newValue !== null) {
        const nextEnabled = event.newValue === 'true';
        setEnabled(nextEnabled);
        if (!nextEnabled) {
          setVisible(false);
        } else {
          const savedVisible = localStorage.getItem('spring-festival-visible');
          const nextVisible = savedVisible !== null ? savedVisible === 'true' : true;
          setVisible(nextVisible);
          setShowBanner(true);
        }
      }
    };

    window.addEventListener('spring-festival-toggle', handleExternalToggle as EventListener);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('spring-festival-toggle', handleExternalToggle as EventListener);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 生成飘落物
  const createFallingItem = useCallback((): FallingItem => {
    idCounterRef.current += 1;
    return {
      id: idCounterRef.current,
      emoji: FALLING_ITEMS[Math.floor(Math.random() * FALLING_ITEMS.length)],
      left: Math.random() * 100,
      delay: 0,
      duration: 6 + Math.random() * 8,
      size: 12 + Math.random() * 16,
    };
  }, []);

  // 烟花效果
  const launchFirework = useCallback(() => {
    if (!visible) return;

    const colors = ['#FF0000', '#FFD700', '#FF6347', '#FF4500', '#FFA500', '#DC143C'];

    confetti({
      particleCount: 30 + Math.floor(Math.random() * 30),
      spread: 60 + Math.random() * 40,
      origin: {
        x: 0.1 + Math.random() * 0.8,
        y: 0.2 + Math.random() * 0.4,
      },
      colors: colors.slice(0, 3 + Math.floor(Math.random() * 3)),
      shapes: ['circle', 'square'],
      gravity: 0.8,
      scalar: 0.8 + Math.random() * 0.4,
      drift: (Math.random() - 0.5) * 0.5,
      ticks: 200,
      disableForReducedMotion: true,
    });
  }, [visible]);

  // 初始烟花欢迎效果
  const launchWelcomeFireworks = useCallback(() => {
    const positions = [
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.3 },
    ];

    positions.forEach((pos, i) => {
      setTimeout(() => {
        confetti({
          particleCount: 60,
          spread: 80,
          origin: pos,
          colors: ['#FF0000', '#FFD700', '#FF6347', '#FF4500', '#DC143C', '#FFA500'],
          shapes: ['circle', 'square'],
          gravity: 0.7,
          scalar: 1,
          ticks: 250,
          disableForReducedMotion: true,
        });
      }, i * 400);
    });
  }, []);

  // 管理飘落物和烟花
  useEffect(() => {
    if (!visible) {
      setFallingItems([]);
      if (fireworksIntervalRef.current) {
        clearTimeout(fireworksIntervalRef.current);
        fireworksIntervalRef.current = null;
      }
      if (fallingIntervalRef.current) {
        clearInterval(fallingIntervalRef.current);
        fallingIntervalRef.current = null;
      }
      if (lanternIntervalRef.current) {
        clearInterval(lanternIntervalRef.current);
        lanternIntervalRef.current = null;
      }
      return;
    }

    // 初始生成一批飘落物
    const initialItems: FallingItem[] = [];
    for (let i = 0; i < 12; i++) {
      const item = createFallingItem();
      item.delay = Math.random() * 8;
      initialItems.push(item);
    }
    setFallingItems(initialItems);

    // 初始欢迎烟花
    setTimeout(launchWelcomeFireworks, 1000);

    // 定期添加新飘落物
    fallingIntervalRef.current = setInterval(() => {
      setFallingItems(prev => {
        const kept = prev.slice(-15);
        return [...kept, createFallingItem()];
      });
    }, 3000);

    // 定期发射烟花（每20-40秒一次）
    const scheduleFirework = () => {
      const delay = 20000 + Math.random() * 20000;
      fireworksIntervalRef.current = setTimeout(() => {
        launchFirework();
        scheduleFirework();
      }, delay);
    };
    scheduleFirework();

    // 灯笼文字定时轮换（每10秒）
    lanternIntervalRef.current = setInterval(() => {
      // 先触发淡出
      setLanternFading(true);
      // 500ms 后切换文字并淡入
      setTimeout(() => {
        lanternIndexRef.current = (lanternIndexRef.current + 1) % SPRING_COUPLETS.length;
        const newText = SPRING_COUPLETS[lanternIndexRef.current];
        setLanternChars(newText.split(''));
        setLanternFading(false);
      }, 500);
    }, 10000);

    return () => {
      if (fireworksIntervalRef.current) {
        clearTimeout(fireworksIntervalRef.current);
        fireworksIntervalRef.current = null;
      }
      if (fallingIntervalRef.current) {
        clearInterval(fallingIntervalRef.current);
        fallingIntervalRef.current = null;
      }
      if (lanternIntervalRef.current) {
        clearInterval(lanternIntervalRef.current);
        lanternIntervalRef.current = null;
      }
    };
  }, [visible, createFallingItem, launchFirework, launchWelcomeFireworks]);

  // 横幅自动隐藏
  useEffect(() => {
    if (visible && showBanner) {
      const timer = setTimeout(() => setShowBanner(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [visible, showBanner]);

  // ===== 按钮拖动逻辑 =====
  
  // 自动贴边
  const snapToEdge = useCallback((x: number, y: number): BtnPosition => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btnRadius = 22;
    const clampedY = Math.max(btnRadius, Math.min(vh - btnRadius, y));
    
    // 根据距离左右边缘决定贴哪边
    const side: 'left' | 'right' = x < vw / 2 ? 'left' : 'right';
    const snapX = side === 'left' ? btnRadius : vw - btnRadius;
    
    return { x: snapX, y: clampedY, side };
  }, []);

  // 鼠标/触摸按下
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    dragStartRef.current = {
      startX: clientX,
      startY: clientY,
      startBtnX: btnPos.x,
      startBtnY: btnPos.y,
    };
    setIsDragging(true);
    setHasDragged(false);
  }, [btnPos]);

  // 鼠标/触摸移动
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragStartRef.current) return;
      
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const dx = clientX - dragStartRef.current.startX;
      const dy = clientY - dragStartRef.current.startY;
      
      // 移动超过5px才算拖动
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        setHasDragged(true);
      }
      
      const newX = dragStartRef.current.startBtnX + dx;
      const newY = dragStartRef.current.startBtnY + dy;
      
      setBtnPos({
        x: newX,
        y: Math.max(22, Math.min(window.innerHeight - 22, newY)),
        side: newX < window.innerWidth / 2 ? 'left' : 'right',
      });
    };

    const handleEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      
      // 自动贴边
      setBtnPos(prev => {
        const snapped = snapToEdge(prev.x, prev.y);
        // 保存到 localStorage
        localStorage.setItem('sf-btn-position', JSON.stringify(snapped));
        return snapped;
      });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, snapToEdge]);

  // 窗口大小变化时重新贴边
  useEffect(() => {
    const handleResize = () => {
      setBtnPos(prev => snapToEdge(prev.side === 'left' ? 22 : window.innerWidth - 22, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [snapToEdge]);

  // ===== 鼠标交互效果 =====

  // 鼠标点击页面时发射小烟花
  const handlePageClick = useCallback((e: MouseEvent) => {
    if (!visible) return;
    // 忽略按钮和灯笼区域的点击（避免与其他交互冲突）
    const target = e.target as HTMLElement;
    if (target.closest('.sf-toggle-btn') || target.closest('.sf-banner')) return;
    
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    
    confetti({
      particleCount: 15 + Math.floor(Math.random() * 15),
      spread: 40 + Math.random() * 30,
      origin: { x, y },
      colors: ['#FF0000', '#FFD700', '#FF6347', '#FF4500'],
      shapes: ['circle'],
      gravity: 1.2,
      scalar: 0.6 + Math.random() * 0.3,
      ticks: 120,
      disableForReducedMotion: true,
    });
  }, [visible]);

  // 绑定全局鼠标点击事件
  useEffect(() => {
    if (!visible) return;
    
    window.addEventListener('click', handlePageClick);
    
    return () => {
      window.removeEventListener('click', handlePageClick);
    };
  }, [visible, handlePageClick]);

  // 点击灯笼：爆发烟花 + 立即切换祝福语
  const handleLanternClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 获取灯笼位置发射烟花
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;
    
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { x, y },
      colors: ['#FF0000', '#FFD700', '#FF6347', '#FF4500', '#DC143C'],
      shapes: ['circle', 'square'],
      gravity: 0.8,
      scalar: 0.9,
      ticks: 200,
      disableForReducedMotion: true,
    });

    // 立即切换祝福语（带淡入淡出）
    setLanternFading(true);
    setTimeout(() => {
      lanternIndexRef.current = (lanternIndexRef.current + 1) % SPRING_COUPLETS.length;
      const newText = SPRING_COUPLETS[lanternIndexRef.current];
      setLanternChars(newText.split(''));
      setLanternFading(false);
    }, 400);
  }, []);

  // 切换显示状态（只有未拖动时才触发）
  const handleBtnClick = () => {
    if (!enabled) return;
    if (hasDragged) return; // 拖动过就不触发点击
    const next = !visible;
    setVisible(next);
    localStorage.setItem('spring-festival-visible', String(next));
    if (next) {
      setShowBanner(true);
    }
  };

  // 计算按钮样式
  const btnStyle: React.CSSProperties = {
    position: 'fixed',
    left: btnPos.x - 22,
    top: btnPos.y - 22,
    transition: isDragging ? 'none' : 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.1s ease',
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
    userSelect: 'none',
  };

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* 控制按钮 - 始终显示，可拖动 */}
      <button
        ref={btnRef}
        className={`sf-toggle-btn ${isDragging ? 'sf-dragging' : ''}`}
        style={btnStyle}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onClick={handleBtnClick}
        title={visible ? '关闭春节装饰' : '开启春节装饰'}
      >
        {visible ? '🧨' : '🏮'}
      </button>

      {visible && (
        <>
          {/* 新春祝福横幅 */}
          {showBanner && (
            <div className="sf-banner" onClick={() => setShowBanner(false)}>
              <div className="sf-banner-content">
                <span className="sf-banner-icon">🧧</span>
                <span className="sf-banner-text">
                  {bannerText}
                </span>
                <span className="sf-banner-icon">🧧</span>
              </div>
            </div>
          )}

          {/* 灯笼 - 左侧（往中间靠拢），可点击 */}
          <div className="sf-lantern-group sf-lantern-left sf-lantern-clickable" onClick={handleLanternClick}>
            <div className="sf-lantern sf-lantern-1">
              <div className="sf-lantern-line"></div>
              <div className="sf-lantern-body">
                <div className="sf-lantern-top"></div>
                <div className="sf-lantern-middle">
                  <span className={`sf-lantern-char ${lanternFading ? 'sf-char-fade-out' : 'sf-char-fade-in'}`}>
                    {lanternChars[0] || '福'}
                  </span>
                </div>
                <div className="sf-lantern-bottom"></div>
                <div className="sf-lantern-tassel"></div>
              </div>
            </div>
            <div className="sf-lantern sf-lantern-2">
              <div className="sf-lantern-line"></div>
              <div className="sf-lantern-body">
                <div className="sf-lantern-top"></div>
                <div className="sf-lantern-middle">
                  <span className={`sf-lantern-char ${lanternFading ? 'sf-char-fade-out' : 'sf-char-fade-in'}`}>
                    {lanternChars[1] || '春'}
                  </span>
                </div>
                <div className="sf-lantern-bottom"></div>
                <div className="sf-lantern-tassel"></div>
              </div>
            </div>
          </div>

          {/* 灯笼 - 右侧（往中间靠拢），可点击 */}
          <div className="sf-lantern-group sf-lantern-right sf-lantern-clickable" onClick={handleLanternClick}>
            <div className="sf-lantern sf-lantern-3">
              <div className="sf-lantern-line"></div>
              <div className="sf-lantern-body">
                <div className="sf-lantern-top"></div>
                <div className="sf-lantern-middle">
                  <span className={`sf-lantern-char ${lanternFading ? 'sf-char-fade-out' : 'sf-char-fade-in'}`}>
                    {lanternChars[2] || '喜'}
                  </span>
                </div>
                <div className="sf-lantern-bottom"></div>
                <div className="sf-lantern-tassel"></div>
              </div>
            </div>
            <div className="sf-lantern sf-lantern-4">
              <div className="sf-lantern-line"></div>
              <div className="sf-lantern-body">
                <div className="sf-lantern-top"></div>
                <div className="sf-lantern-middle">
                  <span className={`sf-lantern-char ${lanternFading ? 'sf-char-fade-out' : 'sf-char-fade-in'}`}>
                    {lanternChars[3] || '乐'}
                  </span>
                </div>
                <div className="sf-lantern-bottom"></div>
                <div className="sf-lantern-tassel"></div>
              </div>
            </div>
          </div>

          {/* 飘落装饰物 */}
          <div className="sf-falling-container">
            {fallingItems.map(item => (
              <span
                key={item.id}
                className="sf-falling-item"
                style={{
                  left: `${item.left}%`,
                  animationDelay: `${item.delay}s`,
                  animationDuration: `${item.duration}s`,
                  fontSize: `${item.size}px`,
                }}
              >
                {item.emoji}
              </span>
            ))}
          </div>

          {/* 顶部红色装饰条 */}
          <div className="sf-top-border"></div>
        </>
      )}
    </>
  );
}
