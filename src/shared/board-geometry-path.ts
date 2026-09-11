import { finiteRange, segmentDistance, validateBoardCamera, validateBoardPoint, worldToScreen } from './board-geometry';
import type { BoardCamera, BoardPoint } from './board-geometry';
export type BoardCubicSegment = { control1: BoardPoint; control2: BoardPoint; end: BoardPoint };
export type BoardCubicPath = { start: BoardPoint; segments: BoardCubicSegment[]; closed?: boolean };
function validate(path: BoardCubicPath): void {
  validateBoardPoint(path.start);
  if (!Array.isArray(path.segments) || path.segments.length > 256) throw new RangeError('Invalid curve segment count');
  for (const segment of path.segments) { validateBoardPoint(segment.control1); validateBoardPoint(segment.control2); validateBoardPoint(segment.end); }
}
const pair = (p: BoardPoint) => `${p.x} ${p.y}`;
export function cubicPathToSvg(path: BoardCubicPath): string {
  validate(path);
  return `M ${pair(path.start)}${path.segments.map(s => ` C ${pair(s.control1)} ${pair(s.control2)} ${pair(s.end)}`).join('')}${path.closed ? ' Z' : ''}`;
}
function sample(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function extrema(a: number, b: number, c: number, d: number): number[] {
  const A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a;
  if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / B];
  const discriminant = B * B - 4 * A * C;
  return discriminant < 0 ? [] : [(-B + Math.sqrt(discriminant)) / (2 * A), (-B - Math.sqrt(discriminant)) / (2 * A)];
}
export function cubicPathBounds(path: BoardCubicPath): { x: number; y: number; width: number; height: number } {
  validate(path);
  const xs = [path.start.x], ys = [path.start.y];
  let start = path.start;
  for (const s of path.segments) {
    for (const [axis, values] of [['x', xs], ['y', ys]] as const) {
      values.push(s.end[axis]);
      for (const t of extrema(start[axis], s.control1[axis], s.control2[axis], s.end[axis]))
        if (t > 0 && t < 1) values.push(sample(start[axis], s.control1[axis], s.control2[axis], s.end[axis], t));
    }
    start = s.end;
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
const midpoint = (a: BoardPoint, b: BoardPoint): BoardPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Adaptive subdivision bounds chord error by control-point distance, including loops. */
export function flattenCubicPath(path: BoardCubicPath, tolerance = .25): BoardPoint[] {
  validate(path); finiteRange(tolerance, .00001, 10_000, 'curve tolerance');
  const points = [path.start];
  function flatten(a: BoardPoint, b: BoardPoint, c: BoardPoint, d: BoardPoint, depth: number): void {
    if (points.length >= 16_384) throw new RangeError('Curve subdivision budget exceeded');
    if (Math.max(segmentDistance(b, a, d), segmentDistance(c, a, d)) <= tolerance) { points.push(d); return; }
    if (depth === 24) throw new RangeError('Curve precision budget exceeded');
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd);
    flatten(a, ab, abc, middle, depth + 1); flatten(middle, bcd, cd, d, depth + 1);
  }
  let start = path.start;
  for (const s of path.segments) { flatten(start, s.control1, s.control2, s.end, 0); start = s.end; }
  if (path.closed) points.push(path.start);
  return points;
}
/** Screen point and tolerance are pixels; stroke width is world units. Round cap/join semantics. */
export function hitTestCubicPath(path: BoardCubicPath, screen: BoardPoint, camera: BoardCamera, width: number, tolerance = 4): boolean {
  validateBoardCamera(camera);
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) throw new RangeError('Invalid screen point');
  finiteRange(width, .001, 10_000, 'stroke width'); finiteRange(tolerance, 0, 100, 'hit tolerance');
  const points = flattenCubicPath(path, .1 / camera.zoom).map(p => worldToScreen(p, camera));
  if (!path.segments.length) return false;
  const radius = width * camera.zoom / 2 + tolerance;
  return points.some((p, i) => i > 0 && segmentDistance(screen, points[i - 1], p) <= radius);
}
