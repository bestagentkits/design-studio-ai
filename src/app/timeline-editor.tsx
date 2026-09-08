import { useRef, useState } from 'react';
import type { DesignDocument, DesignNode, DesignPage, Timeline } from '../shared/schema';
import { easingSchema } from '../shared/design-capabilities';
import { interpolateNode } from '../shared/render';

type Selection = { trackId: string; time: number; property: string };
type Copied = Selection & { value: number | string; easing?: Timeline['tracks'][number]['keyframes'][number]['easing'] };
const same = (a: Selection, b: Selection) => a.trackId === b.trackId && a.time === b.time && a.property === b.property;
const properties = (node?: DesignNode) => ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'fontSize', 'borderRadius', 'strokeWidth', ...(node?.type === 'model3d' || node?.type === 'group' ? ['position', 'rotation', 'scale'].flatMap(p => ['x', 'y', 'z'].map(a => `scene.${p}.${a}`)) : []), ...(node?.scene?.bones ?? []).flatMap((_, i) => ['position', 'rotation'].flatMap(p => ['x', 'y', 'z'].map(a => `scene.bones.${i}.${p}.${a}`)))];
function propertyValue(node: DesignNode, property: string, page?: DesignPage): number | string {
  const transform = /^scene\.(position|rotation|scale)\.([xyz])$/.exec(property), bone = /^scene\.bones\.(\d+)\.(position|rotation)\.([xyz])$/.exec(property);
  if (transform) {
    const field = transform[1] as 'position' | 'rotation' | 'scale', axis = 'xyz'.indexOf(transform[2]);
    const fallback = field === 'scale' ? [node.width / 400, node.height / 400, Number(node.data?.depth ?? node.width) / 400] : field === 'rotation' ? [Number(node.data?.rotationX ?? 0), Number(node.data?.rotationY ?? 0), node.rotation ?? 0] : [(node.x + node.width / 2 - (page?.width ?? 0) / 2) / 240, ((page?.height ?? 0) / 2 - node.y - node.height / 2) / 240, Number(node.data?.z ?? 0)];
    return node.scene?.[field]?.[axis] ?? fallback[axis];
  }
  if (bone) return node.scene?.bones?.[+bone[1]]?.[bone[2] as 'position' | 'rotation']?.['xyz'.indexOf(bone[3])] ?? 0;
  const value = (node as unknown as Record<string, unknown>)[property] ?? node.style?.[property];
  return typeof value === 'number' || typeof value === 'string' ? value : property === 'opacity' ? 1 : ['fill', 'stroke'].includes(property) ? '#000000' : 0;
}

/** Moves property keys atomically; collisions never silently replace animation. */
export function moveTimelineKeys(timeline: Timeline, selected: Selection[], destination: (time: number) => number): Timeline {
  const result = structuredClone(timeline), moving: Copied[] = [];
  for (const item of selected) {
    const track = result.tracks.find(t => t.id === item.trackId), key = track?.keyframes.find(k => k.time === item.time);
    if (!track || track.locked || !key || !(item.property in key.values)) continue;
    moving.push({ ...item, value: key.values[item.property], easing: key.easing }); delete key.values[item.property];
  }
  for (const item of moving) {
    const at = destination(item.time);
    if (!Number.isFinite(at) || at < 0 || at > timeline.duration) throw new Error('Keyframes must stay within the timeline.');
    const track = result.tracks.find(t => t.id === item.trackId)!;
    let key = track.keyframes.find(k => k.time === at);
    if (key && item.property in key.values) throw new Error('A keyframe already exists at that time for this property.');
    if (key && Object.keys(key.values).length && JSON.stringify(key.easing ?? 'linear') !== JSON.stringify(item.easing ?? 'linear')) throw new Error('Properties sharing a timestamp must use the same easing.');
    if (!key) { key = { time: at, values: {}, easing: item.easing }; track.keyframes.push(key); }
    if (!Object.keys(key.values).length) key.easing = item.easing;
    key.values[item.property] = item.value;
  }
  for (const track of result.tracks) track.keyframes = track.keyframes.filter(k => Object.keys(k.values).length).sort((a, b) => a.time - b.time);
  return result;
}

export function TimelineEditor({ doc, time, seek, change }: { doc: DesignDocument; time: number; seek: (time: number) => void; change: (fn: (doc: DesignDocument) => void) => void }) {
  const [selected, select] = useState<Selection[]>([]), [zoom, setZoom] = useState(1), [clipboard, setClipboard] = useState<Copied[]>([]), [snap, setSnap] = useState(true), [speed, setSpeed] = useState(2), [error, setError] = useState('');
  const [nodeId, setNode] = useState(''), [property, setProperty] = useState('x');
  const dragged = useRef(false), timeline = doc.timeline, nodes = doc.pages.flatMap(p => p.nodes), target = nodes.find(n => n.id === nodeId) ?? nodes[0];
  if (!timeline) return null;
  const atTime = (at: number) => Math.max(0, Math.min(timeline.duration, snap ? Math.round(at * timeline.fps) / timeline.fps : at));
  const live = selected.filter(s => timeline.tracks.some(t => t.id === s.trackId && t.keyframes.some(k => k.time === s.time && s.property in k.values)));
  const editable = live.filter(s => !timeline.tracks.find(t => t.id === s.trackId)?.locked), first = live[0], track = timeline.tracks.find(t => t.id === first?.trackId), key = track?.keyframes.find(k => k.time === first?.time);
  const updateKeys = (fn: (at: number) => number, chosen = editable) => {
    try { const result = moveTimelineKeys(timeline, chosen, fn); change(d => { d.timeline = result; }); select(chosen.map(s => ({ ...s, time: fn(s.time) }))); setError(''); } catch (e) { setError((e as Error).message); }
  };
  const remove = () => { change(d => { for (const s of editable) { const t = d.timeline!.tracks.find(t => t.id === s.trackId)!; const k = t.keyframes.find(k => k.time === s.time); if (k) delete k.values[s.property]; t.keyframes = t.keyframes.filter(k => Object.keys(k.values).length); } }); select([]); };
  const copy = () => setClipboard(live.map(s => { const k = timeline.tracks.find(t => t.id === s.trackId)!.keyframes.find(k => k.time === s.time)!; return { ...s, value: k.values[s.property], easing: k.easing }; }));
  const paste = () => {
    const result = structuredClone(timeline), start = Math.min(...clipboard.map(k => k.time)), inserted: Selection[] = [];
    try { for (const item of clipboard) {
      const t = result.tracks.find(t => t.id === item.trackId), at = atTime(time) + item.time - start;
      if (!t || t.locked) throw new Error('Copied tracks must exist and be unlocked.');
      if (at > timeline.duration) throw new Error('Copied keys extend past the timeline.');
      let k = t.keyframes.find(k => k.time === at);
      if (k && item.property in k.values) throw new Error('A copied property already has a keyframe at the destination.');
      if (k && JSON.stringify(k.easing ?? 'linear') !== JSON.stringify(item.easing ?? 'linear')) throw new Error('Properties sharing a timestamp must use the same easing.');
      if (!k) { k = { time: at, values: {}, easing: item.easing }; t.keyframes.push(k); }
      k.values[item.property] = item.value; t.keyframes.sort((a, b) => a.time - b.time); inserted.push({ ...item, time: at });
    } change(d => { d.timeline = result; }); select(inserted); setError(''); } catch (e) { setError((e as Error).message); }
  };
  const add = () => {
    if (!target) return;
    const current = timeline.tracks.find(t => t.nodeId === target.id), at = atTime(time);
    if (current?.locked) { setError('Unlock this track before adding keyframes.'); return; }
    const id = current?.id ?? crypto.randomUUID();
    change(d => { let t = d.timeline!.tracks.find(t => t.id === id); if (!t) { t = { id, nodeId: target.id, keyframes: [] }; d.timeline!.tracks.push(t); } let k = t.keyframes.find(k => k.time === at); if (!k) { k = { time: at, values: {} }; t.keyframes.push(k); } k.values[property] = propertyValue(interpolateNode(target, doc, at), property, doc.pages.find(p => p.nodes.some(n => n.id === target.id))); t.keyframes.sort((a, b) => a.time - b.time); });
    select([{ trackId: id, time: at, property }]); setError('');
  };
  return <section className="motion-editor" aria-label="Animation timeline" tabIndex={0} onKeyDown={e => {
    if ((e.target as HTMLElement).matches('input,select,textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(); }
    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); if (e.key.toLowerCase() === 'a') select(timeline.tracks.flatMap(t => t.keyframes.flatMap(k => Object.keys(k.values).map(property => ({ trackId: t.id, time: k.time, property }))))); else if (e.key.toLowerCase() === 'c') copy(); else if (clipboard.length) paste(); }
  }}>
    <div className="motion-toolbar"><strong>Animation tracks</strong><label>Layer <select aria-label="Animation layer" value={target?.id ?? ''} onChange={e => { setNode(e.target.value); setProperty('x'); }}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label>Property <select aria-label="Animation property" value={property} onChange={e => setProperty(e.target.value)}>{properties(target).map(p => <option key={p}>{p}</option>)}</select></label><button disabled={!target} onClick={add}>Add property keyframe</button>
      <label>Zoom <input aria-label="Timeline zoom" type="range" min="1" max="8" step=".5" value={zoom} onChange={e => setZoom(+e.target.value)} /></label><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>Snap to frames</label>
      <button disabled={!live.length} onClick={copy}>Copy keyframes</button><button disabled={!clipboard.length} onClick={paste}>Paste at playhead</button><button disabled={!editable.length} onClick={remove}>Delete selected keys</button>
      <label>Speed <input aria-label="Keyframe speed" type="number" min=".1" max="10" step=".1" value={speed} onChange={e => setSpeed(+e.target.value)}/></label><button disabled={editable.length < 2 || !Number.isFinite(speed) || speed < .1 || speed > 10} onClick={() => { const start = Math.min(...editable.map(s => s.time)); updateKeys(at => atTime(start + (at - start) / speed)); }}>Retime selection</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {key && track && first && <div className="motion-toolbar"><span>{live.length} selected</span><label>Keyframe time <input aria-label="Keyframe time" type="number" step={1 / timeline.fps} min={0} max={timeline.duration} value={key.time} disabled={track.locked} onChange={e => { const delta = atTime(+e.target.value) - key.time; updateKeys(at => at + delta); }} /></label>
      <label>Easing <select aria-label="Keyframe easing" value={Array.isArray(key.easing) ? 'custom' : key.easing ?? 'linear'} disabled={track.locked} onChange={e => { const easing = easingSchema.parse(e.target.value === 'custom' ? [.25, .1, .25, 1] : e.target.value); change(d => { for (const s of editable) d.timeline!.tracks.find(t => t.id === s.trackId)!.keyframes.find(k => k.time === s.time)!.easing = easing; }); }}>{['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'spring', 'step', 'custom'].map(value => <option key={value}>{value}</option>)}</select></label>
      {Array.isArray(key.easing) && key.easing.map((value, index) => <label key={index}>{['X1', 'Y1', 'X2', 'Y2'][index]}<input aria-label={`Bezier ${['X1', 'Y1', 'X2', 'Y2'][index]}`} disabled={track.locked} type="number" step=".05" min={index % 2 ? -5 : 0} max={index % 2 ? 5 : 1} value={value} onChange={e => { const next = [...key.easing as number[]]; next[index] = +e.target.value; const valid = easingSchema.safeParse(next); if (valid.success) change(d => { d.timeline!.tracks.find(t => t.id === track.id)!.keyframes.find(k => k.time === key.time)!.easing = valid.data; }); }}/></label>)}
      <label>{first.property}<input aria-label={`Keyframe ${first.property}`} type={typeof key.values[first.property] === 'number' ? 'number' : 'text'} value={key.values[first.property]} disabled={track.locked} onChange={e => { const value = typeof key.values[first.property] === 'number' ? +e.target.value : e.target.value; if (typeof value === 'number' && !Number.isFinite(value)) return; change(d => { d.timeline!.tracks.find(t => t.id === track.id)!.keyframes.find(k => k.time === key.time)!.values[first.property] = value; }); }}/></label><small>Easing applies to all properties at the same track time. Shift-click selects multiple keys; arrows move one frame.</small>
    </div>}
    <div className="motion-scroll"><div style={{ minWidth: `${zoom * 100}%` }}><div className="motion-ruler"><span>Layers / properties</span><div>{Array.from({ length: 11 }, (_, i) => <span key={i} style={{ left: `${i * 10}%` }}>{(timeline.duration * i / 10).toFixed(1)}s</span>)}</div></div>
      {timeline.tracks.map(t => { const node = nodes.find(n => n.id === t.nodeId), rows = [...new Set(t.keyframes.flatMap(k => Object.keys(k.values)))]; return <div key={t.id}>
        <div className="motion-toolbar"><button onClick={() => change(d => { d.timeline!.tracks.find(x => x.id === t.id)!.muted = !t.muted; })} aria-label={`Mute ${node?.name}`} aria-pressed={!!t.muted}>{t.muted ? 'Unmute' : 'Mute'}</button><button onClick={() => change(d => { d.timeline!.tracks.find(x => x.id === t.id)!.locked = !t.locked; })} aria-label={`Lock ${node?.name}`} aria-pressed={!!t.locked}>{t.locked ? 'Unlock' : 'Lock'}</button><strong>{node?.name}</strong><button disabled={t.locked} onClick={() => change(d => { d.timeline!.tracks = d.timeline!.tracks.filter(x => x.id !== t.id); })}>Delete track</button></div>
        {rows.map(p => <div className="motion-track" key={p}><div><small>{p}</small></div><div className="motion-lane" onPointerDown={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); seek(atTime((e.clientX - box.left) / box.width * timeline.duration)); } }}><i className="motion-playhead" style={{ left: `${time / timeline.duration * 100}%` }}/>
          {t.keyframes.filter(k => p in k.values).map(k => { const item = { trackId: t.id, time: k.time, property: p }; return <button key={k.time} aria-label={`${node?.name} ${p} keyframe ${k.time}`} aria-pressed={live.some(s => same(s, item))} className={live.some(s => same(s, item)) ? 'active' : ''} style={{ left: `${k.time / timeline.duration * 100}%` }} onClick={e => { if (dragged.current) { dragged.current = false; return; } select(e.shiftKey ? live.some(s => same(s, item)) ? live.filter(s => !same(s, item)) : [...live, item] : [item]); seek(k.time); }}
            onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (t.locked) return; const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / timeline.fps; updateKeys(at => at + delta, live.some(s => same(s, item)) ? editable : [item]); } }}
            onPointerDown={e => { if (t.locked) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.startX = String(e.clientX); dragged.current = false; }} onPointerCancel={e => { delete e.currentTarget.dataset.startX; }}
            onPointerUp={e => { const start = e.currentTarget.dataset.startX; delete e.currentTarget.dataset.startX; if (start === undefined || t.locked || Math.abs(e.clientX - +start) < 3) return; dragged.current = true; const width = e.currentTarget.parentElement!.getBoundingClientRect().width, delta = atTime(k.time + (e.clientX - +start) / width * timeline.duration) - k.time; updateKeys(at => at + delta, live.some(s => same(s, item)) ? editable : [item]); }}>◆</button>; })}
        </div></div>)}
      </div>; })}
      {!timeline.tracks.length && <p>Select a layer and property above to start animating.</p>}
    </div></div>
  </section>;
}
