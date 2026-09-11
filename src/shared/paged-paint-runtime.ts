import { PaintRuntime, validatePaintInput, PAINT_TILE_SIZE, type PaintPoint, type PaintBrush } from './paint-runtime';
import { PaintTileCache, type PaintTileStore } from './paint-tile-cache';

interface PagedLayer { id: string; tiles: Record<string, string> }
interface Snapshot { layers: PagedLayer[] }

/** Local feasibility transaction. Durable asset ownership/receipts belong to the server integration. */
export class PagedPaintRuntime {
  private layers: PagedLayer[] = [];
  private version = 0;
  private busy = false;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private cache: PaintTileCache;
  constructor(readonly width: number, readonly height: number, private store: PaintTileStore, capacity = 8) {
    new PaintRuntime(width, height);
    this.cache = new PaintTileCache(store, capacity);
  }
  get generation() { return this.version; }
  get residentBytes() { return this.cache.residentBytes; }
  get tileCount() { return this.layers.reduce((n, layer) => n + Object.keys(layer.tiles).length, 0); }
  private snapshot(): Snapshot { return structuredClone({ layers: this.layers }); }
  private layer(id: string) {
    const layer = this.layers.find(value => value.id === id);
    if (!layer) throw new Error('Unknown paint layer');
    return layer;
  }
  addLayer(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id) || this.layers.some(layer => layer.id === id) || this.layers.length >= 24) throw new Error('Invalid paint layer');
    this.layers.push({ id, tiles: {} }); this.version++; this.future = [];
    // Structural edits invalidate pixel-only history until shared document history is wired.
    this.past = [];
  }
  private check(generation: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.version !== generation) throw new Error('Painting generation conflict');
  }
  async readTile(layerId: string, x: number, y: number): Promise<Uint8Array | undefined> {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Math.ceil(this.width / PAINT_TILE_SIZE) || y >= Math.ceil(this.height / PAINT_TILE_SIZE)) throw new Error('Invalid paint tile coordinate');
    const key = this.layer(layerId).tiles[`${x},${y}`];
    return key ? this.cache.read(key) : undefined;
  }
  async stroke(layerId: string, input: readonly PaintPoint[], settings: PaintBrush, expectedGeneration = this.version, signal?: AbortSignal) {
    if (this.busy) throw new Error('Painting transaction already active');
    this.check(expectedGeneration, signal);
    if (!Array.isArray(input) || !input.length || input.length > 10000) throw new Error('Invalid paint point count');
    const points = structuredClone(input), brush = structuredClone(settings);
    validatePaintInput(this.width, this.height, points, brush);
    const before = this.snapshot(), layer = before.layers.find(value => value.id === layerId);
    if (!layer) throw new Error('Unknown paint layer');
    this.busy = true;
    try {
      // Only one affected layer and the stroke's finite bounding box enter the CPU workspace.
      // At 4096² this is at most 64 tiles; other layers stay in the backing store.
      const radius = brush.size * (1 + (brush.tilt ?? 0)) / 2 + 1;
      const range = (axis: 'x' | 'y', dimension: number) => {
        let min = dimension, max = 0;
        for (const point of points) { min = Math.min(min, point[axis]); max = Math.max(max, point[axis]); }
        return [Math.floor(Math.max(0, min - radius) / PAINT_TILE_SIZE), Math.floor(Math.min(dimension - 1, max + radius) / PAINT_TILE_SIZE)];
      };
      const [left, right] = range('x', this.width), [top, bottom] = range('y', this.height);
      const runtime = new PaintRuntime(this.width, this.height, 64); runtime.addLayer(layerId);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        this.check(expectedGeneration, signal);
        const key = layer.tiles[`${x},${y}`];
        if (key) runtime.loadTile(layerId, x, y, await this.cache.read(key));
      }
      this.check(expectedGeneration, signal);
      const result = runtime.stroke(layerId, points, brush);
      const next = this.snapshot(), nextLayer = next.layers.find(value => value.id === layerId)!;
      for (const address of result.dirtyKeys) {
        this.check(expectedGeneration, signal);
        const [x, y] = address.split(',').map(Number), key = crypto.randomUUID();
        // Unique keys preserve old pixels for cancellation and undo. Never mutate committed tiles.
        await this.store.write(key, runtime.copyTile(layerId, x, y)!);
        nextLayer.tiles[address] = key;
      }
      this.check(expectedGeneration, signal);
      if (result.dirtyTiles) {
        this.past.push(before); if (this.past.length > 80) this.past.shift();
        this.future = []; this.layers = next.layers; this.version++;
      }
      return { ...result, generation: this.version, cacheResidentBytes: this.residentBytes };
    } finally { this.busy = false; }
  }
  undo() {
    if (this.busy) throw new Error('Painting transaction already active');
    const previous = this.past.pop(); if (!previous) return;
    this.future.push(this.snapshot()); this.layers = previous.layers; this.version++;
  }
  redo() {
    if (this.busy) throw new Error('Painting transaction already active');
    const next = this.future.pop(); if (!next) return;
    this.past.push(this.snapshot()); this.layers = next.layers; this.version++;
  }
}
