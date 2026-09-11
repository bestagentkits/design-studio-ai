import rough from 'roughjs';
import type { BoardElement } from './board-schema';
const generator = rough.generator();
const escape = (s: string) => s.replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]!));
export function strokeDash(e: { strokeStyle?: string; strokeWidth: number }): string {
  return e.strokeStyle === 'dashed' ? `stroke-dasharray="${e.strokeWidth * 4} ${e.strokeWidth * 3}"` : e.strokeStyle === 'dotted' ? `stroke-dasharray="${e.strokeWidth / 2} ${e.strokeWidth * 3}"` : '';
}
/** One seeded geometry source for SVG/Canvas consumers, including clean and hatched shapes. */
export function sketchPath(e: Extract<BoardElement, {type:'shape'|'frame'|'connector'}>, d: string, filled = true): string {
  const drawable = generator.path(d, { seed: e.seed || 1, roughness: e.roughness, bowing: e.bowing, stroke: e.stroke, strokeWidth: e.strokeWidth,
    fill: filled && !['none','transparent'].includes(e.fill) ? e.fill : undefined, fillStyle: e.fillStyle, hachureAngle: e.hachureAngle,
    hachureGap: e.hachureGap, fillWeight: Math.max(.5, e.strokeWidth * .6), disableMultiStroke: !e.roughness, preserveVertices: true });
  return generator.toPaths(drawable).map((p,i) => `<path d="${p.d}" stroke="${escape(p.stroke)}" stroke-width="${p.strokeWidth}" fill="${escape(p.fill ?? 'none')}" opacity="${drawable.sets[i].type === 'path' ? 1 : e.fillOpacity}" stroke-linecap="round" stroke-linejoin="round" ${drawable.sets[i].type === 'path' ? strokeDash(e) : ''}/>`).join('');
}
export function boardShapeSvg(e: Extract<BoardElement, {type:'shape'|'frame'}>): string {
  const w=e.width,h=e.height, role=e.diagram?.role;
  let d: string;
  if (role === 'database') {
    const r=Math.min(16,h/5);
    d=`M 0 ${r} A ${w/2} ${r} 0 0 1 ${w} ${r} L ${w} ${h-r} A ${w/2} ${r} 0 0 1 0 ${h-r} Z`;
    return sketchPath(e,d)+sketchPath(e,`M 0 ${r} A ${w/2} ${r} 0 0 0 ${w} ${r}`,false);
  }
  if(e.type==='shape' && e.shape==='ellipse') d=`M 0 ${h/2} A ${w/2} ${h/2} 0 1 0 ${w} ${h/2} A ${w/2} ${h/2} 0 1 0 0 ${h/2} Z`;
  else if(e.type==='shape' && e.shape==='diamond') d=`M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`;
  else if(e.type==='shape' && e.shape==='triangle') d=`M ${w/2} 0 L ${w} ${h} L 0 ${h} Z`;
  else { const r=Math.min(e.type==='shape'?e.radius:0,w/2,h/2); d=`M ${r} 0 H ${w-r} Q ${w} 0 ${w} ${r} V ${h-r} Q ${w} ${h} ${w-r} ${h} H ${r} Q 0 ${h} 0 ${h-r} V ${r} Q 0 0 ${r} 0 Z`; }
  return sketchPath(e,d);
}
// Kept as an empty overlay for source compatibility; shapes now render once, not as jittered doubles.
export function boardSketchOutline(_e: BoardElement): string { return ''; }
