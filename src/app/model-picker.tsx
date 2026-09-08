import { useEffect, useId, useState } from 'react';
import { fallbackModels, modelCatalogSchema, type ModelCatalog } from '../shared/discovery';
import { api } from './api';

export function ModelPicker({ provider, value, onChange, label = 'Model', placeholder = 'Use provider default', disabled = false, refreshKey = '' }: {
  provider: string; value: string; onChange: (value: string) => void; label?: string; placeholder?: string; disabled?: boolean; refreshKey?: string | number;
}) {
  const listId = useId();
  const [catalog, setCatalog] = useState<ModelCatalog>(() => fallbackModels(provider));
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(fallbackModels(provider)); setLoading(true);
    api<unknown>(`/api/providers/${encodeURIComponent(provider)}/models`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCatalog(modelCatalogSchema.parse(data)); })
      .catch(() => { if (!controller.signal.aborted) setCatalog(fallbackModels(provider, 'Discovery unavailable. Starter suggestions are not verified; you can enter a custom model ID.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider, refreshKey, refresh]);
  const query = value.trim().toLowerCase();
  const options = catalog.models.filter(item => `${item.id} ${item.name} ${item.category ?? ''}`.toLowerCase().includes(query)).slice(0, 200);
  return <div className="model-picker">
    <div className="button-row">
      <input aria-label={label} aria-describedby={`${listId}-status`} value={value} list={listId} placeholder={placeholder} disabled={disabled} maxLength={200} onChange={event => onChange(event.target.value)} />
      <button className="button" type="button" disabled={disabled || loading} onClick={() => setRefresh(refresh + 1)} aria-label={`Reload ${label.toLowerCase()} catalog`}>{loading ? 'Loading…' : 'Reload'}</button>
    </div>
    <datalist id={listId}>{options.map(item => <option key={item.id} value={item.id}>{item.name}{item.category ? ` · ${item.category}` : ''}</option>)}</datalist>
    <small id={`${listId}-status`} role="status">{loading ? 'Loading model catalog…' : `${catalog.source === 'fallback' ? 'Fallback · ' : catalog.source === 'cache' ? 'Cached · ' : ''}${catalog.message}`} Type to search or enter a custom model ID.</small>
  </div>;
}
