import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider } from 'antd';
import type { ThemePlugin } from './types';
import { getAvailableThemes, loadTheme } from './index';
import { useThemeStore } from './store';

function normalizeCssVarKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  if (k.startsWith('--')) return k;
  return `--${k}`;
}

function ensureThemeStyleEl(): HTMLStyleElement {
  const id = 'mumu-theme-custom-css';
  const existing = document.getElementById(id);
  if (existing && existing.tagName === 'STYLE') {
    return existing as HTMLStyleElement;
  }
  const el = document.createElement('style');
  el.id = id;
  document.head.appendChild(el);
  return el;
}

export function ThemeProvider(props: { children: React.ReactNode }) {
  const { currentThemeId, currentFeatureKey, setAvailableThemes, setLoading, setError, setPageTransition } = useThemeStore();
  const [loadedTheme, setLoadedTheme] = useState<ThemePlugin | null>(null);
  const appliedCssVarKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setAvailableThemes(getAvailableThemes());
  }, [setAvailableThemes]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const theme = await loadTheme(currentThemeId);
        if (!cancelled) setLoadedTheme(theme);
      } catch {
        if (!cancelled) {
          setError('主题加载失败');
          const fallback = await loadTheme('default');
          setLoadedTheme(fallback);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentThemeId, setLoading, setError]);

  const antdTheme = useMemo(() => loadedTheme?.antdTheme, [loadedTheme]);

  useEffect(() => {
    if (!loadedTheme) return;

    const root = document.documentElement;
    root.setAttribute('data-theme', loadedTheme.manifest?.id || 'unknown');
    root.setAttribute('data-feature', currentFeatureKey || 'global');

    appliedCssVarKeys.current.forEach((k) => root.style.removeProperty(k));
    appliedCssVarKeys.current.clear();

    const baseVars = loadedTheme.cssVars || {};
    const featureVars = loadedTheme.featureOverrides?.[currentFeatureKey || 'global']?.cssVars || {};
    const mergedVars = { ...baseVars, ...featureVars };

    Object.entries(mergedVars).forEach(([key, value]) => {
        const k = normalizeCssVarKey(key);
        if (!k) return;
        root.style.setProperty(k, value);
        appliedCssVarKeys.current.add(k);
    });

    const styleEl = ensureThemeStyleEl();
    const baseCSS = loadedTheme.customCSS || '';
    const featureCSS = loadedTheme.featureOverrides?.[currentFeatureKey || 'global']?.customCSS || '';

    const motion = loadedTheme.motion;
    const enableMotion = Boolean(motion?.enablePageTransition);
    const durationMs = motion?.durationMs ?? 420;
    const easing = motion?.easing ?? 'cubic-bezier(0.2, 0.8, 0.2, 1)';

    setPageTransition(enableMotion, durationMs);

    const motionCSS = enableMotion
      ? `
        @media (prefers-reduced-motion: no-preference) {
          #root.mumu-page-enter {
            animation: mumuPageEnter ${durationMs}ms ${easing} both;
          }
          @keyframes mumuPageEnter {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
        }
      `
      : '';

    styleEl.textContent = [baseCSS, featureCSS, motionCSS].filter(Boolean).join('\n\n');
  }, [loadedTheme, currentFeatureKey, setPageTransition]);

  return (
    <ConfigProvider theme={antdTheme}>
      {props.children}
    </ConfigProvider>
  );
}
