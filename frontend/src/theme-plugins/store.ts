import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeManifest } from './types';

interface ThemeState {
  // Current theme ID
  currentThemeId: string;
  currentFeatureKey: string;

  pageTransitionEnabled: boolean;
  pageTransitionDurationMs: number;
  // Available themes (populated from registry)
  availableThemes: ThemeManifest[];
  // Is theme loading
  isLoading: boolean;
  // Error message
  error: string | null;

  // Actions
  setCurrentTheme: (themeId: string) => void;
  setCurrentFeatureKey: (featureKey: string) => void;
  setPageTransition: (enabled: boolean, durationMs: number) => void;
  setAvailableThemes: (themes: ThemeManifest[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      currentThemeId: 'default',
      currentFeatureKey: 'global',
      pageTransitionEnabled: false,
      pageTransitionDurationMs: 420,
      availableThemes: [],
      isLoading: false,
      error: null,

      setCurrentTheme: (themeId) => set({ currentThemeId: themeId }),
      setCurrentFeatureKey: (featureKey) => set({ currentFeatureKey: featureKey }),
      setPageTransition: (enabled, durationMs) => set({ pageTransitionEnabled: enabled, pageTransitionDurationMs: durationMs }),
      setAvailableThemes: (themes) => set({ availableThemes: themes }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'mumuai-theme-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist theme selection, not the loaded themes
      partialize: (state) => ({
        currentThemeId: state.currentThemeId
      }),
    }
  )
);
