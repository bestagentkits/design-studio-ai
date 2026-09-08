import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, InputNumber, Slider, Image, Avatar, List, Statistic, Table, Select, Switch, Card, Badge, Progress, Tabs, Radio, ConfigProvider } from 'antd';
import * as Check from '@radix-ui/react-checkbox';
import * as Toggle from '@radix-ui/react-switch';
import * as Range from '@radix-ui/react-slider';
import * as Dialog from '@radix-ui/react-dialog';
import type { DesignNode, Theme } from '../shared/schema';
import { isSafeUrl } from '../shared/schema';
import { resolveColor } from '../shared/render';

export function DesignComponent({ node, theme }: { node: DesignNode; theme: Theme }) {
  const component = node.component!; const props = component.props ?? {}, label = String(props.label ?? node.text ?? node.name);
  const [value, setValue] = useState(String(props.value ?? '')), [checked, setChecked] = useState(!!props.checked);
  useEffect(() => { setValue(String(props.value ?? '')); setChecked(!!props.checked); }, [node.id, props.value, props.checked]);
  const items = Array.isArray(props.items) ? props.items : ['First item', 'Second item', 'Third item'];
  const min = Number(props.min ?? 0), max = Number(props.max ?? 100), numeric = Number(value) || 0;
  const disabled = !!props.disabled, primary = resolveColor('$accent', theme), background = resolveColor('$background', theme), ink = resolveColor('$text', theme);
  const base = { width: '100%', boxSizing: 'border-box' as const, border: `1px solid ${resolveColor('$border', theme)}`, borderRadius: theme.radius, padding: '8px 12px', color: ink, background, font: 'inherit' };
  const data = items.map((item, index) => ({ key: index, name: item, value: index + 1 }));
  let content: React.ReactNode;
  if (component.system === 'antd') {
    switch (component.name) {
      case 'Button': content = <Button type="primary" block disabled={disabled}>{label}</Button>; break;
      case 'Checkbox': content = <Checkbox checked={checked} disabled={disabled} onChange={e => setChecked(e.target.checked)}>{label}</Checkbox>; break;
      case 'Input': content = <Input aria-label={label} value={value} placeholder={String(props.placeholder ?? label)} disabled={disabled} onChange={e => setValue(e.target.value)}/>; break;
      case 'Textarea': content = <Input.TextArea aria-label={label} value={value} placeholder={label} onChange={e => setValue(e.target.value)}/>; break;
      case 'InputNumber': content = <InputNumber aria-label={label} min={min} max={max} value={numeric} onChange={v => setValue(String(v ?? 0))}/>; break;
      case 'Slider': content = <Slider aria-label={label} min={min} max={max} value={numeric} onChange={v => setValue(String(v))}/>; break;
      case 'Image': content = node.src && isSafeUrl(node.src) ? <Image src={node.src} alt={label}/> : <span>Set an image asset</span>; break;
      case 'Avatar': content = <Avatar src={node.src && isSafeUrl(node.src) ? node.src : undefined}>{label.slice(0, 2)}</Avatar>; break;
      case 'List': content = <List bordered dataSource={items} renderItem={item => <List.Item>{item}</List.Item>}/>; break;
      case 'Statistics': content = <Statistic title={label} value={String(props.value ?? '0')} suffix={String(props.suffix ?? '')}/>; break;
      case 'Table': content = <Table size="small" pagination={{ pageSize: Number(props.pageSize ?? 5) }} dataSource={data} columns={[{ title: label, dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) }, { title: 'Value', dataIndex: 'value', sorter: (a, b) => a.value - b.value }]}/>; break;
      case 'Select': content = <Select aria-label={label} style={{ width: '100%' }} value={value || undefined} placeholder={label} options={items.map(item => ({ value: item, label: item }))} onChange={setValue}/>; break;
      case 'Switch': content = <Switch checked={checked} disabled={disabled} onChange={setChecked} aria-label={label}/>; break;
      case 'Card': content = <Card title={label}>{String(props.description ?? '')}</Card>; break;
      case 'Badge': content = <Badge count={numeric} showZero><span style={{ paddingRight: 20 }}>{label}</span></Badge>; break;
      case 'Progress': content = <Progress percent={numeric}/>; break;
      case 'Tabs': content = <Tabs items={items.map(item => ({ key: item, label: item, children: String(props.description ?? item) }))}/>; break;
      case 'Radio': content = <Radio.Group value={value} options={items} onChange={e => setValue(e.target.value)}/>; break;
    }
  }
  if (content === undefined) switch (component.name) {
    case 'Button': content = <button style={{ ...base, background: component.variant === 'outline' ? background : primary, color: component.variant === 'outline' ? ink : '#fff', cursor: 'pointer' }} disabled={disabled}>{label}</button>; break;
    case 'Checkbox': content = <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check.Root aria-label={label} checked={checked} disabled={disabled} onCheckedChange={v => setChecked(v === true)} style={{ ...base, width: 20, height: 20, padding: 0 }}><Check.Indicator>✓</Check.Indicator></Check.Root>{label}</label>; break;
    case 'Switch': content = <Toggle.Root aria-label={label} checked={checked} disabled={disabled} onCheckedChange={setChecked} style={{ width: 40, height: 24, background: checked ? primary : '#aaa', borderRadius: 20, border: 0, padding: 2 }}><Toggle.Thumb style={{ display: 'block', width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: `translateX(${checked ? 16 : 0}px)` }}/></Toggle.Root>; break;
    case 'Slider': content = <Range.Root aria-label={label} min={min} max={max} value={[numeric]} onValueChange={v => setValue(String(v[0]))} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 24, width: '100%', touchAction: 'none' }}><Range.Track style={{ background: '#aaa5', position: 'relative', flexGrow: 1, borderRadius: 10, height: 5 }}><Range.Range style={{ position: 'absolute', background: primary, height: '100%' }}/></Range.Track><Range.Thumb style={{ display: 'block', width: 18, height: 18, borderRadius: '50%', border: `2px solid ${primary}`, background }}/></Range.Root>; break;
    case 'Textarea': content = <textarea aria-label={label} style={base} value={value} placeholder={label} onChange={e => setValue(e.target.value)}/>; break;
    case 'Input': case 'InputNumber': content = <input aria-label={label} style={base} type={component.name === 'InputNumber' ? 'number' : 'text'} min={min} max={max} value={value} disabled={disabled} placeholder={String(props.placeholder ?? label)} onChange={e => setValue(e.target.value)}/>; break;
    case 'Select': content = <select aria-label={label} style={base} value={value} onChange={e => setValue(e.target.value)}><option value="">{label}</option>{items.map(item => <option key={item}>{item}</option>)}</select>; break;
    case 'Radio': content = <fieldset style={base}><legend>{label}</legend>{items.map(item => <label key={item}><input type="radio" name={node.id} checked={value === item} onChange={() => setValue(item)}/>{item}</label>)}</fieldset>; break;
    case 'Image': content = node.src && isSafeUrl(node.src) ? <img src={node.src} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: theme.radius }}/> : <span>Set an image asset</span>; break;
    case 'Avatar': content = <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%', background: primary, color: 'white', overflow: 'hidden' }}>{node.src && isSafeUrl(node.src) ? <img src={node.src} alt={label} style={{ width: '100%' }}/> : label.slice(0, 2)}</span>; break;
    case 'List': content = <ul style={{ ...base, listStyle: 'none' }}>{items.map(item => <li key={item} style={{ padding: 10, borderBottom: '1px solid #8883' }}>{item}</li>)}</ul>; break;
    case 'Statistics': content = <div><small>{label}</small><strong style={{ display: 'block', fontSize: 32 }}>{String(props.value ?? '0')}{String(props.suffix ?? '')}</strong></div>; break;
    case 'Badge': content = <span style={{ ...base, padding: '3px 8px', width: 'auto', fontSize: 12 }}>{label}</span>; break;
    case 'Progress': content = <progress aria-label={label} max={100} value={numeric} style={{ width: '100%', accentColor: primary }}/>; break;
    case 'Card': content = <article style={base}><h3>{label}</h3><p>{String(props.description ?? '')}</p></article>; break;
    case 'Tabs': content = <div><div role="tablist" style={{ display: 'flex', gap: 4 }}>{items.map(item => <button key={item} role="tab" aria-selected={(value || items[0]) === item} style={{ ...base, background: (value || items[0]) === item ? primary : background }} onClick={() => setValue(item)}>{item}</button>)}</div><div role="tabpanel" style={{ padding: 16 }}>{String(props.description ?? value ?? items[0])}</div></div>; break;
    case 'Table': content = <table style={{ ...base, borderCollapse: 'collapse' }}><thead><tr><th>{label}</th><th>Value</th></tr></thead><tbody>{data.map(row => <tr key={row.key}><td style={{ padding: 8, borderBottom: '1px solid #8883' }}>{row.name}</td><td>{row.value}</td></tr>)}</tbody></table>; break;
    case 'Chart': { const values = Array.isArray(props.values) ? props.values.map(Number) : items.map((_, i) => i + 1); const maximum = Math.max(1, ...values.filter(Number.isFinite)); content = <svg viewBox="0 0 400 240" role="img" aria-label={label}>{values.map((n, i) => <g key={i}><rect x={i * 400 / values.length + 8} y={200 - (Number.isFinite(n) ? n : 0) / maximum * 180} width={Math.max(1, 400 / values.length - 16)} height={Math.max(0, (Number.isFinite(n) ? n : 0) / maximum * 180)} fill={primary}/><text x={i * 400 / values.length + 8} y={225} fontSize="12" fill={ink}>{items[i]}</text></g>)}</svg>; break; }
    case 'Dialog': content = <Dialog.Root><Dialog.Trigger style={base}>{label}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 999 }}/><Dialog.Content style={{ ...base, position: 'fixed', width: 360, maxWidth: '90vw', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1000 }}><Dialog.Title>{label}</Dialog.Title><Dialog.Description>{String(props.description ?? '')}</Dialog.Description><Dialog.Close style={base}>Close</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>; break;
  }
  return <ConfigProvider theme={{ token: { colorPrimary: primary, borderRadius: theme.radius, fontFamily: theme.fonts.body } }}>{content}</ConfigProvider>;
}
