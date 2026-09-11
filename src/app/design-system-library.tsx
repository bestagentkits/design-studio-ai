import { screenParam, writeScreen } from './screen-state';
import { useEffect, useRef, useState } from 'react';
import { applyDesignSystem, captureSystemComponent, designSystemSchema, insertSystemItem, type DesignSystem, type DesignSystemDefinition } from '../shared/design-systems';
import { componentNames } from '../shared/design-capabilities';
import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import { api, message, post, put, uid } from './api';
import { Field, Modal } from './ui';

export function DesignSystemLibrary({ doc, page, node, change }: { doc: DesignDocument; page: DesignPage; node?: DesignNode; change: (recipe: (doc: DesignDocument) => void) => void }) {
  const [open, setOpen] = useState(() => !!screenParam('library')), [systems, setSystems] = useState<DesignSystem[]>([]), [selected, select] = useState<DesignSystem>();
  const navigation = useRef(0);
  const [draft, setDraft] = useState<DesignSystemDefinition>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
  const [versions, setVersions] = useState<{ version: number; createdAt: string }[]>([]), [json, setJson] = useState('');
  async function refresh() { const result = await api<{ systems: DesignSystem[] }>('/api/design-systems'); setSystems(result.systems); return result.systems; }
  async function choose(system: DesignSystem, updateUrl = true) { const request = ++navigation.current; if (updateUrl) writeScreen({ library: system.id }); select(system); setDraft(structuredClone(system.definition)); setJson(''); setError(''); setVersions([]); const result = await api<{ versions: typeof versions }>(`/api/design-systems/${system.id}/versions`); if (request === navigation.current) setVersions(result.versions); }
  function create(updateUrl = true) { navigation.current++; if (updateUrl) writeScreen({ library: 'new' }); select(undefined); setVersions([]); setJson(''); setDraft({ name: `${doc.theme.name} library`, description: '', system: 'shadcn', theme: structuredClone(doc.theme), components: [], compositions: [] }); }
  useEffect(() => {
    const restore = () => { const request = ++navigation.current, id = screenParam('library'); setOpen(!!id); if (!id) return; void refresh().then(items => { if (request !== navigation.current || screenParam('library') !== id) return; const system = items.find(s => s.id === id); if (system) return choose(system, false); create(false); }).catch(e => { if (request === navigation.current) setError(message(e)); }); };
    restore(); window.addEventListener('popstate', restore); return () => { navigation.current++; window.removeEventListener('popstate', restore); };
  }, []);
  function close() { navigation.current++; setOpen(false); writeScreen({ library: null }); }
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function save() {
    if (!draft) return;
    await run(async () => {
      const definition = designSystemSchema.parse(json ? JSON.parse(json) : draft);
      const response = selected ? await put<{ system: DesignSystem }>(`/api/design-systems/${selected.id}`, { expectedVersion: selected.version, definition }) : await post<{ system: DesignSystem }>('/api/design-systems', definition);
      await refresh(); await choose(response.system);
    });
  }
  function apply() { if (!selected) return; change(d => Object.assign(d, applyDesignSystem(d, selected))); close(); }
  function insert(itemId: string) { if (!selected) return; change(d => Object.assign(d, insertSystemItem(d, selected, page.id, itemId))); close(); }
  function capturePage() {
    if (!draft) return;
    if (page.nodes.some(n => n.type === 'board' || n.type === 'artwork')) { setError('Board and painting source cannot be packaged in reusable libraries yet. Use an editable embed or clone the project.'); return; }
    const copy = structuredClone(page), originalId = copy.id; copy.id = uid(); copy.name += ' composition';
    for (const n of copy.nodes) n.interactions = n.interactions?.map(action => action.action === 'navigate' && action.target === originalId ? { ...action, target: copy.id } : action);
    edit({ compositions: [...draft.compositions, copy] });
  }
  const edit = (patch: Partial<DesignSystemDefinition>) => { setDraft(current => current && ({ ...current, ...patch })); setJson(''); };
  return <><button onClick={() => { setOpen(true); void refresh().catch(e => setError(message(e))); create(); }}>Manage design systems</button>{doc.designSystem && <p>{doc.designSystem.name} · version {doc.designSystem.version}</p>}
    {open && <Modal title="Design systems" wide onClose={close}><div className="system-library">
      <nav aria-label="Design system library"><input aria-label="Search design systems" placeholder="Search libraries…" value={query} onChange={e => setQuery(e.target.value)}/><button onClick={() => create()}>New design system</button>
        {systems.filter(s => s.definition.name.toLowerCase().includes(query.toLowerCase())).map(s => <button key={s.id} aria-pressed={selected?.id === s.id} onClick={() => void run(() => choose(s))}><strong>{s.definition.name}</strong><small>{s.definition.system} · v{s.version} · {s.definition.components.length + s.definition.compositions.length} items</small><span className="system-swatches">{Object.entries(s.definition.theme.colors).slice(0, 6).map(([name, color]) => <i key={name} style={{ background: color }} title={name}/>)}</span></button>)}
      </nav>
      {draft && <section className="system-editor"><div className="property-grid"><Field label="Library name"><input value={draft.name} onChange={e => edit({ name: e.target.value })}/></Field><Field label="Component system"><select value={draft.system} onChange={e => edit({ system: e.target.value as 'antd' | 'shadcn' })}><option value="shadcn">shadcn-style</option><option value="antd">Ant Design</option></select></Field></div>
        <Field label="Description"><textarea value={draft.description} onChange={e => edit({ description: e.target.value })}/></Field>
        <h3>Design tokens</h3><div className="system-token-grid">{Object.entries(draft.theme.colors).map(([key, value]) => <Field key={key} label={`${key} token`}><input value={value} onChange={e => edit({ theme: { ...draft.theme, colors: { ...draft.theme.colors, [key]: e.target.value } } })}/></Field>)}</div>
        <button onClick={() => edit({ theme: structuredClone(doc.theme) })}>Use current canvas tokens</button>
        <h3>Components & variants</h3><div className="button-row"><select aria-label="New library component" defaultValue="" onChange={e => { if (!e.target.value) return; edit({ components: [...draft.components, { id: uid(), name: e.target.value, component: { name: e.target.value as typeof componentNames[number], system: draft.system, props: { label: e.target.value } } }] }); e.target.value = ''; }}><option value="">Add a component…</option>{componentNames.map(name => <option key={name}>{name}</option>)}</select><button disabled={!node?.component} onClick={() => node?.component && edit({ components: [...draft.components, captureSystemComponent(node, uid())] })}>Capture selected component</button></div>
        {draft.components.map((item, index) => <div className="system-item" key={item.id}><input aria-label={`Component name ${index + 1}`} value={item.name} onChange={e => edit({ components: draft.components.map((c, i) => i === index ? { ...c, name: e.target.value } : c) })}/><input aria-label={`Component variant ${index + 1}`} placeholder="Variant" value={item.component.variant ?? ''} onChange={e => edit({ components: draft.components.map((c, i) => i === index ? { ...c, component: { ...c.component, variant: e.target.value || undefined } } : c) })}/><button disabled={!selected?.definition.components.some(c => c.id === item.id)} onClick={() => insert(item.id)}>Insert</button><button onClick={() => edit({ components: draft.components.filter(c => c.id !== item.id) })}>Remove</button></div>)}
        <h3>Reusable compositions</h3><button onClick={capturePage}>Capture current page</button>
        {draft.compositions.map(item => <div className="system-item" key={item.id}><span>{item.name} · {item.nodes.length} layers</span><button disabled={!selected?.definition.compositions.some(c => c.id === item.id)} onClick={() => insert(item.id)}>Insert</button><button onClick={() => edit({ compositions: draft.compositions.filter(c => c.id !== item.id) })}>Remove</button></div>)}
        <details><summary>Advanced tokens, props & composition JSON</summary><textarea aria-label="Design system JSON" className="system-json" value={json || JSON.stringify(draft, null, 2)} onChange={e => setJson(e.target.value)}/></details>
        {selected && <Field label="Saved version"><select value={selected.version} onChange={e => void run(async () => choose((await api<{ system: DesignSystem }>(`/api/design-systems/${selected.id}?version=${e.target.value}`)).system))}>{versions.map(v => <option value={v.version} key={v.version}>Version {v.version} · {new Date(v.createdAt).toLocaleString()}</option>)}</select></Field>}
        <div className="button-row"><button className="primary" disabled={busy} onClick={() => void save()}>{selected ? 'Save new version' : 'Create library'}</button><button disabled={!selected || busy} onClick={apply}>Apply saved version</button><button disabled={!selected || busy} onClick={() => void run(async () => { await api(`/api/design-systems/${selected!.id}`, { method: 'DELETE' }); create(); await refresh(); })}>Delete library</button></div>
        <button disabled={!selected} onClick={() => { select(undefined); setVersions([]); edit({ name: `${draft.name} copy` }); }}>Copy as new library</button>
        <p>Save a version before applying or inserting. Updates require the latest version you actually loaded; copy a historical version into a new library to branch it. Existing designs keep their pinned tokens and content until you explicitly apply another version.</p>
      </section>}{error && <p role="alert">{error}</p>}
    </div></Modal>}
  </>;
}
