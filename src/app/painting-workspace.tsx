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

export function PaintingWorkspace({ doc, paintingId, onCommit, onClose, onUndo, onRedo }: {
  doc: DesignDocument; paintingId: string; onCommit: (base: DesignDocument, next: DesignDocument) => void; onClose: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const painting = doc.schemaVersion === 2 ? doc.paintings.find(p => p.id === paintingId) : undefined;
  const [layerId, setLayerId] = useState(painting?.layers.at(-1)?.id ?? ''), [preset, setPreset] = useState('bristle');
  const [size, setSize] = useState(40), [flow, setFlow] = useState(.8), [color, setColor] = useState('#b26442');
  const [busy, setBusy] = useState('Loading layers'), [error, setError] = useState('');
  const [readyKey, setReadyKey] = useState('');
  const sourceKey = painting ? `${layerId}:${paintSource(painting)}` : '';
  const [recovery, setRecovery] = useState<PaintingRecovery | null>(null);
  const recoveryRef = useRef<PaintingRecovery | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => opener?.focus(); }, []);
  const canvas = useRef<HTMLCanvasElement>(null), session = useRef<PaintingSession | null>(null), epoch = useRef(0), frame = useRef(0), paintingPreview = useRef(false), previewPending = useRef(false);
  const gesture = useRef<{ pointer: number; stroke: PaintStroke; input: InkInput; session: PaintingSession; time: number; pressure: number } | null>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (gesture.current || recoveryRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const cancel = () => { gesture.current?.stroke.cancel(); gesture.current = null; epoch.current++; cancelAnimationFrame(frame.current); frame.current = 0; };
  useEffect(() => {
    if (recoveryRef.current) return;
    cancel(); let active = true; const generation = ++epoch.current;
    if (!painting) return;
    if (!painting.layers.some(l => l.id === layerId)) { setLayerId(painting.layers.at(-1)!.id); return; }
    const next = new PaintingSession(structuredClone(doc), structuredClone(painting), layerId); setBusy('Loading layers'); setError('');
    void next.initialize().then(async () => { if (!active) return; session.current = next; if (canvas.current) await next.preview(canvas.current, undefined, painting, () => active && epoch.current === generation); if (active) { setReadyKey(sourceKey); setBusy(''); } }).catch(e => { if (active) { setError(String(e)); setBusy(''); } });
    return () => { active = false; cancel(); session.current = null; };
  }, [painting ? paintSource(painting) : null, layerId, recovery]);
  useEffect(() => { const blur = () => { if (recoveryRef.current) return; cancel(); const s = session.current, generation = epoch.current; if (s && canvas.current) void s.preview(canvas.current, undefined, s.painting, () => epoch.current === generation).catch(e => setError(String(e))); }; window.addEventListener('blur', blur); return () => window.removeEventListener('blur', blur); }, []);
  if (!painting) return <div role="alert">Painting unavailable. <button onClick={onClose}>Return to editor</button></div>;
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
  const append = (e: { clientX: number; clientY: number; timeStamp: number; pressure: number }) => {
    const g = gesture.current, target = canvas.current; if (!g || !target) return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(painting.width - 1, (e.clientX - rect.left) / rect.width * painting.width)), y = Math.max(0, Math.min(painting.height - 1, (e.clientY - rect.top) / rect.height * painting.height));
    g.time = Math.max(g.time, e.timeStamp); if (e.pressure) g.pressure = e.pressure;
    const p = g.input.sample(x, y, g.time, g.pressure); g.stroke.append([p]);
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (unavailable || gesture.current || e.button !== 0 || !session.current) return;
    e.preventDefault(); setError('');
    try {
      const s = session.current, stroke = s.beginStroke(paintBrushPreset(preset, size, flow, color));
      gesture.current = { pointer: e.pointerId, stroke, session: s, input: new InkInput(e.pointerType === 'pen'), time: e.timeStamp, pressure: e.pointerType === 'pen' ? e.pressure : .5 };
      epoch.current++; append(e); e.currentTarget.setPointerCapture(e.pointerId); preview();
    } catch (error) { cancel(); setError(String(error)); }
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (gesture.current?.pointer !== e.pointerId) return;
    try { const events = e.nativeEvent.getCoalescedEvents?.() ?? []; for (const event of events.length ? events : [e.nativeEvent]) append(event); preview(); } catch (error) { cancel(); setError(String(error)); }
  };
  const up = async (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    try { append(e); } catch (error) { discard(); setError(String(error)); return; }
    gesture.current = null; epoch.current++; cancelAnimationFrame(frame.current); frame.current = 0;
    await accept(new PaintingRecovery(g.session, g.stroke));
  };
  const accept = async (pending: PaintingRecovery) => {
    recoveryRef.current = pending; setRecovery(pending); setReadyKey(''); setBusy('Uploading changes'); setError('');
    try {
      onCommit(pending.base, await pending.prepare());
      pending.discard(); recoveryRef.current = null; setRecovery(null);
    } catch (error) {
      setError(`Your local work is kept here. Retry, download a PNG backup, or discard it. ${String(error)}`);
      if (canvas.current) await pending.preview(canvas.current).catch(() => {});
    } finally { setBusy(''); }
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
      await accept(new PaintingRecovery(s, undefined, next));
    } catch (error) { setError(String(error)); }
  };
  return <dialog ref={dialog} className="creative-workspace paint-workspace" aria-label="Painting studio" onCancel={e => { e.preventDefault(); if (!busy && !recovery) { if (gesture.current) discard(); else onClose(); } }} onKeyDown={e => { e.stopPropagation(); if ((e.target as HTMLElement).matches('input,textarea,select')) return; if (e.key === 'Escape' && !busy && !recovery) { if (gesture.current) discard(); else onClose(); } }}>
    <header><div><span className="creative-eyebrow">DESIGN STUDIO / PAINT</span><h2>{painting.name}</h2></div><span className="creative-save-note">{busy || 'Stroke uploaded · Save project to persist layer changes'}</span><button disabled={!!busy || !!recovery || (!error && unavailable)} aria-label="Close painting studio" onClick={onClose}><X size={20}/></button></header>
    <div className="creative-main"><aside><label>Brush<select disabled={unavailable} aria-label="Paint brush" value={preset} onChange={e => setPreset(e.target.value)}><option value="bristle">Bristle</option><option value="dry">Dry brush</option><option value="wash">Watercolor wash</option><option value="smudge">Smudge</option><option value="erase">Eraser</option></select></label><label>Color<input aria-label="Paint color" type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>Size <b>{size}px</b><input aria-label="Paint size" type="range" min="2" max="128" value={size} onChange={e => setSize(+e.target.value)}/></label><label>Flow<input aria-label="Paint flow" type="range" min=".05" max="1" step=".05" value={flow} onChange={e => setFlow(+e.target.value)}/></label>
      <div className="paint-layers"><strong>Layers</strong><button aria-label="Add paint layer" disabled={unavailable || painting.layers.length >= 24} onClick={() => void settings(next => { const id = uid(); next.layers.push({ id, name: `Layer ${next.layers.length + 1}`, visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false, clipping: false, tiles: [] }); })}><Plus size={16}/></button>
        {[...painting.layers].reverse().map(layer => <div className="paint-layer" key={layer.id}><button aria-pressed={layerId === layer.id} disabled={unavailable} onClick={() => setLayerId(layer.id)}>{layer.name}</button><button aria-label={`Toggle ${layer.name} visibility`} disabled={unavailable} onClick={() => void settings(next => { next.layers.find(l => l.id === layer.id)!.visible = !layer.visible; })}><Eye size={15} opacity={layer.visible ? 1 : .3}/></button><button aria-label={`Toggle ${layer.name} lock`} disabled={unavailable} onClick={() => void settings(next => { next.layers.find(l => l.id === layer.id)!.locked = !layer.locked; })}><LockKeyhole size={15} opacity={layer.locked ? 1 : .3}/></button></div>)}
      </div><PaintLayerControls painting={painting} layerId={layerId} disabled={unavailable} onEdit={edit => void settings(edit)}/></aside><section className="creative-paper"><nav><button disabled={unavailable} aria-label="Undo painting" onClick={() => { cancel(); onUndo(); }}><Undo2 size={19}/></button><button disabled={unavailable} aria-label="Redo painting" onClick={() => { cancel(); onRedo(); }}><Redo2 size={19}/></button><span>{painting.width} × {painting.height}</span></nav>
      <div className="paint-canvas-wrap"><canvas ref={canvas} width={painting.width} height={painting.height} aria-busy={unavailable} style={{ aspectRatio: `${painting.width} / ${painting.height}` }} tabIndex={0} aria-label="Painting canvas" onPointerDown={down} onPointerMove={move} onPointerUp={e => void up(e)} onPointerCancel={discard} onLostPointerCapture={() => { if (gesture.current) discard(); }}/></div><footer role="status">{recovery && <div className="paint-recovery"><button disabled={!!busy} onClick={() => void accept(recovery)}>Retry changes</button><button disabled={!!busy} onClick={() => void backup()}>Download PNG backup</button><button disabled={!!busy} onClick={() => { recovery.discard(); recoveryRef.current = null; setRecovery(null); setError(''); discard(); }}>Discard local changes</button></div>}{error || busy || 'Bristle texture · Real color pickup · One stroke, one undo'}</footer>
    </section></div>
  </dialog>;
}
