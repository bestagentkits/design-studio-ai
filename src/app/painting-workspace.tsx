import { paintingRecoveryMatches } from './painting-recovery-state';
import { PaintingAdvancedControls } from './painting-advanced-controls';
import { readPaintingDraft, deletePaintingDraft } from './painting-draft-store';
import type { PaintingSelection } from '../shared/painting-selection';
import { PaintLayerControls } from './paint-layer-controls';
import { paintSource } from '../shared/paint-composite';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { X, Undo2, Redo2, Plus, Eye, LockKeyhole } from 'lucide-react';
import type { DesignDocument } from '../shared/schema';
import { uid } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
import type { PaintStroke } from '../shared/paint-stroke';
import { paintBrushPreset } from '../shared/paint-brush-presets';
import { InkInput } from '../shared/ink-stroke';
import { PaintingSession } from './painting-session';
import { PaintingRecovery } from './painting-recovery';
import { download } from './api';
import './creative-workspace.css';

export function PaintingWorkspace({ doc, paintingId, onCommit, onClose, onUndo, onRedo, accountId }: {
  accountId?: string; doc: DesignDocument; paintingId: string; onCommit: (base: DesignDocument, next: DesignDocument) => void; onClose: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const owner = useRef({ accountId, projectId: doc.id }), alive = useRef(true); owner.current = { accountId, projectId: doc.id };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const painting = doc.schemaVersion === 2 ? doc.paintings.find(p => p.id === paintingId) : undefined;
  const [layerId, setLayerId] = useState(painting?.layers.at(-1)?.id ?? ''), [preset, setPreset] = useState('bristle');
  const [size, setSize] = useState(40), [flow, setFlow] = useState(.8), [color, setColor] = useState('#b26442');
  const [busy, setBusy] = useState('Loading layers'), [error, setError] = useState('');
  const [editMask, setEditMask] = useState(false);
  const [tool, setTool] = useState('brush'), [feather, setFeather] = useState(0), [tolerance, setTolerance] = useState(24), [contiguous, setContiguous] = useState(true), [sampleVisible, setSampleVisible] = useState(false), [tilt, setTilt] = useState(true);
  const [selection, setSelection] = useState<PaintingSelection | undefined>();
  const selectionGesture = useRef<{ pointer: number; points: {x: number; y: number}[] } | null>(null), fillAbort = useRef<AbortController | null>(null);
  const [readyKey, setReadyKey] = useState('');
  const sourceKey = painting ? `${layerId}:${editMask}:${paintSource(painting)}` : '';
  const [recovery, setRecovery] = useState<PaintingRecovery | null>(null);
  const recoveryRef = useRef<PaintingRecovery | null>(null);
  useEffect(() => {
    recoveryRef.current = null; setRecovery(null); setReadyKey('');
    if (!accountId) return; let active = true;
    void readPaintingDraft(accountId, doc.id, paintingId).then(async stored => {
      if (!stored || !active) return;
      const preparedPainting = stored.prepared?.schemaVersion === 2 ? stored.prepared.paintings.find(p => p.id === paintingId) : undefined;
      if (preparedPainting && painting && paintingRecoveryMatches(preparedPainting, painting)) { await deletePaintingDraft(stored.key); return; }
      const pending = await PaintingRecovery.restore(stored); if (!active) return;
      recoveryRef.current = pending; setRecovery(pending); setBusy(''); setError('Recovered local changes. Inspect the preview, then retry or discard.');
      if (canvas.current) await pending.preview(canvas.current);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; fillAbort.current?.abort(); };
  }, [accountId, doc.id, paintingId]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => opener?.focus(); }, []);
  const canvas = useRef<HTMLCanvasElement>(null), session = useRef<PaintingSession | null>(null), epoch = useRef(0), frame = useRef(0), paintingPreview = useRef(false), previewPending = useRef(false);
  const gesture = useRef<{ pointer: number; stroke: PaintStroke; input: InkInput; session: PaintingSession; time: number; pressure: number } | null>(null);
  useEffect(() => {
    const target = canvas.current; if (!target) return;
    const lost = (event: Event) => { event.preventDefault(); gesture.current?.stroke.cancel(); gesture.current = null; epoch.current++; setError('Canvas context lost. Committed layers remain intact; waiting for restoration.'); };
    const restored = () => { const s = session.current; if (s) void s.preview(target).then(() => setError('Canvas restored.')).catch(error => setError(String(error))); };
    target.addEventListener('contextlost', lost); target.addEventListener('contextrestored', restored);
    return () => { target.removeEventListener('contextlost', lost); target.removeEventListener('contextrestored', restored); };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (gesture.current || recoveryRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const cancel = () => { selectionGesture.current = null; gesture.current?.stroke.cancel(); gesture.current = null; epoch.current++; cancelAnimationFrame(frame.current); frame.current = 0; };
  useEffect(() => {
    if (recoveryRef.current) return;
    cancel(); let active = true; const generation = ++epoch.current;
    if (!painting) return;
    if (!painting.layers.some(l => l.id === layerId)) { setLayerId(painting.layers.at(-1)!.id); return; }
    const next = new PaintingSession(structuredClone(doc), structuredClone(painting), layerId, editMask); setBusy('Loading layers'); setError('');
    void next.initialize().then(async () => { if (!active || recoveryRef.current) return; session.current = next; if (canvas.current) await next.preview(canvas.current, undefined, painting, () => active && epoch.current === generation); if (active) { setReadyKey(sourceKey); setBusy(''); } }).catch(e => { if (active) { setError(String(e)); setBusy(''); } });
    return () => { active = false; cancel(); if (!recoveryRef.current || recoveryRef.current.session !== next) next.dispose(); session.current = null; };
  }, [painting ? paintSource(painting) : null, layerId, editMask, recovery, accountId]);
  useEffect(() => { const blur = () => { if (recoveryRef.current) return; cancel(); const s = session.current, generation = epoch.current; if (s && canvas.current) void s.preview(canvas.current, undefined, s.painting, () => epoch.current === generation).catch(e => setError(String(e))); }; window.addEventListener('blur', blur); return () => window.removeEventListener('blur', blur); }, []);
  useEffect(() => {
    const s = session.current; if (!s || readyKey !== sourceKey || recoveryRef.current) return; let active = true;
    setBusy('Preparing selection'); void s.select(selection).then(() => { if (active) setBusy(''); }).catch(error => { if (active) { setError(String(error)); setSelection(undefined); } });
    return () => { active = false; };
  }, [selection, readyKey, sourceKey]);
  if (!painting) return <div role="alert">Painting unavailable. <button onClick={onClose}>Return to editor</button></div>;
  // Controls display the retained settings draft while uploads run; pixel sessions keep the committed source.
  const controlsPainting = recovery?.settings ?? painting;
  const unavailable = !!busy || !!recovery || readyKey !== sourceKey;
  const discard = () => {
    cancel(); const s = session.current, generation = epoch.current;
    if (s && canvas.current) void s.preview(canvas.current, undefined, s.painting, () => epoch.current === generation).catch(e => setError(String(e)));
  };
  const preview = () => {
    if (paintingPreview.current) { previewPending.current = true; return; }
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0; const g = gesture.current, target = canvas.current, generation = epoch.current;
      if (!g || !target) return; paintingPreview.current = true;
      void g.session.preview(target, g.stroke, g.session.painting, () => epoch.current === generation).catch(e => { setError(String(e)); cancel(); }).finally(() => { paintingPreview.current = false; if (gesture.current && previewPending.current) { previewPending.current = false; preview(); } });
    });
  };
  const append = (e: { clientX: number; clientY: number; timeStamp: number; pressure: number; tiltX?: number; tiltY?: number }) => {
    const g = gesture.current, target = canvas.current; if (!g || !target) return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(painting.width - 1, (e.clientX - rect.left) / rect.width * painting.width)), y = Math.max(0, Math.min(painting.height - 1, (e.clientY - rect.top) / rect.height * painting.height));
    g.time = Math.max(g.time, e.timeStamp); if (e.pressure) g.pressure = e.pressure;
    const p = g.input.sample(x, y, g.time, g.pressure); g.stroke.append([{ ...p, tiltX: e.tiltX, tiltY: e.tiltY }]);
  };
  const point = (e: {clientX: number; clientY: number}) => { const rect = canvas.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(painting.width - 1, (e.clientX - rect.left) / rect.width * painting.width)), y: Math.max(0, Math.min(painting.height - 1, (e.clientY - rect.top) / rect.height * painting.height)) }; };
  const fill = async (x: number, y: number, erase = false) => {
    const s = session.current; if (!s || unavailable) return;
    const controller = new AbortController(); fillAbort.current = controller; setBusy('Calculating fill'); setError('');
    try { const brush = paintBrushPreset(preset, size, flow, color); const draft = await s.fill({ x: Math.floor(x), y: Math.floor(y), color: brush.color, tolerance: erase ? 255 : tolerance, contiguous: erase ? false : contiguous, erase, selection }, sampleVisible, controller.signal); if (draft.dirtyKeys.length) await accept(new PaintingRecovery(s, draft, undefined, accountId)); }
    catch (error) { setError(String(error)); } finally { fillAbort.current = null; setBusy(''); }
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (unavailable || gesture.current || e.button !== 0 || !session.current) return;
    e.preventDefault(); setError('');
    if (tool === 'fill') { const p = point(e); void fill(p.x, p.y); return; }
    if (tool === 'rectangle' || tool === 'lasso') { selectionGesture.current = { pointer: e.pointerId, points: [point(e)] }; e.currentTarget.setPointerCapture(e.pointerId); return; }
    try {
      const s = session.current; const stroke = s.beginStroke({ ...paintBrushPreset(preset, size, flow, color), tilt: tilt ? 1 : 0 });
      gesture.current = { pointer: e.pointerId, stroke, session: s, input: new InkInput(e.pointerType === 'pen'), time: e.timeStamp, pressure: e.pointerType === 'pen' ? e.pressure : .5 };
      epoch.current++; append(e); e.currentTarget.setPointerCapture(e.pointerId); preview();
    } catch (error) { cancel(); setError(String(error)); }
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (selectionGesture.current?.pointer === e.pointerId) { if (selectionGesture.current.points.length < 2048) selectionGesture.current.points.push(point(e)); return; }
    if (gesture.current?.pointer !== e.pointerId) return;
    try { const events = e.nativeEvent.getCoalescedEvents?.() ?? []; for (const event of events.length ? events : [e.nativeEvent]) append(event); preview(); } catch (error) { cancel(); setError(String(error)); }
  };
  const up = async (e: PointerEvent<HTMLCanvasElement>) => {
    const selecting = selectionGesture.current; if (selecting?.pointer === e.pointerId) { selectionGesture.current = null; const points = tool === 'rectangle' ? [selecting.points[0], point(e)] : [...selecting.points, point(e)].slice(0, 2048); if (points.length >= (tool === 'rectangle' ? 2 : 3)) setSelection({ kind: tool as 'rectangle' | 'lasso', points, feather }); return; }
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    try { append(e); } catch (error) { discard(); setError(String(error)); return; }
    gesture.current = null; epoch.current++; cancelAnimationFrame(frame.current); frame.current = 0;
    try { g.stroke.seal(); } catch (error) { setError(String(error)); return; }
    await accept(new PaintingRecovery(g.session, g.stroke, undefined, accountId));
  };
  const accept = async (pending: PaintingRecovery) => {
    recoveryRef.current = pending; setRecovery(pending); setReadyKey(''); setBusy('Uploading changes'); setError('');
    try {
      await pending.persist();
      const prepared = await pending.prepare();
      if (!alive.current || owner.current.accountId !== pending.accountId || owner.current.projectId !== pending.base.id) return;
      onCommit(pending.base, prepared);
      pending.release(); recoveryRef.current = null; setRecovery(null);
    } catch (error) {
      if (!alive.current || owner.current.accountId !== pending.accountId || owner.current.projectId !== pending.base.id) return;
      setError(`Your local work is kept here. Retry, download a PNG backup, or discard it. ${String(error)}`);
      if (canvas.current) await pending.preview(canvas.current).catch(() => {});
    } finally { if (alive.current && owner.current.accountId === pending.accountId && owner.current.projectId === pending.base.id) setBusy(''); }
  };
  const backup = async () => {
    if (!recovery) return;
    setBusy('Preparing backup');
    try { const target = document.createElement('canvas'); target.width = painting.width; target.height = painting.height; await recovery.preview(target);
      const blob = await new Promise<Blob>((resolve, reject) => target.toBlob(value => value ? resolve(value) : reject(new Error('Cannot encode backup')), 'image/png'));
      download(`${painting.name}-local-backup.png`, blob, 'image/png');
    } catch (error) { setError(String(error)); } finally { setBusy(''); }
  };
  const settings = async (edit: (next: Painting) => void) => {
    const s = session.current; if (!s || unavailable || gesture.current) return;
    try {
      const next = structuredClone(painting); edit(next); next.generation++; delete next.composite;
      await accept(new PaintingRecovery(s, undefined, next, accountId));
    } catch (error) { setError(String(error)); }
  };
  return <dialog ref={dialog} className="creative-workspace paint-workspace" aria-label="Painting studio" onCancel={e => { e.preventDefault(); if (!busy && !recovery) { if (gesture.current) discard(); else onClose(); } }} onKeyDown={e => { e.stopPropagation(); if ((e.target as HTMLElement).matches('input,textarea,select')) return; if (e.key === 'Escape' && !busy && !recovery) { if (gesture.current) discard(); else onClose(); } }}>
    <header><div><span className="creative-eyebrow">DESIGN STUDIO / PAINT</span><h2>{painting.name}</h2></div><span className="creative-save-note">{busy || 'Stroke uploaded · Save project to persist layer changes'}</span><button disabled={!!busy || !!recovery || (!error && unavailable)} aria-label="Close painting studio" onClick={onClose}><X size={20}/></button></header>
    <div className="creative-main"><aside><label>Edit target<select aria-label="Paint edit target" value={editMask ? 'mask' : 'pixels'} disabled={unavailable} onChange={e => setEditMask(e.target.value === 'mask')}><option value="pixels">Layer pixels</option><option value="mask">Layer mask</option></select></label>{editMask && <small>Paint reveals; erase hides. A new mask starts hidden.</small>}<label>Tool<select aria-label="Painting tool" value={tool} disabled={unavailable} onChange={e => setTool(e.target.value)}><option value="brush">Brush</option><option value="rectangle">Rectangle selection</option><option value="lasso">Lasso selection</option><option value="fill">Fill</option></select></label><label>Selection feather<input type="number" min="0" max="128" value={feather} onChange={e => { const value = Math.max(0, Math.min(128, Number(e.target.value))); setFeather(value); if (selection) setSelection({ ...selection, feather: value }); }}/></label>{selection && <><span>{selection.kind} selection active</span><button onClick={() => setSelection(undefined)}>Clear selection</button><button disabled={unavailable} onClick={() => void fill(0, 0, true)}>Erase selection</button></>}<label>Fill tolerance<input type="range" min="0" max="255" value={tolerance} onChange={e => setTolerance(+e.target.value)}/></label><label><input type="checkbox" checked={contiguous} onChange={e => setContiguous(e.target.checked)}/>Contiguous fill</label><label><input type="checkbox" checked={sampleVisible} onChange={e => setSampleVisible(e.target.checked)}/>Sample visible layers</label><label><input type="checkbox" checked={tilt} onChange={e => setTilt(e.target.checked)}/>Pen tilt response</label><label>Brush<select disabled={unavailable} aria-label="Paint brush" value={preset} onChange={e => setPreset(e.target.value)}><option value="bristle">Bristle</option><option value="ink">Tapered ink</option><option value="dry">Dry brush</option><option value="wash">Watercolor wash</option><option value="smudge">Smudge</option><option value="erase">Eraser</option></select></label><label>Color<input aria-label="Paint color" type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>Size <b>{size}px</b><input aria-label="Paint size" type="range" min="2" max="128" value={size} onChange={e => setSize(+e.target.value)}/></label><label>Flow<input aria-label="Paint flow" type="range" min=".05" max="1" step=".05" value={flow} onChange={e => setFlow(+e.target.value)}/></label>
      <div className="paint-layers"><strong>Layers</strong><button aria-label="Add paint layer" disabled={unavailable || painting.layers.length >= 24} onClick={() => void settings(next => { const id = uid(); next.layers.push({ id, name: `Layer ${next.layers.length + 1}`, visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false, clipping: false, tiles: [] }); })}><Plus size={16}/></button>
        {[...painting.layers].reverse().map(layer => <div className="paint-layer" key={layer.id}><button aria-pressed={layerId === layer.id} disabled={unavailable} onClick={() => setLayerId(layer.id)}>{layer.name}</button><button aria-label={`Toggle ${layer.name} visibility`} disabled={unavailable} onClick={() => void settings(next => { next.layers.find(l => l.id === layer.id)!.visible = !layer.visible; })}><Eye size={15} opacity={layer.visible ? 1 : .3}/></button><button aria-label={`Toggle ${layer.name} lock`} disabled={unavailable} onClick={() => void settings(next => { next.layers.find(l => l.id === layer.id)!.locked = !layer.locked; })}><LockKeyhole size={15} opacity={layer.locked ? 1 : .3}/></button></div>)}
      </div><PaintLayerControls painting={controlsPainting} layerId={layerId} disabled={unavailable} onEdit={edit => void settings(edit)}/><PaintingAdvancedControls painting={controlsPainting} layerId={layerId} disabled={unavailable} onEdit={edit => void settings(edit)}/></aside><section className="creative-paper"><nav><button disabled={unavailable} aria-label="Undo painting" onClick={() => { cancel(); onUndo(); }}><Undo2 size={19}/></button><button disabled={unavailable} aria-label="Redo painting" onClick={() => { cancel(); onRedo(); }}><Redo2 size={19}/></button><span>{painting.width} × {painting.height}</span></nav>
      <div className="paint-canvas-wrap" style={{position: 'relative'}}><canvas ref={canvas} width={painting.width} height={painting.height} aria-busy={unavailable} style={{ aspectRatio: `${painting.width} / ${painting.height}` }} tabIndex={0} aria-label="Painting canvas" onPointerDown={down} onPointerMove={move} onPointerUp={e => void up(e)} onPointerCancel={discard} onLostPointerCapture={() => { if (gesture.current) discard(); }}/>{selection && <svg aria-label="Active painting selection" viewBox={`0 0 ${painting.width} ${painting.height}`} style={{position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none'}}><polygon points={(selection.kind === 'rectangle' ? [selection.points[0], {x: selection.points[1].x,y:selection.points[0].y},selection.points[1],{x:selection.points[0].x,y:selection.points[1].y}] : selection.points).map(p => `${p.x},${p.y}`).join(' ')} fill="rgba(80,150,255,.08)" stroke="#3278df" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke"/></svg>}</div><footer role="status">{fillAbort.current && <button onClick={() => fillAbort.current?.abort()}>Cancel fill</button>}{recovery && <div className="paint-recovery"><button disabled={!!busy} onClick={() => void accept(recovery)}>Retry changes</button><button disabled={!!busy} onClick={() => void backup()}>Download PNG backup</button><button disabled={!!busy} onClick={() => { recovery.discard(); recoveryRef.current = null; setRecovery(null); setError(''); discard(); }}>Discard local changes</button></div>}{error || busy || 'Bristle texture · Real color pickup · One stroke, one undo'}</footer>
    </section></div>
  </dialog>;
}
