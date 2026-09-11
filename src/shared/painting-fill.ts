import { over, validateColor, type PaintColor } from './paint-pixels';
import { selectionCoverage, validatePaintingSelection, type PaintingSelection } from './painting-selection';
export interface PaintingDraft { readonly dirtyKeys: string[]; copyTile(x: number, y: number): Uint8Array | undefined; cancel(): void }
export class PaintingTileDraft implements PaintingDraft {
  constructor(readonly tiles = new Map<string, Uint8Array>()) {}
  get dirtyKeys() { return [...this.tiles.keys()]; }
  copyTile(x: number, y: number) { return this.tiles.get(`${x},${y}`)?.slice(); }
  cancel() { this.tiles.clear(); }
}
export interface PaintingFillOptions { x: number; y: number; color: PaintColor; tolerance: number; contiguous: boolean; erase?: boolean; selection?: PaintingSelection; alphaLock?: boolean }
/** Atomic bounded fill. Yielding each chunk permits cancellation without publishing partial tiles. */
export async function fillPainting(width: number, height: number, options: PaintingFillOptions, source: (x: number, y: number) => PaintColor, sample = source, mask: (x: number, y: number) => number = () => 1, signal?: AbortSignal): Promise<PaintingTileDraft> {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096) || !Number.isInteger(options.x) || !Number.isInteger(options.y) || options.x < 0 || options.y < 0 || options.x >= width || options.y >= height || !Number.isFinite(options.tolerance) || options.tolerance < 0 || options.tolerance > 255) throw new Error('Invalid painting fill');
  options = structuredClone(options);
  validateColor(options.color); if (options.selection) validatePaintingSelection(options.selection);
  if (width * height * (options.selection?.kind === 'lasso' ? options.selection.points.length : 4) > 100_000_000) throw new Error('Selection exceeds fill work budget. Reduce lasso points or canvas size.');
  if (options.alphaLock && options.erase) throw new Error('Turn off alpha lock before erasing.');
  const result = new PaintingTileDraft(), count = width * height, seen = new Uint8Array(count), target = sample(options.x, options.y);
  const queue = options.contiguous ? new Uint32Array(count) : undefined; let head = 0, tail = 0;
  if (queue) { queue[tail++] = options.y * width + options.x; seen[queue[0]] = 1; }
  const matches = (pixel: PaintColor) => Math.max(Math.abs(pixel[3] - target[3]), ...[0, 1, 2].map(c => Math.abs(pixel[c] * pixel[3] / 255 - target[c] * target[3] / 255))) <= options.tolerance;
  try {
    while (queue ? head < tail : head < count) {
      if (head % 2048 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (signal?.aborted) throw new Error('Painting fill cancelled'); }
      const index = queue ? queue[head++] : head++, x = index % width, y = Math.floor(index / width);
      const coverage = selectionCoverage(options.selection, x + .5, y + .5) * mask(x, y);
      if (!coverage || !matches(sample(x, y))) continue;
      const before = source(x, y), after = options.erase ? [before[0], before[1], before[2], Math.round(before[3] * (1 - coverage))] : [...over(before, options.color, coverage)];
      if (options.alphaLock) after[3] = before[3];
      if (after.some((v, c) => v !== before[c])) {
        const tx = Math.floor(x / 512), ty = Math.floor(y / 512), key = `${tx},${ty}`;
        let tile = result.tiles.get(key);
        if (!tile) { tile = new Uint8Array(512 * 512 * 4); for (let yy = 0; yy < Math.min(512, height - ty * 512); yy++) { if (yy % 16 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (signal?.aborted) throw new Error('Painting fill cancelled'); } for (let xx = 0; xx < Math.min(512, width - tx * 512); xx++) tile.set(source(tx * 512 + xx, ty * 512 + yy), (yy * 512 + xx) * 4); } result.tiles.set(key, tile); }
        tile.set(after, ((y % 512) * 512 + x % 512) * 4);
      }
      if (queue) for (const neighbor of [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y ? index - width : -1, y + 1 < height ? index + width : -1]) if (neighbor >= 0 && !seen[neighbor]) { seen[neighbor] = 1; queue[tail++] = neighbor; }
    }
    return result;
  } catch (error) { result.cancel(); throw error; }
}
