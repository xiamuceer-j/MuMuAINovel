import type { ThemeConfig } from 'antd';

export interface ThemeManifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  preview?: string;
}

export interface ThemePlugin {
  manifest: ThemeManifest;
  antdTheme: ThemeConfig;
  cssVars?: Record<string, string>;
  customCSS?: string;
  featureOverrides?: Record<
    string,
    {
      cssVars?: Record<string, string>;
      customCSS?: string;
    }
  >;
  motion?: {
    enablePageTransition?: boolean;
    durationMs?: number;
    easing?: string;
  };
}

export interface ThemeRegistryEntry {
  id: string;
  manifest: ThemeManifest;
  loader: () => Promise<ThemePlugin>;
}
