export const workspacePaths = { projects: '/', templates: '/templates', themes: '/design-systems', activity: '/activity' } as const;
export type WorkspaceTab = keyof typeof workspacePaths;
export function workspaceTab(path: string): WorkspaceTab {
  const normalized = path.replace(/\/$/, '') || '/';
  return (Object.entries(workspacePaths).find(([, value]) => value === normalized)?.[0] as WorkspaceTab) ?? 'projects';
}
export function navigateWorkspace(tab: WorkspaceTab) {
  const path = workspacePaths[tab];
  if (location.pathname + location.search + location.hash !== path) history.pushState(null, '', path);
}
