import { finiteRange, segmentDistance, validateBoardCamera, validateBoardPoint, worldToScreen } from './board-geometry';
import type { BoardCamera, BoardPoint } from './board-geometry';
export type BoardPressurePoint = BoardPoint & { pressure: number };
/** Probe ink model: 10% minimum diameter, linear pressure response, round joins/caps. */
export function pressureRadius(pressure: number, width: number): number {
  finiteRange(pressure, 0, 1, 'pressure'); finiteRange(width, .001, 10_000, 'stroke width');
  return width * (.1 + .9 * pressure) / 2;
}
function validate(points: BoardPressurePoint[], width: number): void {
  finiteRange(width, .001, 10_000, 'stroke width');
  if (!Array.isArray(points) || points.length < 1 || points.length > 4096) throw new RangeError('Invalid pressure sample count');
  for (const p of points) { validateBoardPoint(p); pressureRadius(p.pressure, width); }
}
function quad(a: BoardPoint, b: BoardPoint, ar: number, br: number): BoardPoint[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return [];
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  return [{ x: a.x + nx * ar, y: a.y + ny * ar }, { x: a.x - nx * ar, y: a.y - ny * ar },
    { x: b.x - nx * br, y: b.y - ny * br }, { x: b.x + nx * br, y: b.y + ny * br }];
}
/** A union of consistently wound round discs and tapered quads, filled with SVG's nonzero rule. */
export function pressureStrokeToSvg(points: BoardPressurePoint[], width: number): string {
  validate(points, width);
  const paths: string[] = [];
  points.forEach((p, i) => {
    const radius = pressureRadius(p.pressure, width);
    paths.push(`M ${p.x + radius} ${p.y} A ${radius} ${radius} 0 1 1 ${p.x - radius} ${p.y} A ${radius} ${radius} 0 1 1 ${p.x + radius} ${p.y} Z`);
    if (i) {
      const polygon = quad(points[i - 1], p, pressureRadius(points[i - 1].pressure, width), radius);
      if (polygon.length) paths.push(`M ${polygon.map(v => `${v.x} ${v.y}`).join(' L ')} Z`);
    }
  });
  return paths.join(' ');
}
function polygonHit(p: BoardPoint, polygon: BoardPoint[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (segmentDistance(p, a, b) <= tolerance) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function hitTestPressureStroke(points: BoardPressurePoint[], screen: BoardPoint, camera: BoardCamera, width: number, tolerance = 4): boolean {
  validate(points, width); validateBoardCamera(camera); finiteRange(tolerance, 0, 100, 'hit tolerance');
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) throw new RangeError('Invalid screen point');
  const screenPoints = points.map(p => worldToScreen(p, camera));
  return screenPoints.some((p, i) => {
    const radius = pressureRadius(points[i].pressure, width) * camera.zoom;
    if (Math.hypot(screen.x - p.x, screen.y - p.y) <= radius + tolerance) return true;
    return i > 0 && polygonHit(screen, quad(screenPoints[i - 1], p,
      pressureRadius(points[i - 1].pressure, width) * camera.zoom, radius), tolerance);
  });
}
