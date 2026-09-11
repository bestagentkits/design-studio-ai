import { getStroke } from 'perfect-freehand';
import { finiteRange, segmentDistance, validateBoardPoint } from './board-geometry';
import type { BoardPressurePoint } from './board-geometry-stroke';

export interface InkSample extends BoardPressurePoint { time: number }
/** Timestamp-based pressure keeps mouse strokes independent of pointer-event sampling rate. */
export class InkInput {
  private previous?: InkSample;
  private speed = 0;
  private pressure = .72;
  constructor(private readonly pen: boolean) {}
  sample(x: number, y: number, time: number, pressure: number): InkSample {
    validateBoardPoint({ x, y }); finiteRange(time, 0, Number.MAX_SAFE_INTEGER, 'sample time');
    finiteRange(pressure, 0, 1, 'pressure');
    if (this.previous && time < this.previous.time) throw new RangeError('Ink sample time must not go backwards');
    if (this.pen) this.pressure = pressure;
    else if (this.previous) {
      const distance = Math.hypot(x - this.previous.x, y - this.previous.y);
      const dt = Math.max(.25, time - this.previous.time);
      const response = 1 - Math.exp(-dt / 24);
      this.speed += (Math.min(8, distance / dt) - this.speed) * response;
      const target = .18 + .68 / (1 + Math.pow(this.speed / .55, 1.5));
      this.pressure += (target - this.pressure) * (1 - Math.exp(-dt / 18));
    }
    this.previous = { x, y, time, pressure: this.pressure };
    return { ...this.previous };
  }
}

export function inkOutline(points: readonly BoardPressurePoint[], width: number, complete = true): number[][] {
  finiteRange(width, .1, 256, 'ink width');
  if (!points.length || points.length > 4096) throw new RangeError('Invalid ink point count');
  for (const p of points) { validateBoardPoint(p); finiteRange(p.pressure, 0, 1, 'pressure'); }
  return getStroke(points.map(p => [p.x, p.y, p.pressure]), {
    size: width, thinning: .8, smoothing: .65, streamline: .28, simulatePressure: false, last: complete,
    start: { cap: true, taper: points.length > 3 ? width * .6 : 0 },
    end: { cap: true, taper: complete && points.length > 3 ? width * 1.2 : 0 },
  });
}
/** Quadratic midpoint interpolation yields a smooth closed outline without polygon corners. */
export function inkStrokeToSvg(points: readonly BoardPressurePoint[], width: number, complete = true): string {
  const outline = inkOutline(points, width, complete);
  if (outline.length < 3) return '';
  const mid = (a: number[], b: number[]) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`;
  let path = `M ${mid(outline.at(-1)!, outline[0])}`;
  for (let i = 0; i < outline.length; i++) path += ` Q ${outline[i][0]} ${outline[i][1]} ${mid(outline[i], outline[(i + 1) % outline.length])}`;
  return `${path} Z`;
}
export function hitTestInk(points: readonly BoardPressurePoint[], width: number, x: number, y: number, tolerance = 4): boolean {
  validateBoardPoint({ x, y }); finiteRange(tolerance, 0, 100, 'hit tolerance');
  const outline = inkOutline(points, width);
  // Flatten the same quadratic outline as SVG, with bounded subdivisions for distant coordinates.
  const polygon: number[][] = [];
  for (let i = 0; i < outline.length; i++) {
    const prev = outline[(i + outline.length - 1) % outline.length], p = outline[i], next = outline[(i + 1) % outline.length];
    const a = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2], b = [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2];
    const steps = Math.min(64, Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)));
    for (let j = 0; j < steps; j++) { const t = j / steps, s = 1 - t; polygon.push([s * s * a[0] + 2 * s * t * p[0] + t * t * b[0], s * s * a[1] + 2 * s * t * p[1] + t * t * b[1]]); }
  }
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (segmentDistance({ x, y }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }) <= tolerance) return true;
    const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y && b[1] > y && side > 0) winding++;
    if (a[1] > y && b[1] <= y && side < 0) winding--;
  }
  return winding !== 0;
}
