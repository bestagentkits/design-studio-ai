import { useEffect, useState } from 'react';

export function screenParam(key: string, fallback = '') {
  if (typeof location === 'undefined') return fallback;
  const url = new URL(location.href);
  return (url.pathname.startsWith('/published/') ? new URLSearchParams(url.hash.slice(1)) : url.searchParams).get(key) ?? fallback;
}
export function writeScreen(patch: Record<string, string | null>, replace = false) {
  const url = new URL(location.href);
  const published = url.pathname.startsWith('/published/');
  const params = published ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
  for (const [key, value] of Object.entries(patch)) value === null || value === '' ? params.delete(key) : params.set(key, value);
  if (published) url.hash = params.toString();
  if (url.href === location.href) return;
  history[replace ? 'replaceState' : 'pushState'](history.state, '', published ? url.hash || '#' : url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event('studio:navigation'));
}
/** URL state contains only screen identifiers, never draft content or credentials. */
export function useScreenState<T extends string>(key: string, fallback: T, allowed: readonly T[], persistDefault = false) {
  const read = () => { const value = screenParam(key) as T; return allowed.includes(value) ? value : fallback; };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const restore = () => setValue(read());
    window.addEventListener('popstate', restore); window.addEventListener('studio:navigation', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('studio:navigation', restore); };
  }, [key, fallback]);
  return [value, (next: T) => { setValue(next); writeScreen({ [key]: !persistDefault && next === fallback ? null : next }); }] as const;
}
