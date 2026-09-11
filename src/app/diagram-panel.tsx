import { DiagramStylePanel } from './diagram-style-panel';
import { useEffect, useState } from 'react';
import type { DesignDocument } from '../shared/schema';
import { uid } from '../shared/schema';
import { applyDiagramOperation, type DiagramOperation } from '../shared/diagram-operations';
import { diagramRoles, type SemanticElement } from '../shared/diagram-presets';
import type { DiagramFamily, DiagramNode } from '../shared/diagram-schema';
export function DiagramPanel({ doc, boardId, onCommit, selectedIds = [] }: { doc: DesignDocument; boardId: string; onCommit: (base: DesignDocument, next: DesignDocument) => void; selectedIds?: string[] }) {
  const [family, setFamily] = useState<DiagramFamily>('flowchart'), [role, setRole] = useState<DiagramNode['role']>('process');
  const [label, setLabel] = useState('New step'), [source, setSource] = useState(''), [target, setTarget] = useState(''), [error, setError] = useState(''), [bends, setBends] = useState('[]');
  const board = doc.schemaVersion === 2 ? doc.boards.find(b => b.id === boardId) : undefined;
  const selected = board?.elements.find(e => e.id === selectedIds[0]) as SemanticElement | undefined;
  useEffect(()=>{setLabel(selected?.diagram?.label ?? (selected?.type==='connector'?selected.label:'New step'));},[selected?.id,selected?.diagram?.label,selected?.type==='connector'?selected.label:undefined]);
  function run(action: DiagramOperation) { try { const next = applyDiagramOperation(doc, action); onCommit(doc, next); setError(''); } catch (e) { setError((e as Error).message); } }
  function insert(relation: 'child' | 'sibling') { if (selected) run({ op: 'mind-map-insert', boardId, relativeId: selected.id, relation, id: uid(), label }); }
  return <section aria-label="Diagram tools" className="panel" onKeyDown={e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (selected?.diagram?.family === 'mind-map' && e.altKey && (e.key === 'Enter' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); insert(e.key === 'Enter' ? 'sibling' : 'child'); }
  }}>
    <h3>Diagrams</h3>
    <label>Diagram family<select aria-label="Diagram family" value={family} onChange={e => { const next = e.target.value as DiagramFamily; setFamily(next); setRole(diagramRoles[next][0]); }}>
      <option value="flowchart">Flowchart</option><option value="architecture">Architecture</option><option value="user-flow">User flow</option><option value="mind-map">Mind map</option>
    </select></label>
    <button onClick={() => run({ op: 'diagram-template', boardId, family, prefix: uid() })}>Insert {family} example</button>
    <label>Node role<select value={role} onChange={e => setRole(e.target.value as DiagramNode['role'])}>{diagramRoles[family].map(r => <option key={r}>{r}</option>)}</select></label>
    <label>Label<input value={label} onChange={e => setLabel(e.target.value)} /></label>
    <button onClick={() => run({ op: 'diagram-node', boardId, id: uid(), family, role, label, x: 100, y: 100 })}>Add diagram node</button>
    {selected?.diagram && <><button onClick={() => run({ op: 'diagram-update', boardId, elementId: selected.id, changes: { label } })}>Apply label to selected node</button><label><input type="checkbox" checked={selected.diagram.pinned} onChange={e => run({ op: 'diagram-update', boardId, elementId: selected.id, changes: { pinned: e.target.checked } })} />Pin during layout</label></>}
    <label>From<select value={source} onChange={e => setSource(e.target.value)}><option value="">Select source</option>{board?.elements.filter(e => e.type !== 'connector').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label>To<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Select target</option>{board?.elements.filter(e => e.type !== 'connector').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <button disabled={!source || !target} onClick={() => run({ op: 'diagram-connect', boardId, id: uid(), sourceId: source, targetId: target, label })}>Connect nodes</button>
    {selected?.type === 'connector' && <><button onClick={() => run({ op: 'diagram-edge', boardId, edgeId: selected.id, label })}>Set connection label</button><label>Routing<select value={selected.routing} onChange={e => run({ op: 'diagram-edge', boardId, edgeId: selected.id, routing: e.target.value as 'straight' | 'elbow' | 'curve' })}><option value="straight">Straight</option><option value="elbow">Orthogonal</option><option value="curve">Curved</option></select></label>{(['start', 'end'] as const).map(endpoint => <button key={endpoint} onClick={() => run({ op: 'diagram-detach', boardId, edgeId: selected.id, endpoint })}>Detach {endpoint}</button>)}</>}
    {selected?.type === 'connector' && <>
      <details><summary>Advanced coordinates</summary><label>Manual bends (JSON points)<input aria-label="Manual bends" value={bends} onChange={e => setBends(e.target.value)} /></label>
      <button onClick={() => { try { run({ op: 'diagram-edge', boardId, edgeId: selected.id, bends: JSON.parse(bends) }); } catch { setError('Enter a JSON array of x/y points'); } }}>Apply bends</button></details>
      {(['start', 'end'] as const).map(endpoint => <label key={endpoint}>{endpoint} arrow<select value={endpoint === 'start' ? selected.startArrow : selected.endArrow} onChange={e => run({ op: 'diagram-edge', boardId, edgeId: selected.id, [endpoint === 'start' ? 'startArrow' : 'endArrow']: e.target.value })}><option>none</option><option>arrow</option><option>dot</option></select></label>)}
      <button disabled={!source} onClick={() => run({ op: 'diagram-reconnect', boardId, edgeId: selected.id, endpoint: 'start', value: { point: selected.start.point, binding: { elementId: source, anchor: { x: 1, y: .5 } } } })}>Reconnect start to From</button>
      <button disabled={!target} onClick={() => run({ op: 'diagram-reconnect', boardId, edgeId: selected.id, endpoint: 'end', value: { point: selected.end.point, binding: { elementId: target, anchor: { x: 0, y: .5 } } } })}>Reconnect end to To</button>
    </>}
    <div role="group" aria-label="Diagram layout">{(['layered', 'tree', 'radial'] as const).map(mode => <button key={mode} onClick={() => run({ op: 'diagram-layout', boardId, mode, selectedIds })}>{mode} layout</button>)}</div>
    {selected?.diagram?.family === 'mind-map' && <><button onClick={() => insert('child')}>Add child (Alt+Right)</button><button onClick={() => insert('sibling')}>Add sibling (Alt+Enter)</button><button onClick={() => run({ op: 'mind-map-state', boardId, elementId: selected.id, collapsed: !board?.mindMap?.find(n => n.elementId === selected.id)?.collapsed })}>Toggle branch collapse</button></>}
    {selected?.type==='connector' && <><label>Label position<input aria-label="Connection label position" type="range" min="0" max="1" step=".05" value={selected.labelPosition} onChange={e=>run({op:'diagram-edge',boardId,edgeId:selected.id,labelPosition:+e.target.value})}/></label><button onClick={()=>run({op:'diagram-edge',boardId,edgeId:selected.id,bends:[]})}>Reset automatic route</button><p>Drag endpoints to reconnect. Drag a segment handle to reshape the edge.</p></>}
    {board && <DiagramStylePanel board={board} ids={selectedIds} run={run}/>}
    <p>Layouts preserve locked and pinned nodes and manual bends. Select nodes to arrange only that region.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
