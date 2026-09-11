import type { BoardElement } from './board-schema';
/** Seeded outline roughness remains deterministic in editor, server SVG and exports. */
export function boardSketchOutline(e: BoardElement): string {
  if (!('roughness' in e) || !e.roughness || !['shape', 'frame'].includes(e.type)) return '';
  let seed = e.seed >>> 0;
  const jitter = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296 - .5) * e.roughness * 2; };
  const points: { x: number; y: number }[] = [];
  if (e.type === 'shape' && e.shape === 'ellipse') for (let i = 0; i <= 32; i++) { const t = i / 32 * Math.PI * 2; points.push({ x: e.width / 2 + Math.cos(t) * e.width / 2, y: e.height / 2 + Math.sin(t) * e.height / 2 }); }
  else if (e.type === 'shape' && e.shape === 'diamond') points.push({ x: e.width / 2, y: 0 }, { x: e.width, y: e.height / 2 }, { x: e.width / 2, y: e.height }, { x: 0, y: e.height / 2 }, { x: e.width / 2, y: 0 });
  else if (e.type === 'shape' && e.shape === 'triangle') points.push({ x: e.width / 2, y: 0 }, { x: e.width, y: e.height }, { x: 0, y: e.height }, { x: e.width / 2, y: 0 });
  else points.push({ x: 0, y: 0 }, { x: e.width, y: 0 }, { x: e.width, y: e.height }, { x: 0, y: e.height }, { x: 0, y: 0 });
  return [0, 1].map(() => `<path d="${points.map((p, i) => `${i ? 'L' : 'M'} ${p.x + jitter()} ${p.y + jitter()}`).join(' ')}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth * .6}" stroke-linejoin="round" opacity=".65"/>`).join('');
}
