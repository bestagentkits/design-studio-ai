import { useEffect, useId, useState } from 'react';
import { fallbackFonts, fontCatalogSchema, type FontCatalog } from '../shared/discovery';
import { api } from './api';

export function FontPicker({ value, onChange, label = 'Font family', disabled = false }: {
  value: string; onChange: (value: string) => void; label?: string; disabled?: boolean;
}) {
  const listId = useId();
  const [catalog, setCatalog] = useState<FontCatalog>(() => fallbackFonts());
  const [category, setCategory] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    api<unknown>('/api/fonts', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setCatalog(fontCatalogSchema.parse(data)); })
      .catch(() => { if (!controller.signal.aborted) setCatalog(fallbackFonts('Font discovery unavailable. Showing curated Google Fonts families.')); });
    return () => controller.abort();
  }, []);
  const options = catalog.fonts.filter(font => (category === 'all' || font.category === category) && font.family.toLowerCase().includes(value.toLowerCase())).slice(0, 200);
  return <div className="font-picker">
    <div className="button-row">
      <input aria-label={label} aria-describedby={`${listId}-status`} list={listId} value={value} maxLength={200} disabled={disabled} placeholder="Search font families" onChange={event => onChange(event.target.value)} />
      <select aria-label={`${label} category`} value={category} disabled={disabled} onChange={event => setCategory(event.target.value)}>
        <option value="all">All styles</option>{['sans-serif', 'serif', 'monospace', 'display', 'handwriting'].map(item => <option key={item}>{item}</option>)}
      </select>
    </div>
    <datalist id={listId}>
      {category === 'all' && ['Arial', 'Georgia', 'Courier New', 'system-ui'].map(family => <option key={family} value={family}>System font</option>)}
      {options.map(font => <option key={font.family} value={font.family}>{font.category}</option>)}
    </datalist>
    <small id={`${listId}-status`}>{catalog.source === 'fallback' ? 'Fallback · ' : ''}{catalog.message} Custom and system font names are accepted.</small>
  </div>;
}
