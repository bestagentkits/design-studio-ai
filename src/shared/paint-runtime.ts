import { PaintStroke, readPaint as read, type PaintLayer as Layer } from './paint-stroke';
import { bounded, over, PAINT_TILE_SIZE, validateColor, type PaintColor } from './paint-pixels';
export { PAINT_ALGORITHM, PAINT_TILE_SIZE, type PaintColor } from './paint-pixels';
export interface PaintPoint { x: number; y: number; pressure: number; tiltX?: number; tiltY?: number }
export interface PaintBrush {
  size: number; spacing: number; flow: number; opacity: number; texture: number;
  seed: number; color: PaintColor; pickup: number; deposit: number;
  tilt?: number; taper?: number;
  tip?: 'round' | 'bristle' | 'wash'; hardness?: number; mode?: 'paint' | 'erase';
}
export function validatePaintInput(width: number, height: number, points: readonly PaintPoint[], brush: PaintBrush) {
    if (!points.length || points.length > 10000) throw new Error('Invalid paint point count');
    bounded(brush.size, 1, 256, 'brush size'); bounded(brush.spacing, 0.05, 2, 'spacing');
    for (const key of ['flow', 'opacity', 'texture', 'pickup', 'deposit'] as const) bounded(brush[key], 0, 1, key);
    bounded(brush.seed, 0, 0xffffffff, 'seed');
    if (!Number.isInteger(brush.seed)) throw new Error('Invalid paint seed');
    validateColor(brush.color);
    if (brush.tilt !== undefined) bounded(brush.tilt, 0, 1, 'tilt response');
    if (brush.taper !== undefined) bounded(brush.taper, 0, 1, 'ink taper');
    if (brush.mode !== undefined && !['paint', 'erase'].includes(brush.mode)) throw new Error('Invalid paint mode');
    if (brush.hardness !== undefined) bounded(brush.hardness, 0, 1, 'hardness');
    if (brush.tip !== undefined && !['round', 'bristle', 'wash'].includes(brush.tip)) throw new Error('Invalid paint tip');
    for (const p of points) { bounded(p.x, 0, width - 1, 'x'); bounded(p.y, 0, height - 1, 'y'); bounded(p.pressure, 0, 1, 'pressure'); }
}
const empty: PaintColor = [0, 0, 0, 0];
/** Bounded feasibility runtime. No persistence, DOM, GPU or public document contract. */
export class PaintRuntime {
  private layers: Layer[] = [];
  private generation = 0;
  readonly width: number;
  readonly height: number;
  readonly maxTiles: number;
  constructor(width: number, height: number, maxTiles = 64) {
    [width, height].forEach(n => { bounded(n, 1, 4096, 'dimension'); if (!Number.isInteger(n)) throw new Error('Paint dimensions must be integers'); });
    bounded(maxTiles, 1, 256, 'tile budget');
    if (!Number.isInteger(maxTiles)) throw new Error('Paint tile budget must be integer');
    this.width = width; this.height = height; this.maxTiles = maxTiles;
  }
  addLayer(id: string) {
    if (!id || id.length > 128 || this.layers.some(l => l.id === id) || this.layers.length >= 24) throw new Error('Invalid paint layer');
    this.layers.push({ id, opacity: 1, visible: true, locked: false, tiles: new Map() }); this.generation++;
  }
  private layer(id: string) {
    const layer = this.layers.find(l => l.id === id);
    if (!layer) throw new Error('Unknown paint layer');
    return layer;
  }
  configureLayer(id: string, settings: { opacity?: number; visible?: boolean; locked?: boolean }) {
    const layer = this.layer(id);
    if (settings.opacity !== undefined) bounded(settings.opacity, 0, 1, 'layer opacity');
    for (const key of ['visible', 'locked'] as const) if (settings[key] !== undefined && typeof settings[key] !== 'boolean') throw new Error('Invalid paint layer setting');
    this.generation++;
    if (settings.opacity !== undefined) layer.opacity = settings.opacity;
    if (settings.visible !== undefined) layer.visible = settings.visible;
    if (settings.locked !== undefined) layer.locked = settings.locked;
  }
  moveLayer(id: string, index: number) {
    const layer = this.layer(id);
    if (!Number.isInteger(index) || index < 0 || index >= this.layers.length) throw new Error('Invalid paint layer order');
    this.layers.splice(this.layers.indexOf(layer), 1); this.layers.splice(index, 0, layer); this.generation++;
  }
  get allocatedBytes() { return this.layers.reduce((n, l) => n + l.tiles.size * PAINT_TILE_SIZE ** 2 * 4, 0); }
  loadTile(layerId: string, tileX: number, tileY: number, bytes: Uint8Array) {
    // Use the same coordinate validation as reads; imported buffers must never alias caller bytes.
    this.copyTile(layerId, tileX, tileY);
    if (bytes.byteLength !== PAINT_TILE_SIZE ** 2 * 4) throw new Error('Invalid paint tile size');
    const layer = this.layer(layerId), key = `${tileX},${tileY}`;
    if (!layer.tiles.has(key) && this.allocatedBytes / (PAINT_TILE_SIZE ** 2 * 4) >= this.maxTiles) throw new Error('Paint tile budget exceeded');
    layer.tiles = new Map(layer.tiles); layer.tiles.set(key, new Uint8ClampedArray(bytes)); this.generation++;
  }
  copyTile(layerId: string, tileX: number, tileY: number): Uint8Array | undefined {
    if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX >= Math.ceil(this.width / PAINT_TILE_SIZE) || tileY >= Math.ceil(this.height / PAINT_TILE_SIZE)) throw new Error('Invalid paint tile coordinate');
    const tile = this.layer(layerId).tiles.get(`${tileX},${tileY}`);
    return tile ? new Uint8Array(tile) : undefined;
  }
  pixel(x: number, y: number, layerId?: string): PaintColor {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) throw new Error('Invalid paint pixel');
    if (layerId !== undefined) return [...read(this.layer(layerId), x, y)];
    return [...this.layers.reduce<PaintColor>((color, layer) => layer.visible ? over(color, read(layer, x, y), layer.opacity) : color, empty)];
  }
  fork(): PaintRuntime {
    const copy = new PaintRuntime(this.width, this.height, this.maxTiles);
    copy.layers = this.layers.map(layer => ({ ...layer, tiles: new Map(layer.tiles) }));
    return copy;
  }
  get layerSettings() { return this.layers.map(({ id, opacity, visible, locked }) => ({ id, opacity, visible, locked })); }
  beginStroke(id: string, brush: PaintBrush, sampleSource?: (x: number, y: number) => PaintColor, coverage?: (x: number, y: number) => number): PaintStroke {
    const layer = this.layer(id), generation = this.generation;
    if (layer.locked) throw new Error('Paint layer is locked');
    validatePaintInput(this.width, this.height, [{ x: 0, y: 0, pressure: 1 }], brush);
    const source = { ...layer, tiles: new Map(layer.tiles) };
    const otherTiles = this.layers.reduce((n, l) => n + (l === layer ? 0 : l.tiles.size), 0);
    return new PaintStroke(source, this.width, this.height, this.maxTiles, otherTiles, brush, draft => {
      if (generation !== this.generation) throw new Error('Painting generation conflict');
      layer.tiles = draft.tiles; this.generation++;
    }, sampleSource, coverage);
  }
  stroke(id: string, points: readonly PaintPoint[], brush: PaintBrush) {
    validatePaintInput(this.width, this.height, points, brush);
    const stroke = this.beginStroke(id, brush);
    stroke.append(points); return stroke.commit();
  }
}
