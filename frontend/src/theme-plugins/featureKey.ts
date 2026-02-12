export type FeatureKey =
  | 'global'
  | 'projects_list'
  | 'project'
  | 'chapters'
  | 'chapter_analysis'
  | 'foreshadows'
  | 'writing_styles'
  | 'prompt_workshop'
  | 'mcp'
  | 'settings'
  | 'wizard'
  | 'reader'
  | 'prompt_templates'
  | 'admin'
  | 'inspiration'
  | 'auth';

export function pathnameToFeatureKey(pathname: string): FeatureKey {
  const p = (pathname || '/').toLowerCase();

  if (p.startsWith('/login') || p.startsWith('/auth/callback')) return 'auth';
  if (p === '/' || p.startsWith('/projects')) return 'projects_list';
  if (p.startsWith('/wizard')) return 'wizard';
  if (p.startsWith('/inspiration')) return 'inspiration';
  if (p.startsWith('/settings')) return 'settings';
  if (p.startsWith('/prompt-templates')) return 'prompt_templates';
  if (p.startsWith('/mcp-plugins')) return 'mcp';
  if (p.startsWith('/user-management')) return 'admin';
  if (p.startsWith('/chapters/') && p.includes('/reader')) return 'reader';

  if (p.startsWith('/project/')) {
    if (p.includes('/prompt-workshop')) return 'prompt_workshop';
    if (p.includes('/chapters')) return 'chapters';
    if (p.includes('/chapter-analysis')) return 'chapter_analysis';
    if (p.includes('/foreshadows')) return 'foreshadows';
    if (p.includes('/writing-styles')) return 'writing_styles';
    return 'project';
  }

  return 'global';
}
