import type { DesignDocument, DesignNode } from '../shared/schema';
import { Field } from './ui';

export function ComponentInspector({ doc, node, update }: { doc: DesignDocument; node: DesignNode; update: (patch: Partial<DesignNode>) => void }) {
  const component = node.component!;
  const props = component.props ?? {};
  const set = (key: string, value: string | number | boolean | string[]) => update({ component: { ...component, props: { ...props, [key]: value } } });
  const listed = ['List', 'Table', 'Chart', 'Select', 'Tabs', 'Radio'].includes(component.name);
  const numeric = ['InputNumber', 'Slider', 'Progress', 'Badge', 'Statistics'].includes(component.name);
  return <section className="component-properties"><h3>{component.name} properties</h3>
    <Field label="Component library"><select value={component.system} onChange={e => update({ component: { ...component, system: e.target.value as 'antd' | 'shadcn' } })}><option value="shadcn">shadcn-style</option><option value="antd">Ant Design</option></select></Field>
    <Field label="Label"><input value={String(props.label ?? node.text ?? node.name)} onChange={e => set('label', e.target.value)}/></Field>
    {component.name === 'Button' && <Field label="Variant"><select value={component.variant ?? 'default'} onChange={e => update({ component: { ...component, variant: e.target.value } })}>{['default', 'outline', 'text'].map(value => <option key={value}>{value}</option>)}</select></Field>}
    {['Input', 'Textarea', 'Select', 'Radio'].includes(component.name) && <Field label="Value"><input value={String(props.value ?? '')} onChange={e => set('value', e.target.value)}/></Field>}
    {['Input', 'Textarea'].includes(component.name) && <Field label="Placeholder"><input value={String(props.placeholder ?? '')} onChange={e => set('placeholder', e.target.value)}/></Field>}
    {['Image', 'Avatar'].includes(component.name) && <Field label="Image asset"><select value={node.src ?? ''} onChange={e => update({ src: e.target.value || undefined })}><option value="">None</option>{doc.assets.filter(a => a.mimeType.startsWith('image/')).map(a => <option key={a.id} value={a.url}>{a.name}</option>)}</select></Field>}
    {numeric && <Field label="Value"><input type="number" value={Number(props.value ?? 0)} onChange={e => set('value', +e.target.value)}/></Field>}
    {['InputNumber', 'Slider'].includes(component.name) && <div className="property-grid">{['min', 'max'].map(key => <Field key={key} label={key === 'min' ? 'Minimum' : 'Maximum'}><input type="number" value={Number(props[key] ?? (key === 'min' ? 0 : 100))} onChange={e => set(key, +e.target.value)}/></Field>)}</div>}
    {component.name === 'Statistics' && <Field label="Suffix"><input value={String(props.suffix ?? '')} onChange={e => set('suffix', e.target.value)}/></Field>}
    {['Card', 'Tabs', 'Dialog'].includes(component.name) && <Field label="Description"><textarea value={String(props.description ?? '')} onChange={e => set('description', e.target.value)}/></Field>}
    {listed && <Field label="Items (one per line)"><textarea value={(Array.isArray(props.items) ? props.items : ['First item', 'Second item', 'Third item']).join('\n')} onChange={e => set('items', e.target.value.split('\n'))}/></Field>}
    {component.name === 'Chart' && <Field label="Chart values (one per line)"><textarea value={(Array.isArray(props.values) ? props.values : ['1', '2', '3']).join('\n')} onChange={e => set('values', e.target.value.split('\n'))}/></Field>}
    {component.name === 'Table' && <Field label="Rows per page"><input type="number" min={1} max={100} value={Number(props.pageSize ?? 5)} onChange={e => set('pageSize', Math.max(1, Math.min(100, +e.target.value)))}/></Field>}
    {['Checkbox', 'Switch'].includes(component.name) && <label className="component-check"><input type="checkbox" checked={!!props.checked} onChange={e => set('checked', e.target.checked)}/>Checked</label>}
    {['Button', 'Checkbox', 'Input', 'Textarea', 'InputNumber', 'Slider', 'Select', 'Switch', 'Radio', 'Dialog'].includes(component.name) && <label className="component-check"><input type="checkbox" checked={!!props.disabled} onChange={e => set('disabled', e.target.checked)}/>Disabled</label>}
  </section>;
}
