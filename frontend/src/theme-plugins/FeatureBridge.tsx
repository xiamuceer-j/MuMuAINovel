import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useThemeStore } from './store';
import { pathnameToFeatureKey } from './featureKey';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function FeatureBridge() {
  const location = useLocation();
  const { setCurrentFeatureKey, pageTransitionEnabled, pageTransitionDurationMs } = useThemeStore();
  const lastFeatureKeyRef = useRef<string>('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const featureKey = pathnameToFeatureKey(location.pathname);
    setCurrentFeatureKey(featureKey);
    document.documentElement.setAttribute('data-feature', featureKey);
    if (!prefersReducedMotion() && lastFeatureKeyRef.current && lastFeatureKeyRef.current !== featureKey) {
      const root = document.getElementById('root');
      if (root) {
        root.classList.remove('mumu-page-enter');
        void root.offsetHeight;
        if (pageTransitionEnabled) {
          root.classList.add('mumu-page-enter');
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            root.classList.remove('mumu-page-enter');
            timerRef.current = null;
          }, pageTransitionDurationMs + 120);
        }
      }
    }

    lastFeatureKeyRef.current = featureKey;
  }, [location.pathname, pageTransitionDurationMs, pageTransitionEnabled, setCurrentFeatureKey]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}
