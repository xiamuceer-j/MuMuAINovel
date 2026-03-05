import { useEffect, useState } from 'react';

export type ViewportMode = 'desktop' | 'mobile-portrait' | 'mobile-landscape';

export const DESKTOP_BREAKPOINT = 1024;

function getViewportMode(width: number, height: number): ViewportMode {
  if (width >= DESKTOP_BREAKPOINT) return 'desktop';
  return height >= width ? 'mobile-portrait' : 'mobile-landscape';
}

export interface ViewportInfo {
  width: number;
  height: number;
  mode: ViewportMode;
  isDesktop: boolean;
  isMobile: boolean;
  isMobilePortrait: boolean;
  isMobileLandscape: boolean;
}

export function useViewport(): ViewportInfo {
  const [state, setState] = useState(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { width: w, height: h, mode: getViewportMode(w, h) };
  });

  useEffect(() => {
    let rafId = 0;

    const update = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        setState({ width: w, height: h, mode: getViewportMode(w, h) });
      });
    };

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  const isDesktop = state.mode === 'desktop';

  return {
    width: state.width,
    height: state.height,
    mode: state.mode,
    isDesktop,
    isMobile: !isDesktop,
    isMobilePortrait: state.mode === 'mobile-portrait',
    isMobileLandscape: state.mode === 'mobile-landscape',
  };
}
