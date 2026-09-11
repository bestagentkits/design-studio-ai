export interface PaintingSelection { kind: 'rectangle' | 'lasso'; points: { x: number; y: number }[]; feather: number }
export function validatePaintingSelection(selection: PaintingSelection) {
  if (!['rectangle', 'lasso'].includes(selection.kind) || !Number.isFinite(selection.feather) || selection.feather < 0 || selection.feather > 128 || selection.points.length < (selection.kind === 'rectangle' ? 2 : 3) || selection.points.length > 2048 || selection.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid painting selection');
}
/** Feather lies inside the selection so protected pixels outside it remain untouched. */
export function selectionCoverage(selection: PaintingSelection | undefined, x: number, y: number): number {
  if (!selection) return 1;
  const points = selection.kind === 'rectangle' ? (() => { const [a, b] = selection.points; return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]; })() : selection.points;
  let inside = false, distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return inside ? selection.feather ? Math.min(1, distance / selection.feather) : 1 : 0;
}
