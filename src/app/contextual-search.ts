import { useLayoutEffect, useState } from 'react';
export type SearchScope = 'projects' | 'community';
const queries = new Map<string, string>();
export function searchQuery(accountId: string | undefined, scope: SearchScope) {
  const key = `${accountId || 'guest'}:${scope}`;
  try { return sessionStorage.getItem(`design-studio:search:${key}`)?.slice(0,200) || queries.get(key) || ''; } catch { return queries.get(key) || ''; }
}
export function rememberSearch(accountId: string | undefined, scope: SearchScope, query: string) {
  const key = `${accountId || 'guest'}:${scope}`; queries.set(key, query);
  try { sessionStorage.setItem(`design-studio:search:${key}`, query.slice(0,200)); } catch { /* Keep the in-memory query when browser storage is unavailable. */ }
}
export function useContextualSearch(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!enabled) { setOpen(false); return; }
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.repeat || event.isComposing || document.querySelector('dialog[open]')) return;
      event.preventDefault(); setOpen(true);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
  return { open, setOpen };
}
