import { navigateButtonGroup } from './keyboard-navigation';
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, Group, Ungroup, CornerLeftUp, GripVertical, ArrowDown } from 'lucide-react';
import type { DesignDocument, DesignPage } from '../shared/schema';
import { childrenOf } from '../shared/layout';
import { mutateDocument } from '../shared/operations';
import { isNodeProtected, selectedRoots } from './editor-selection';

export function LayerTree({ doc, page, selection, select, group, ungroup, change }: {
  doc: DesignDocument; page: DesignPage; selection: string[]; select: (id: string, additive?: boolean) => void;
  group: () => void; ungroup: () => void; change: (recipe: (doc: DesignDocument) => void) => void;
}) {
  const [collapsed, collapse] = useState<Set<string>>(new Set()), [error, setError] = useState('');
  const [drop, setDrop] = useState<{ id: string; where: 'above' | 'inside' | 'below' } | null>(null);
  const dragging = useRef<string | null>(null);
  const targetAt = (element: HTMLElement, y: number) => {
    const id = element.dataset.layerId!, target = page.nodes.find(n => n.id === id)!;
    const box = element.getBoundingClientRect(), fraction = (y - box.top) / box.height;
    const where = ['frame', 'group', 'component'].includes(target.type) && fraction > .3 && fraction < .7 ? 'inside' : fraction < .5 ? 'above' : 'below';
    return { id, where } as const;
  };
  const finishDrop = (id: string, destination: NonNullable<typeof drop>) => {
    if (id === destination.id) return;
    const target = page.nodes.find(n => n.id === destination.id)!;
    if (isNodeProtected(page, target)) return;
    const siblings = childrenOf(page, target.parentId).filter(n => n.id !== id);
    move(id, destination.where === 'inside' ? target.id : target.parentId ?? null, destination.where === 'inside' ? childrenOf(page, target.id).length : siblings.findIndex(n => n.id === target.id) + (destination.where === 'above' ? 1 : 0));
  };
  const selected = selection.at(-1), roots = selectedRoots(page, selection);
  const move = (nodeId: string, parentId: string | null, index: number) => {
    const node = page.nodes.find(item => item.id === nodeId);
    if (!node || !selectedRoots(page, [nodeId]).length) return;
    try { const result = mutateDocument(doc, [{ op: 'reparent-node', nodeId, parentId, index }]); change(d => Object.assign(d, result)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid parent'); }
  };
  const rows = (parentId?: string, depth = 0): React.ReactNode => childrenOf(page, parentId).slice().reverse().map(n => {
    const children = childrenOf(page, n.id), container = ['frame', 'group', 'component'].includes(n.type), protectedNode = isNodeProtected(page, n);
    return <div key={n.id} role="treeitem" aria-selected={selection.includes(n.id)} aria-expanded={children.length ? !collapsed.has(n.id) : undefined}>
      <div data-layer-id={n.id} className={`layer-row ${selection.includes(n.id) ? 'selected' : ''} ${drop?.id === n.id ? `drop-${drop.where}` : ''}`} style={{ paddingLeft: 8 + depth * 14 }} draggable={!protectedNode}
        onDragStart={e => { dragging.current = n.id; e.dataTransfer.setData('application/studio-node', n.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { dragging.current = null; setDrop(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDrop(targetAt(e.currentTarget, e.clientY)); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('application/studio-node'); if (id) finishDrop(id, targetAt(e.currentTarget, e.clientY)); dragging.current = null; setDrop(null); }}>
        <button className="layer-grip" aria-label={`Drag ${n.name} to reorder`} title="Drag to reorder; use move buttons with keyboard" disabled={protectedNode}
          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); dragging.current = n.id; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { if (dragging.current !== n.id) return; const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-id]'); if (row) setDrop(targetAt(row, e.clientY)); }}
          onPointerUp={() => { if (dragging.current && drop) finishDrop(dragging.current, drop); dragging.current = null; setDrop(null); }}
          onPointerCancel={() => { dragging.current = null; setDrop(null); }}><GripVertical size={14}/></button>
        <label className="layer-select"><input type="checkbox" aria-label={`Select ${n.name} for grouping`} title="Add or remove from selection" checked={selection.includes(n.id)} onChange={() => select(n.id, true)}/></label>
        <button aria-label={`Expand ${n.name}`} disabled={!children.length} onClick={() => collapse(prev => { const next = new Set(prev); next.has(n.id) ? next.delete(n.id) : next.add(n.id); return next; })}>{children.length ? collapsed.has(n.id) ? <ChevronRight size={14}/> : <ChevronDown size={14}/> : <span aria-hidden="true">·</span>}</button>
        <button className="layer-name" aria-pressed={selection.includes(n.id)} onClick={event => select(n.id, event.shiftKey)}>{n.name}</button>
        <button title="Move up" aria-label={`Move ${n.name} up`} disabled={protectedNode} onClick={() => move(n.id, n.parentId ?? null, Math.min(childrenOf(page, n.parentId).length - 1, childrenOf(page, n.parentId).findIndex(x => x.id === n.id) + 1))}><ArrowUp size={14}/></button><button title="Move down" aria-label={`Move ${n.name} down`} disabled={protectedNode} onClick={() => move(n.id, n.parentId ?? null, Math.max(0, childrenOf(page, n.parentId).findIndex(x => x.id === n.id) - 1))}><ArrowDown size={14}/></button>
      </div>{!collapsed.has(n.id) && <div role="group">{rows(n.id, depth + 1)}</div>}
    </div>;
  });
  return <div className="layers-panel">
    <div className="layer-heading"><h3>{page.name}</h3><span>{selection.length ? `${selection.length} selected` : `${page.nodes.length} layers`}</span></div>
    <div className="layer-actions">
      <button className="icon-button" title="Group (⌘/Ctrl+G)" aria-label="Group" onClick={group} disabled={roots.length < 2}><Group size={16}/></button>
      <button className="icon-button" title="Ungroup (⌘/Ctrl+Shift+G)" aria-label="Ungroup" disabled={!roots.some(n => n.type === 'group')} onClick={ungroup}><Ungroup size={16}/></button>
      <button className="icon-button" title="Move selected layer to root" aria-label="To root" disabled={selection.length !== 1 || !roots.length} onClick={() => selected && move(selected, null, page.nodes.length)}><CornerLeftUp size={16}/></button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div role="tree" aria-label="Layers" aria-multiselectable="true" onKeyDown={event => navigateButtonGroup(event, '.layer-name', 'vertical')}>{rows()}</div>
    <p className="layer-tip">Shift + click or use checkboxes to select multiple layers. Drag the grip to reorder. Drop at a row edge to reorder, or its center to nest. Move buttons also work with keyboard.</p>
  </div>;
}
