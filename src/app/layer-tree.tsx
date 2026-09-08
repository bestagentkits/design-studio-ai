import { navigateButtonGroup } from './keyboard-navigation';
import { useState } from 'react';
import type { DesignDocument, DesignPage, DesignNode } from '../shared/schema';
import { childrenOf, subtree } from '../shared/layout';
import { mutateDocument } from '../shared/operations';
import { uid } from './api';
export function LayerTree({ doc, page, selected, select, change, measured }: { doc: DesignDocument; page: DesignPage; measured?: DesignNode[]; selected: string | null; select: (id: string | null) => void; change: (recipe: (doc: DesignDocument) => void) => void }) {
  const [collapsed, collapse] = useState<Set<string>>(new Set()), [checked, check] = useState<string[]>([]), [error, setError] = useState('');
  const move = (nodeId: string, parentId: string | null, index: number) => { try { const result = mutateDocument(doc, [{ op: 'reparent-node', nodeId, parentId, index }]); change(d => Object.assign(d, result)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid parent'); } };
  const group = () => {
    const items = page.nodes.filter(n => checked.includes(n.id)); if (!items.length || items.some(n => n.parentId !== items[0].parentId)) { setError('Select siblings to group.'); return; }
    const id = uid();
    const relevant = measured?.filter(n => checked.includes(n.id) || n.id === items[0].parentId).map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
    try { const next = mutateDocument(doc, [{ op: 'group-nodes', pageId: page.id, nodeIds: checked, groupId: id, ...(relevant?.length ? { bounds: relevant } : {}) }]); change(d => Object.assign(d, next)); select(id); check([]); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Cannot group layers'); }
  };
  const rows = (parentId?: string, depth = 0): React.ReactNode => childrenOf(page, parentId).slice().reverse().map(n => {
    const children = childrenOf(page, n.id), container = ['frame', 'group', 'component'].includes(n.type);
    return <div key={n.id} role="treeitem" aria-expanded={children.length ? !collapsed.has(n.id) : undefined}>
      <div className={`layer-row ${selected === n.id ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} draggable onDragStart={e => e.dataTransfer.setData('application/studio-node', n.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('application/studio-node'); if (id) move(id, container && !e.shiftKey ? n.id : n.parentId ?? null, container && !e.shiftKey ? children.length : childrenOf(page, n.parentId).findIndex(x => x.id === n.id)); }}>
        <input type="checkbox" aria-label={`Select ${n.name} for grouping`} checked={checked.includes(n.id)} onChange={e => check(e.target.checked ? [...checked, n.id] : checked.filter(id => id !== n.id))}/>
        <button aria-label={`Expand ${n.name}`} onClick={() => collapse(prev => { const next = new Set(prev); next.has(n.id) ? next.delete(n.id) : next.add(n.id); return next; })}>{children.length ? collapsed.has(n.id) ? '▸' : '▾' : '·'}</button>
        <button className="layer-name" aria-pressed={selected === n.id} onClick={() => select(n.id)}>{n.name}</button>
        <button title="Move up" aria-label={`Move ${n.name} up`} onClick={() => move(n.id, n.parentId ?? null, Math.min(childrenOf(page, n.parentId).length - 1, childrenOf(page, n.parentId).findIndex(x => x.id === n.id) + 1))}>↑</button>
      </div>{!collapsed.has(n.id) && <div role="group">{rows(n.id, depth + 1)}</div>}
    </div>;
  });
  return <div className="layers-panel"><div className="layer-heading"><h3>{page.name}</h3><span>{page.nodes.length} layers</span></div><div className="button-row"><button onClick={group} disabled={!checked.length}>Group</button><button disabled={!selected || !page.nodes.some(n => n.id === selected && n.type === 'group')} onClick={() => { try { const next = mutateDocument(doc, [{ op: 'ungroup-node', nodeId: selected! }]); change(d => Object.assign(d, next)); select(null); } catch (e) { setError(e instanceof Error ? e.message : 'Cannot ungroup'); } }}>Ungroup</button><button disabled={!selected} onClick={() => selected && move(selected, null, page.nodes.length)}>To root</button></div>
    {error && <p role="alert">{error}</p>}<div role="tree" aria-label="Layers" onKeyDown={event => navigateButtonGroup(event, ".layer-name", "vertical")}>{rows()}</div><p className="layer-tip">Drop into a container to nest. Shift + drop inserts before a sibling.</p></div>;
}
