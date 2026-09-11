import { inkStrokeToSvg, InkInput, type InkSample } from '../src/shared/ink-stroke';
import { PaintRuntime } from '../src/shared/paint-runtime';
import type { PaintStroke } from '../src/shared/paint-stroke';
import { mountGifProbe } from './board-gif-probe';
import { mountProbeShell } from './board-probe-shell';
import { paintPreview, probeBrush } from './board-paint-preview';

// Local quality lab. Public Studio persistence and the canonical editor remain separate work.
const host = document.getElementById('probe')!; mountProbeShell(host);
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = element('surface'), marks = document.getElementById('marks')!, preview = document.getElementById('preview')!;
const status = element('status'), canvas = host.querySelector('canvas')!, cursor = document.getElementById('cursor')!;
const input = (id: string) => element<HTMLInputElement>(id);
let paint = new PaintRuntime(512, 512, 8); paint.addLayer('base'); paint.addLayer('ink');
let mode: 'draw' | 'paint' = 'draw', active: number | undefined, points: InkSample[] = [], sampler: InkInput;
const toolSizes = { draw: 16, paint: 40 };
let activeType = '';
let stroke: PaintStroke | undefined, frame = 0, strokeLayer = '', before: Snapshot | undefined;
const touches = new Set<number>();
type Snapshot = { paint: PaintRuntime; paths: string[] };
const past: Snapshot[] = [], future: Snapshot[] = [];
const snapshot = (): Snapshot => ({ paint: paint.fork(), paths: [...marks.children].map(path => path.outerHTML) });
const buttons = () => { element<HTMLButtonElement>('undo').disabled = !past.length; element<HTMLButtonElement>('redo').disabled = !future.length; };
function restore(state: Snapshot) { paint = state.paint.fork(); marks.innerHTML = state.paths.join(''); paintPreview(canvas, paint); syncLayer(); }
function record(state: Snapshot) { past.push(state); if (past.length > 16) past.shift(); future.length = 0; buttons(); }
function clear() {
  cancelAnimationFrame(frame); frame = 0;
  const pointer = active; active = undefined;
  if (pointer !== undefined && surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
  points = []; stroke = undefined; before = undefined; preview.removeAttribute('d');
}
function cancel() { stroke?.cancel(); clear(); paintPreview(canvas, paint); status.textContent = 'Gesture cancelled'; }
function render() {
  frame = 0;
  if (active === undefined) return;
  if (mode === 'paint' && stroke) paintPreview(canvas, paint, { layer: strokeLayer, stroke });
  else { preview.setAttribute('fill', input('color').value); preview.setAttribute('d', inkStrokeToSvg(points, +input('size').value, false)); }
}
function schedule() { if (!frame) frame = requestAnimationFrame(render); }
function select(tool: 'draw' | 'paint') {
  cancel(); toolSizes[mode] = +input('size').value; mode = tool;
  input('size').value = String(toolSizes[mode]); element('size-value').textContent = `${toolSizes[mode]} px`;
  element('draw').setAttribute('aria-pressed', String(tool === 'draw')); element('paint').setAttribute('aria-pressed', String(tool === 'paint'));
  status.textContent = tool === 'draw' ? 'Draw · speed-sensitive ink' : 'Paint · live brush';
}
element('draw').onclick = () => select('draw'); element('paint').onclick = () => select('paint');
function undo(redo = false) {
  cancel(); const source = redo ? future : past, target = redo ? past : future;
  const state = source.pop(); if (!state) return;
  target.push(snapshot()); restore(state); buttons(); status.textContent = redo ? 'Stroke restored' : 'Stroke undone';
}
element('undo').onclick = () => undo(); element('redo').onclick = () => undo(true);
function coordinates(event: PointerEvent) {
  const rect = surface.getBoundingClientRect();
  return { x: Math.max(0, Math.min(511, (event.clientX - rect.left) * 512 / rect.width)), y: Math.max(0, Math.min(511, (event.clientY - rect.top) * 512 / rect.height)) };
}
function sample(event: PointerEvent, release = false) {
  const p = coordinates(event), previous = points.at(-1);
  const pressure = release && previous ? previous.pressure : event.pointerType === 'pen' ? event.pressure : .5;
  return sampler.sample(p.x, p.y, Math.max(previous?.time ?? 0, event.timeStamp), pressure);
}
function append(event: PointerEvent, release = false) {
  if (points.length >= 4095 && !release) throw new Error('Stroke too long; nothing committed');
  const p = sample(event, release); points.push(p); stroke?.append([p]);
}
surface.onpointerdown = event => {
  if (event.pointerType === 'touch') touches.add(event.pointerId);
  if (active !== undefined) { if (activeType === 'touch' && event.pointerType === 'touch') cancel(); return; }
  if ((event.pointerType === 'touch' && touches.size > 1) || event.button !== 0) return;
  try {
    before = snapshot(); sampler = new InkInput(event.pointerType === 'pen');
    if (mode === 'paint') { strokeLayer = input('layer').value; stroke = paint.beginStroke(strokeLayer, probeBrush(input('preset').value, +input('size').value, +input('flow').value / 100, input('color').value)); }
    active = event.pointerId; activeType = event.pointerType; surface.setPointerCapture(event.pointerId); surface.focus({ preventScroll: true });
    append(event); schedule(); status.textContent = mode === 'paint' ? 'Painting…' : 'Drawing…';
  } catch (error) { cancel(); status.textContent = (error as Error).message; }
};
surface.onpointermove = event => {
  const p = coordinates(event); cursor.setAttribute('cx', String(p.x)); cursor.setAttribute('cy', String(p.y)); cursor.setAttribute('r', String(+input('size').value / 2)); cursor.setAttribute('style', 'display:block');
  if (event.pointerId !== active) return;
  try { const samples = event.getCoalescedEvents?.() ?? []; for (const e of samples.length ? samples : [event]) append(e); schedule(); }
  catch (error) { cancel(); status.textContent = (error as Error).message; }
};
surface.onpointerleave = () => cursor.setAttribute('style', 'display:none');
surface.onpointerup = event => {
  touches.delete(event.pointerId); if (event.pointerId !== active) return;
  try {
    const p = coordinates(event), last = points.at(-1)!;
    if (p.x !== last.x || p.y !== last.y) append(event, true);
    if (mode === 'paint') { stroke!.commit(); paintPreview(canvas, paint); status.textContent = 'Paint committed · local draft'; }
    else { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', inkStrokeToSvg(points, +input('size').value)); path.setAttribute('fill', input('color').value); marks.appendChild(path); status.textContent = `${marks.children.length} vector strokes · local draft`; }
    record(before!); clear();
  } catch (error) { cancel(); status.textContent = (error as Error).message; }
};
surface.onpointercancel = event => { touches.delete(event.pointerId); if (event.pointerId === active) cancel(); };
surface.onlostpointercapture = event => { if (event.pointerId === active) cancel(); };
window.addEventListener('blur', () => { touches.clear(); cancel(); });
surface.onkeydown = event => {
  if (event.key === 'Escape') cancel();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); }
};
function syncLayer() { const layer = paint.layerSettings.find(layer => layer.id === input('layer').value)!; input('visible').checked = layer.visible; input('locked').checked = layer.locked; }
for (const id of ['size', 'flow', 'color']) input(id).oninput = () => {
  cancel(); element('size-value').textContent = `${input('size').value} px`; element('flow-value').textContent = `${input('flow').value}%`;
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === input('color').value));
};
for (const button of host.querySelectorAll<HTMLButtonElement>('[data-color]')) button.onclick = () => { input('color').value = button.dataset.color!; input('color').dispatchEvent(new Event('input')); };
input('preset').onchange = () => { select('paint'); input('size').value = '40'; element('size-value').textContent = '40 px'; };
input('layer').onchange = () => { cancel(); syncLayer(); };
for (const id of ['visible', 'locked']) input(id).onchange = () => { cancel(); const state = snapshot(); paint.configureLayer(input('layer').value, { [id]: input(id).checked }); record(state); paintPreview(canvas, paint); };
mountGifProbe(element('gif-host'), surface);
