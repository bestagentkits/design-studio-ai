import { useEffect, useId, useRef, useState } from 'react';
import { api, message } from './api';
import { Modal } from './ui';
import { rememberSearch, searchQuery, type SearchScope } from './contextual-search';
import './community.css';
type Result = { id: string; name?: string; title?: string };
export function CommunitySearchDialog({ initialScope, accountId, onClose }: { initialScope: SearchScope; accountId?: string; onClose: () => void }) {
  const [scope, setScope] = useState(initialScope), [query, setQuery] = useState(() => initialScope === 'community' ? new URL(location.href).searchParams.get('q') || searchQuery(accountId, initialScope) : searchQuery(accountId, initialScope));
  const [results, setResults] = useState<Result[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Native showModal runs after mount; focus only after the dialog is open.
  useEffect(() => { inputRef.current?.focus(); }, [scope]);
  useEffect(() => {
    const controller = new AbortController(); setResults([]); setSelected(0); setError('');
    if (!query.trim() || (scope === 'projects' && !accountId)) { setBusy(false); return () => controller.abort(); }
    setBusy(true);
    const timeout = setTimeout(() => {
      const path = scope === 'projects' ? '/api/projects' : '/api/community/listings';
      const params = new URLSearchParams();
      if (scope === 'community' && location.pathname.startsWith('/community')) {
        const current = new URL(location.href).searchParams;
        for (const key of ['kind', 'tags', 'format', 'period', 'creator', 'collection', 'sort']) { const value = current.get(key); if (value) params.set(key, value); }
        const creator = /^\/community\/creators\/([^/]+)/.exec(location.pathname)?.[1]; if (creator) params.set('creator', decodeURIComponent(creator));
      }
      params.set('q', query.trim()); params.set('limit', '12');
      void api<{ projects?: Result[]; listings?: Result[]; items?: Result[] }>(`${path}?${params}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResults(data.projects || data.listings || data.items || []); })
        .catch(error => { if (!controller.signal.aborted) setError(message(error)); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query, scope, accountId]);
  const href = (result: Result) => scope === 'community' ? `/community/designs/${encodeURIComponent(result.id)}` : `/?project=${encodeURIComponent(result.id)}`;
  return <Modal title="Search" onClose={onClose}><div className="modal-body community-search">
    <div className="button-row" role="group" aria-label="Search scope">{(['projects', 'community'] as const).map(value => <button key={value} className={`button ${scope === value ? 'selected' : ''}`} aria-pressed={scope === value} onClick={() => { setScope(value); setQuery(searchQuery(accountId, value)); }}>{value === 'projects' ? 'My projects' : 'Community'}</button>)}</div>
    <input ref={inputRef} role="combobox" aria-label={`Search ${scope === 'projects' ? 'my projects' : 'Community'}`} aria-expanded={results.length > 0} aria-controls={listId} aria-activedescendant={results[selected] ? `${listId}-${selected}` : undefined} maxLength={200} value={query} placeholder={scope === 'projects' ? 'Search your private projects' : 'Search public designs'} onChange={event => { setQuery(event.target.value); rememberSearch(accountId, scope, event.target.value); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => Math.max(0, Math.min(results.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && results[selected]) { event.preventDefault(); location.assign(href(results[selected])); }
    }} />
    <p role="status">{busy ? 'Searching…' : error || (scope === 'projects' && !accountId ? 'Sign in to search your private projects.' : query.trim() ? `${results.length} results in ${scope === 'projects' ? 'My projects' : 'Community'}` : 'Start typing to search this scope.')}</p>
    <ul id={listId} role="listbox" aria-label="Search results">{results.map((result, index) => <li role="option" id={`${listId}-${index}`} aria-selected={selected === index} key={result.id}><a href={href(result)} onMouseEnter={() => setSelected(index)}>{result.title || result.name}</a></li>)}</ul>
    {!busy && query.trim() && !results.length && <button className="button" onClick={() => { const next = scope === 'community' ? 'projects' : 'community'; setScope(next); setQuery(searchQuery(accountId, next)); }}>Search {scope === 'community' ? 'My projects' : 'Community'} instead</button>}
    <small>↑ ↓ to choose · Enter to open · Escape to close. Private queries stay in My projects.</small>
  </div></Modal>;
}
