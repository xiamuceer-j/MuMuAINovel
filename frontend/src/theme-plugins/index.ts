import type { ThemePlugin, ThemeRegistryEntry, ThemeManifest } from './types';

// Dynamic import of all theme plugins using Vite's import.meta.glob
// This creates a registry at build time
const themeModules = import.meta.glob<ThemePlugin>('./built-in/*/index.ts', {
  eager: false,
  import: 'default',
});

// Extract manifests eagerly for UI listing
const manifestModules = import.meta.glob<ThemeManifest>('./built-in/*/manifest.json', {
  eager: true,
  import: 'default',
});

// Build registry
export const themeRegistry: ThemeRegistryEntry[] = Object.entries(manifestModules).map(([path, manifest]) => {
  // Extract theme ID from path: ./built-in/{id}/manifest.json
  const match = path.match(/\.\/built-in\/([^/]+)\/manifest\.json/);
  const id = match ? match[1] : 'unknown';

  // Find corresponding theme loader
  const themePath = path.replace('manifest.json', 'index.ts');
  const loader = themeModules[themePath];

  return {
    id,
    manifest,
    loader: async () => {
      const module = await loader();
      return module as ThemePlugin;
    },
  };
});

// Get all available themes (for settings UI)
export const getAvailableThemes = (): ThemeManifest[] => {
  return themeRegistry.map(entry => entry.manifest);
};

// Load a specific theme
export const loadTheme = async (themeId: string): Promise<ThemePlugin | null> => {
  const entry = themeRegistry.find(t => t.id === themeId);
  if (!entry) {
    console.warn(`Theme "${themeId}" not found, falling back to default`);
    const defaultEntry = themeRegistry.find(t => t.id === 'default');
    return defaultEntry ? await defaultEntry.loader() : null;
  }
  return await entry.loader();
};

// Get default theme
export const getDefaultTheme = async (): Promise<ThemePlugin | null> => {
  const entry = themeRegistry.find(t => t.id === 'default');
  return entry ? await entry.loader() : null;
};
