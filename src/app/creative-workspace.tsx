import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { X, MousePointer2, Pencil, Square, Circle, Diamond, Type, ArrowUpRight, Undo2, Redo2, Trash2, Minus, Plus } from 'lucide-react';
import { type DesignDocument, uid } from '../shared/schema';
import { type BoardElement, boardElementSchema } from '../shared/board-schema';
import { boardElementSvg } from '../shared/board-render';
import { InkInput, type InkSample } from '../shared/ink-stroke';
import { mutateDocument } from '../shared/operations';
import './creative-workspace.css';

type Tool = 'select' | 'draw' | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'connector';
type Gesture = { pointer: number; base: DesignDocument; input: InkInput; points: InkSample[]; element: BoardElement; start: { x: number; y: number }; move: boolean };
type TextDraft = { id: string; base: DesignDocument; original: string; value: string };
export function CreativeWorkspace({ doc, boardId, onCommit, onClose, onUndo, onRedo }: {
  doc: DesignDocument; boardId: string; onCommit: (base: DesignDocument, next: DesignDocument) => void;
  onClose: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const board = doc.schemaVersion === 2 ? doc.boards.find(b => b.id === boardId) : undefined;
  const [tool, setTool] = useState<Tool>('draw'), [color, setColor] = useState('#26352d'), [size, setSize] = useState(16);
  const [selected, setSelected] = useState<string>(), [draft, setDraft] = useState<BoardElement>(), [error, setError] = useState('');
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, width: 960, height: 640 });
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => opener?.focus(); }, []);
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef(0);
  const cancel = () => { gesture.current = null; cancelAnimationFrame(frame.current); setDraft(undefined); };
  useEffect(() => { const blur = () => cancel(); window.addEventListener('blur', blur); return () => { window.removeEventListener('blur', blur); cancelAnimationFrame(frame.current); }; }, []);
  const active = board?.elements.find(e => e.id === selected);
  const activeText = active?.type === 'text' ? active.text : undefined;
  useEffect(() => {
    if (active?.type !== 'text') { setTextDraft(null); return; }
    setTextDraft(current => current?.id === active.id ? current : { id: active.id, base: structuredClone(doc), original: active.text, value: active.text });
  }, [active?.id, activeText, active?.type]);
  if (!board) return <div role="alert">Board unavailable. <button onClick={onClose}>Return to editor</button></div>;
  const commitTextDraft = (entry = textDraft) => {
    if (!entry) return true;
    if (entry.value === entry.original) { setTextDraft(null); return true; }
    try {
      const sourceBoard = entry.base.schemaVersion === 2 ? entry.base.boards.find(b => b.id === boardId) : undefined;
      const source = sourceBoard?.elements.find(e => e.id === entry.id);
      if (source?.type !== 'text') throw new Error('Text element changed. Select it again before editing.');
      onCommit(entry.base, mutateDocument(entry.base, [{ op: 'upsert-board-elements', boardId, elements: [{ ...source, text: entry.value }] }]));
      setTextDraft(null); return true;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };
  const point = (event: { clientX: number; clientY: number }) => {
    const matrix = svg.current?.getScreenCTM(); if (!matrix) throw new Error('Canvas is not ready');
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y };
  };
  const refresh = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) setDraft(structuredClone(gesture.current.element)); }); };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault(); setError('');
    try {
      const start = point(event), hit = (event.target as Element).closest('[data-board-element]')?.getAttribute('data-board-element');
      const target = board.elements.find(e => e.id === hit);
      if (tool === 'select' && !target) { setSelected(undefined); return; }
      if (tool === 'select' && target?.locked) { setError('Unlock this element before moving it.'); return; }
      const input = new InkInput(event.pointerType === 'pen');
      const sample = input.sample(start.x, start.y, event.timeStamp, event.pointerType === 'pen' ? event.pressure : .5);
      const base = { id: uid(), name: tool === 'draw' ? 'Ink stroke' : tool, x: start.x, y: start.y, width: 1, height: 1, stroke: color, fill: 'none', strokeWidth: tool === 'draw' ? size : 2 };
      let element: BoardElement;
      if (tool === 'select' && target) element = structuredClone(target);
      else if (tool === 'draw') element = boardElementSchema.parse({ ...base, type: 'stroke', algorithm: 'perfect-freehand-1.2.3', points: [{ ...sample, x: 0, y: 0 }] });
      else if (tool === 'connector') element = boardElementSchema.parse({ ...base, x: 0, y: 0, type: 'connector', start: { point: start, ...(target ? { binding: { elementId: target.id, anchor: { x: .5, y: .5 } } } : {}) }, end: { point: start }, routing: 'elbow', bends: [], startArrow: 'none', endArrow: 'arrow' });
      else if (tool === 'text') element = boardElementSchema.parse({ ...base, type: 'text', text: 'Text', width: 240, height: 48, fontFamily: 'Arial', fontSize: 28 });
      else element = boardElementSchema.parse({ ...base, type: 'shape', shape: tool, fill: '#eef3ed' });
      gesture.current = { pointer: event.pointerId, base: structuredClone(doc), input, points: [sample], element, start, move: tool === 'select' };
      setSelected(element.id); setDraft(element); event.currentTarget.setPointerCapture(event.pointerId);
    } catch (e) { cancel(); setError(String(e)); }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
    try {
      const events = event.nativeEvent.getCoalescedEvents?.() ?? []; const samples = events.length ? events : [event.nativeEvent];
      for (const e of samples) {
        const p = point(e), last = g.points.at(-1)!;
        if (g.move) {
          const original = g.base.schemaVersion === 2 ? g.base.boards.find(b => b.id === boardId)!.elements.find(el => el.id === g.element.id)! : g.element;
          if (g.element.type === 'connector') continue;
          g.element.x = original.x + p.x - g.start.x; g.element.y = original.y + p.y - g.start.y;
        } else if (g.element.type === 'stroke') {
          if (g.points.length >= 4096) throw new Error('Stroke is too long. Draw the next part as a new stroke.');
          const sample = g.input.sample(p.x, p.y, Math.max(e.timeStamp, last.time), e.pointerType === 'pen' ? (e.pressure || last.pressure) : .5);
          g.points.push(sample); g.element.points.push({ x: sample.x - g.start.x, y: sample.y - g.start.y, pressure: sample.pressure });
          g.element.width = Math.max(1, ...g.points.map(s => Math.abs(s.x - g.start.x))); g.element.height = Math.max(1, ...g.points.map(s => Math.abs(s.y - g.start.y)));
        } else if (g.element.type === 'connector') g.element.end = { point: p };
        else if (g.element.type === 'shape') { g.element.x = Math.min(p.x, g.start.x); g.element.y = Math.min(p.y, g.start.y); g.element.width = Math.max(1, Math.abs(p.x - g.start.x)); g.element.height = Math.max(1, Math.abs(p.y - g.start.y)); }
      }
      refresh();
    } catch (e) { cancel(); setError(e instanceof Error ? e.message : String(e)); }
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    move(event); const g = gesture.current; if (!g) return;
    try {
      if (g.element.type === 'connector') {
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-board-element]')?.getAttribute('data-board-element');
        const target = board.elements.find(e => e.id === hit && !['connector', 'group'].includes(e.type));
        if (target) g.element.end.binding = { elementId: target.id, anchor: { x: .5, y: .5 } };
      }
      const next = mutateDocument(g.base, [{ op: 'upsert-board-elements', boardId, elements: [g.element] }]);
      onCommit(g.base, next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { cancel(); }
  };
  const remove = () => { if (selected) { try { setTextDraft(null); onCommit(doc, mutateDocument(doc, [{ op: 'remove-board-elements', boardId, elementIds: [selected] }])); setSelected(undefined); } catch (e) { setError(String(e)); } } };
  const tools = [['select', MousePointer2, 'Select'], ['draw', Pencil, 'Draw'], ['rectangle', Square, 'Rectangle'], ['ellipse', Circle, 'Ellipse'], ['diamond', Diamond, 'Decision'], ['text', Type, 'Text'], ['connector', ArrowUpRight, 'Connect']] as const;
  const textPreview = active?.type === 'text' && textDraft?.id === active.id ? { ...active, text: textDraft.value } : undefined;
  const displayBoard = textPreview ? { ...board, elements: board.elements.map(e => e.id === textPreview.id ? textPreview : e) } : board;
  return <dialog ref={dialog} className="creative-workspace" aria-label="Creative board" onCancel={e => { e.preventDefault(); if (gesture.current) cancel(); else onClose(); }} onKeyDown={e => {
    e.stopPropagation(); if ((e.target as HTMLElement).matches('input,textarea,select')) return;
    if (e.key === 'Escape') { if (gesture.current) cancel(); else onClose(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancel(); setTextDraft(null); e.shiftKey ? onRedo() : onUndo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
  }}>
    <header><div><span className="creative-eyebrow">DESIGN STUDIO / BOARD</span><h2>{board.name}</h2></div><span className="creative-save-note">Edits join your project · Save in Studio</span><button aria-label="Close creative board" onClick={onClose}><X size={20}/></button></header>
    <div className="creative-main"><aside><label>Ink color<input aria-label="Ink color" type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>Stroke size <b>{size}px</b><input aria-label="Stroke size" type="range" min="2" max="64" value={size} onChange={e => setSize(+e.target.value)}/></label><p>Move slowly for a fuller line. Move quickly for a fine, tapered stroke.</p>
      {active?.type === 'text' && textDraft && <label>Text<textarea aria-label="Board text" value={textDraft.value} onChange={e => setTextDraft({ ...textDraft, value: e.target.value })} onBlur={e => commitTextDraft({ ...textDraft, value: e.currentTarget.value })}/></label>}
      <button disabled={!selected} onClick={remove}><Trash2 size={16}/> Delete selection</button>
    </aside><section className="creative-paper"><nav aria-label="Board tools">{tools.map(([key, Icon, label]) => <button key={key} aria-label={label} aria-pressed={tool === key} onClick={() => { cancel(); setTool(key); }}><Icon size={20}/><span>{label}</span></button>)}<i/><button aria-label="Undo board edit" onClick={() => { cancel(); setTextDraft(null); onUndo(); }}><Undo2 size={19}/></button><button aria-label="Redo board edit" onClick={() => { cancel(); setTextDraft(null); onRedo(); }}><Redo2 size={19}/></button></nav>
      <svg ref={svg} tabIndex={0} aria-label="Drawing canvas" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} onWheel={e => { if (gesture.current) return; if (e.ctrlKey || e.metaKey) { const factor = e.deltaY > 0 ? 1.1 : .9; setCamera(c => ({ ...c, width: Math.min(20000, Math.max(96, c.width * factor)), height: Math.min(14000, Math.max(64, c.height * factor)) })); } else setCamera(c => ({ ...c, x: c.x + e.deltaX, y: c.y + e.deltaY })); }}>
        <rect x={camera.x} y={camera.y} width={camera.width} height={camera.height} fill={board.background}/>
        <g dangerouslySetInnerHTML={{ __html: displayBoard.elements.filter(e => e.id !== draft?.id).map(e => boardElementSvg(displayBoard, e, doc)).join('') }}/>
        {draft && <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: boardElementSvg({ ...displayBoard, elements: [...displayBoard.elements.filter(e => e.id !== draft.id), draft] }, draft, doc) }}/>}
        {active && tool === 'select' && active.type !== 'connector' && <rect pointerEvents="none" x={draft?.x ?? active.x} y={draft?.y ?? active.y} width={active.width} height={active.height} fill="none" stroke="#2b6955" strokeWidth="1.5" strokeDasharray="5 4"/>}
      </svg><footer><span>{error || `${board.elements.length} elements · ${tool === 'draw' ? 'Pressure-sensitive ink' : 'One gesture, one undo'}`}</span><div><button aria-label="Zoom out" onClick={() => setCamera(c => ({ ...c, width: Math.min(20000, c.width * 1.2), height: Math.min(14000, c.height * 1.2) }))}><Minus size={16}/></button><button onClick={() => setCamera({ x: 0, y: 0, width: 960, height: 640 })}>Reset view</button><button aria-label="Zoom in" onClick={() => setCamera(c => ({ ...c, width: Math.max(96, c.width / 1.2), height: Math.max(64, c.height / 1.2) }))}><Plus size={16}/></button></div></footer>
    </section></div>
  </dialog>;
}
