import { bounded, grain, over, pickup, PAINT_TILE_SIZE, type PaintColor } from './paint-pixels';
import type { PaintBrush, PaintPoint } from './paint-runtime';
export interface PaintLayer { id: string; opacity: number; visible: boolean; locked: boolean; tiles: Map<string, Uint8ClampedArray> }
export function paintAddress(x: number, y: number) {
  return { key: `${Math.floor(x / PAINT_TILE_SIZE)},${Math.floor(y / PAINT_TILE_SIZE)}`, offset: ((y % PAINT_TILE_SIZE) * PAINT_TILE_SIZE + x % PAINT_TILE_SIZE) * 4 };
}
export function readPaint(layer: PaintLayer, x: number, y: number): PaintColor {
  const { key, offset } = paintAddress(x, y), tile = layer.tiles.get(key);
  return tile ? [tile[offset], tile[offset + 1], tile[offset + 2], tile[offset + 3]] : [0, 0, 0, 0];
}
/** Incremental draft samples a fixed source; only commit publishes its copy-on-write tiles. */
export class PaintStroke {
  private draft: PaintLayer;
  private dirty = new Set<string>();
  private previous?: PaintPoint;
  private carried: PaintColor;
  private distanceLeft: number;
  private stamps = 0;
  private samples = 0;
  private work = 0;
  private closed = false;
  private brush: PaintBrush;
  constructor(private source: PaintLayer, private width: number, private height: number,
    private maxTiles: number, private otherTiles: number, brush: PaintBrush, private publish: (draft: PaintLayer) => void,
    private sampleSource?: (x: number, y: number) => PaintColor) {
    this.draft = { ...source, tiles: new Map(source.tiles) }; this.brush = structuredClone(brush);
    this.carried = this.brush.color; this.distanceLeft = Math.max(.5, brush.size * brush.spacing);
  }
  get dirtyKeys() { return [...this.dirty]; }
  copyTile(x: number, y: number) { const tile = this.draft.tiles.get(`${x},${y}`); return tile ? new Uint8Array(tile) : undefined; }
  append(points: readonly PaintPoint[]) {
    if (this.closed) throw new Error('Paint stroke is closed');
    try {
      if (points.length + this.samples > 10000) throw new Error('Invalid paint point count');
      for (const point of points) {
        bounded(point.x, 0, this.width - 1, 'x'); bounded(point.y, 0, this.height - 1, 'y'); bounded(point.pressure, 0, 1, 'pressure');
        const p = { ...point }, a = this.previous; this.samples++;
        if (!a) this.stamp(p, 0);
        else {
          const distance = Math.hypot(p.x - a.x, p.y - a.y), angle = Math.atan2(p.y - a.y, p.x - a.x);
          let travelled = this.distanceLeft;
          for (; travelled <= distance; travelled += Math.max(.5, this.brush.size * this.brush.spacing)) {
            const t = travelled / distance;
            this.stamp({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, pressure: a.pressure + (p.pressure - a.pressure) * t }, angle);
          }
          this.distanceLeft = travelled - distance;
        }
        this.previous = p;
      }
    } catch (error) { this.cancel(); throw error; }
  }
  private stamp(p: PaintPoint, angle: number) {
    const b = this.brush, index = this.stamps++;
    if (this.stamps > 10000) throw new Error('Paint stroke exceeds stamp budget');
    this.work += (Math.ceil(b.size) + 2) ** 2;
    if (this.work > 8000000) throw new Error('Paint stroke exceeds pixel work budget');
    if (!p.pressure) return;
    const sampled = this.sampleSource ? this.sampleSource(Math.floor(p.x), Math.floor(p.y)) : readPaint(this.source, Math.floor(p.x), Math.floor(p.y));
    // Wet brushes retain their load over empty paper rather than losing opacity at every stamp.
    this.carried = pickup(this.carried, sampled, b.tip ? b.pickup * sampled[3] / 255 : b.pickup);
    const radius = Math.max(.5, b.size * p.pressure / 2), cos = Math.cos(angle), sin = Math.sin(angle);
    for (let y = Math.max(0, Math.floor(p.y - radius)); y <= Math.min(this.height - 1, Math.ceil(p.y + radius)); y++) {
      for (let x = Math.max(0, Math.floor(p.x - radius)); x <= Math.min(this.width - 1, Math.ceil(p.x + radius)); x++) {
        const dx = x + .5 - p.x, dy = y + .5 - p.y, distance = Math.hypot(dx, dy);
        let coverage = Math.max(0, Math.min(1, radius + .5 - distance));
        const hardness = b.hardness ?? 1;
        if (hardness < 1) coverage *= Math.pow(Math.max(0, Math.min(1, (1 - distance / radius) / (1 - hardness))), .8);
        // Stable cross-brush bristles and paper grain create coherent fibers, not fresh per-stamp noise.
        const fiber = b.tip === 'bristle' ? .15 + .85 * grain(b.seed, Math.round((-dx * sin + dy * cos) * 1.5), 0, 0) : 1;
        const texture = b.tip ? grain(b.seed, x, y, 0) : grain(b.seed, x, y, index);
        const alpha = coverage * fiber * b.flow * b.opacity * b.deposit * (1 - b.texture * texture);
        if (!alpha || !this.carried[3]) continue;
        const { key, offset } = paintAddress(x, y);
        if (!this.dirty.has(key)) {
          if (!this.draft.tiles.has(key) && this.otherTiles + this.draft.tiles.size >= this.maxTiles) throw new Error('Paint tile budget exceeded');
          this.draft.tiles.set(key, this.draft.tiles.get(key)?.slice() ?? new Uint8ClampedArray(PAINT_TILE_SIZE ** 2 * 4)); this.dirty.add(key);
        }
        const previous = readPaint(this.draft, x, y);
        const next = b.mode === 'erase' ? [previous[0], previous[1], previous[2], Math.round(previous[3] * (1 - alpha))] : over(previous, this.carried, alpha);
        this.draft.tiles.get(key)!.set(next, offset);
      }
    }
  }
  commit() {
    if (this.closed) throw new Error('Paint stroke is closed');
    if (!this.samples) throw new Error('Invalid paint point count');
    this.publish(this.draft); this.closed = true;
    return { stamps: this.stamps, dirtyTiles: this.dirty.size, dirtyKeys: this.dirtyKeys,
      allocatedBytes: (this.otherTiles + this.draft.tiles.size) * PAINT_TILE_SIZE ** 2 * 4 };
  }
  cancel() { this.closed = true; this.dirty.clear(); this.draft = { ...this.source, tiles: new Map() }; }
}
