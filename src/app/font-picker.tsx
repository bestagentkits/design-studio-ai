import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { fallbackFonts, fontCatalogSchema, type FontCatalog } from '../shared/discovery';
import { googleFontFamily, googleFontsStylesheetUrl } from '../shared/font-loading';
import { api } from './api';

const systemChoices = ['$heading', '$body', 'Arial', 'Georgia', 'Courier New', 'system-ui'].map(family => ({ family, category: family.startsWith('$') ? 'Theme font' : 'System font' }));
export function FontPicker({ value, onChange, label = 'Font family', disabled = false }: {
  value: string; onChange: (value: string) => void; label?: string; disabled?: boolean;
}) {
  const listId = useId(), input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<FontCatalog>(() => fallbackFonts());
  const [category, setCategory] = useState('all'), [query, setQuery] = useState(value), [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1), [fontStatus, setFontStatus] = useState('');
  const options = [...systemChoices, ...catalog.fonts].filter((font, index, all) =>
    all.findIndex(other => other.family === font.family) === index &&
    (category === 'all' || font.category === category) && font.family.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 20);
  const families = options.map(font => font.family), fontKey = families.join('|');
  useEffect(() => { if (!open) setQuery(value); }, [value, open]);
  useEffect(() => {
    const controller = new AbortController();
    api<unknown>('/api/fonts', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setCatalog(fontCatalogSchema.parse(data)); })
      .catch(() => { if (!controller.signal.aborted) setCatalog(fallbackFonts('Font discovery unavailable. Showing curated Google Fonts families.')); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!open) return;
    const href = googleFontsStylesheetUrl(families);
    if (!href) { setFontStatus(''); return; }
    let cancelled = false, link: HTMLLinkElement | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    setFontStatus('Loading font previews…');
    // Search settles before requesting at most twenty preview families, independently of canvas fonts.
    const debounce = setTimeout(() => {
      link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioFontPreview = '';
      timeout = setTimeout(() => { if (!cancelled) setFontStatus('Some previews could not load. Font names remain selectable.'); }, 10000);
      link.onload = () => { void Promise.all(families.filter(family => googleFontFamily(family)).map(family => document.fonts.load(`18px "${family}"`)))
        .then(() => { if (!cancelled) { clearTimeout(timeout); setFontStatus(''); } }, () => { if (!cancelled) { clearTimeout(timeout); setFontStatus('Some previews could not load. Font names remain selectable.'); } }); };
      link.onerror = () => { if (!cancelled) { clearTimeout(timeout); setFontStatus('Previews unavailable offline. Font names remain selectable.'); } };
      document.head.append(link);
    }, 200);
    return () => { cancelled = true; clearTimeout(debounce); clearTimeout(timeout); link?.remove(); };
  }, [open, fontKey]);
  useEffect(() => { setActive(-1); }, [query, category]);
  useEffect(() => { if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, listId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) commit(query); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, query, value]);
  function commit(family: string) {
    const next = family.trim();
    if (next && next !== value) onChange(next);
    setQuery(next || value); setOpen(false); setActive(-1);
  }
  function show() { if (disabled) return; setOpen(true); setQuery(''); setActive(-1); }
  return <div className="font-picker" ref={root} onBlur={event => {
    if (!root.current?.contains(event.relatedTarget as Node | null)) { if (open && query.trim()) commit(query); else setOpen(false); }
  }}>
    <div className="font-search-row">
      <input ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-describedby={`${listId}-status`}
        value={query} maxLength={200} disabled={disabled} placeholder={open ? 'Search font families' : value} autoComplete="off"
        onFocus={show} onChange={event => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(value); }
          else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (!open) show();
            else setActive(index => options.length ? Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))) : -1);
          } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(options[active]?.family ?? query); }
        }}/>
      <button type="button" aria-label={`Browse ${label.toLowerCase()}`} disabled={disabled} title="Browse font previews" onClick={() => { input.current?.focus(); show(); }}><ChevronDown size={16}/></button>
    </div>
    {open && <div className="font-picker-popover">
      <select aria-label={`${label} category`} value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All styles</option>{['sans-serif', 'serif', 'monospace', 'display', 'handwriting'].map(item => <option key={item}>{item}</option>)}
      </select>
      <div role="listbox" id={listId} aria-label={`${label} choices`} className="font-options">
        {options.map((font, index) => <div role="option" id={`${listId}-${index}`} key={font.family} aria-selected={font.family === value}
          className={`font-option ${active === index ? 'active' : ''}`} style={{ fontFamily: font.family.startsWith('$') ? undefined : font.family }}
          onPointerDown={event => event.preventDefault()} onClick={() => commit(font.family)}>
          <span>{font.family}</span>{font.family === value ? <Check size={14}/> : <small>{font.category}</small>}
        </div>)}
      </div>
      {!options.length && <small>No matching family. Custom font names are accepted.</small>}
      {query.trim() && query.trim() !== value && <button type="button" className="button small" onClick={() => commit(query)}>Use {query.trim()}</button>}
      <small className="font-picker-status">{fontStatus || 'Choose a family or press Enter to apply. Search up to 20 previews.'}</small>
    </div>}
    <small id={`${listId}-status`} className="font-picker-status">{catalog.source === 'fallback' ? 'Curated families · ' : ''}Custom and system font names accepted.</small>
  </div>;
}
