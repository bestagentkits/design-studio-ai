const continuationKey = 'design-studio:community-return';
export function communityPath(path: string): boolean {
  return path === '/community' || path.startsWith('/community/');
}
export function navigateCommunity(path: string) {
  if (!communityPath(new URL(path, location.origin).pathname)) return;
  if (!window.dispatchEvent(new Event('studio:leave-project', { cancelable: true }))) return;
  location.assign(path);
}
export function communitySignIn(path = location.pathname + location.search) {
  if (!communityPath(new URL(path, location.origin).pathname)) return;
  try { sessionStorage.setItem(continuationKey, JSON.stringify({ path, createdAt: Date.now() })); } catch { /* The explicit return URL remains available. */ }
  location.assign('/?auth=signin&returnTo=' + encodeURIComponent(path));
}
export function resumeCommunitySignIn(): boolean {
  let path = new URL(location.href).searchParams.get('returnTo');
  try {
    const saved = JSON.parse(sessionStorage.getItem(continuationKey) || 'null') as { path?: string; createdAt?: number } | null;
    if (!path && saved?.createdAt && Date.now() >= saved.createdAt && Date.now() - saved.createdAt < 30 * 60_000) path = saved.path || null;
    sessionStorage.removeItem(continuationKey);
  } catch { /* Storage recovery is optional. */ }
  if (!path || !path.startsWith('/community') || path.startsWith('//')) return false;
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin || !communityPath(target.pathname)) return false;
  location.assign(target.pathname + target.search); return true;
}
