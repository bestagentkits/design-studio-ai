import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import type { Layout } from '../shared/design-capabilities';
import { componentNames } from '../shared/design-capabilities';
import { Field } from './ui';
export function LayoutInspector({ node, page, update }: { node?: DesignNode; page: DesignPage; update: (patch: Partial<DesignNode & DesignPage>) => void }) {
  const target = node ?? page;
  const layout = target.layout;
  const setLayout = (patch: Partial<Layout>) => update({ layout: { mode: layout?.mode ?? 'flex', ...layout, ...patch } });
  return <section><h3>Layout & structure</h3>
    {(!node || ['frame', 'group', 'component'].includes(node.type)) && <><Field label="Contents layout"><select value={layout?.mode ?? 'absolute'} onChange={e => setLayout({ mode: e.target.value as Layout['mode'] })}><option value="absolute">Freeform / absolute</option><option value="flex">Flex / auto layout</option><option value="grid">Grid</option></select></Field>
      {layout?.mode !== 'absolute' && layout && <><Field label="Direction"><select value={layout.direction ?? 'column'} onChange={e => setLayout({ direction: e.target.value as 'row' | 'column' })}><option value="column">Vertical</option><option value="row">Horizontal</option></select></Field>
        {(['gap', 'padding', ...(layout.mode === 'grid' ? ['columns'] : [])] as const).map(key => <Field key={key} label={key}><input type="number" min={key === 'columns' ? 1 : 0} max={key === 'columns' ? 24 : 20000} value={layout[key as 'gap'] ?? (key === 'columns' ? 2 : 0)} onChange={e => setLayout({ [key]: +e.target.value })}/></Field>)}
        <Field label="Align"><select value={layout.align ?? 'start'} onChange={e => setLayout({ align: e.target.value as Layout['align'] })}>{['start', 'center', 'end', 'stretch'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Distribute"><select value={layout.justify ?? 'start'} onChange={e => setLayout({ justify: e.target.value as Layout['justify'] })}>{['start', 'center', 'end', 'space-between'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <label><input type="checkbox" checked={layout.wrap ?? false} onChange={e => setLayout({ wrap: e.target.checked })}/> Wrap</label>
      </>}
    </>}
    {node && <><Field label="Position"><select value={node.position ?? 'flow'} onChange={e => update({ position: e.target.value as 'flow' | 'absolute' })}><option value="flow">In layout flow</option><option value="absolute">Absolute</option></select></Field>
      {(['width', 'height'] as const).map(axis => <Field key={axis} label={`${axis} sizing`}><select value={node.sizing?.[axis] ?? 'fixed'} onChange={e => update({ sizing: { ...node.sizing, [axis]: e.target.value } })}>{['fixed', 'hug', 'fill'].map(x => <option key={x}>{x}</option>)}</select></Field>)}
      <Field label="Transform origin"><div className="pivot-grid">{Array.from({ length: 9 }, (_, i) => { const pivot: [number, number] = [i % 3 / 2, Math.floor(i / 3) / 2]; return <button key={i} aria-label={`Pivot ${pivot.join(',')}`} aria-pressed={(node.pivot ?? [.5, .5]).every((v, j) => v === pivot[j])} onClick={() => update({ pivot })}>•</button>; })}</div></Field>
    </>}
    {node?.component && <><Field label="Component"><select value={node.component.name} onChange={e => update({ component: { ...node.component!, name: e.target.value as typeof componentNames[number] } })}>{componentNames.map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Component system"><select value={node.component.system} onChange={e => update({ component: { ...node.component!, system: e.target.value as 'shadcn' | 'antd' } })}><option value="shadcn">shadcn</option><option value="antd">Ant Design</option></select></Field>
      <Field label="Component label"><input value={String(node.component.props?.label ?? node.name)} onChange={e => update({ component: { ...node.component!, props: { ...node.component!.props, label: e.target.value } } })}/></Field>
      <Field label="Component props (JSON)"><textarea key={node.id} defaultValue={JSON.stringify(node.component.props ?? {}, null, 2)} onBlur={e => { try { const props = JSON.parse(e.target.value); if (props && typeof props === 'object' && !Array.isArray(props)) update({ component: { ...node.component!, props } }); e.currentTarget.setCustomValidity(''); } catch { e.currentTarget.setCustomValidity('Enter a JSON object'); e.currentTarget.reportValidity(); } }}/></Field></>}
  </section>;
}

export function InteractionInspector({ node, doc, update }: { node: DesignNode; doc: DesignDocument; update: (patch: Partial<DesignNode>) => void }) {
  const actions = node.interactions ?? [], page = doc.pages.find(p => p.nodes.some(n => n.id === node.id))!;
  const set = (index: number, patch: Partial<typeof actions[number]>) => update({ interactions: actions.map((action, i) => i === index ? { ...action, ...patch } : action) });
  return <section><h3>Prototype interactions</h3>{actions.map((action, i) => <div key={i}>
    <Field label="Trigger"><select value={action.trigger} onChange={e => set(i, { trigger: e.target.value as 'click' | 'hover' })}><option value="click">Click / tap</option><option value="hover">Hover</option></select></Field>
    <Field label="Action"><select value={action.action} onChange={e => { const kind = e.target.value as typeof action.action; set(i, { action: kind, target: kind === 'navigate' ? doc.pages[0].id : kind === 'toggle' ? node.id : 'https://example.com' }); }}><option value="navigate">Navigate to screen</option><option value="toggle">Toggle layer visibility</option><option value="url">Open URL</option></select></Field>
    {action.action === 'url' ? <Field label="HTTPS URL"><input defaultValue={action.target} onBlur={e => { try { const url = new URL(e.target.value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); set(i, { target: url.href }); e.currentTarget.setCustomValidity(''); } catch { e.currentTarget.setCustomValidity('Use an HTTPS URL without credentials'); e.currentTarget.reportValidity(); } }}/></Field> : <Field label="Target"><select value={action.target} onChange={e => set(i, { target: e.target.value })}>{(action.action === 'navigate' ? doc.pages : page.nodes).map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></Field>}
    <button onClick={() => update({ interactions: actions.filter((_, index) => index !== i) })}>Remove interaction</button>
  </div>)}<button disabled={actions.length >= 20} onClick={() => update({ interactions: [...actions, { trigger: 'click', action: 'navigate', target: doc.pages[0].id }] })}>Add interaction</button></section>;
}
