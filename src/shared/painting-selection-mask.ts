import { selectionCoverage, validatePaintingSelection, type PaintingSelection } from './painting-selection';
export const PAINT_SELECTION_WORK_LIMIT = 100_000_000;
export interface PaintingSelectionMask {
  /** One byte per selected bounding-box pixel; no allocation for an unrestricted canvas. */
  readonly allocatedBytes: number;
  /** Integer painting pixel coordinates, sampled at pixel centers. Outside pixels are protected. */
  coverage(x: number, y: number): number;
}
/** Rasterize selection once, bounding polygon work before allocating memory or painting. */
export async function createPaintingSelectionMask(width: number, height: number, selection?: PaintingSelection, signal?: AbortSignal): Promise<PaintingSelectionMask> {
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 4096)) throw new Error('Invalid selection mask dimensions');
  if (signal?.aborted) throw new Error('Painting selection cancelled');
  const inside = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  if (!selection) return { allocatedBytes: 0, coverage: (x, y) => inside(x, y) ? 1 : 0 };
  validatePaintingSelection(selection);
  const vertices = selection.kind === 'rectangle' ? 4 : selection.points.length;
  if (width * height * vertices > PAINT_SELECTION_WORK_LIMIT) throw new Error('Selection exceeds painting work budget. Reduce lasso points or canvas size.');
  // Snapshot before the first yield: edits to a UI selection cannot change an in-flight command.
  const snapshot = structuredClone(selection), points = snapshot.kind === 'rectangle' ? snapshot.points.slice(0, 2) : snapshot.points;
  const left = Math.min(width, Math.max(0, Math.floor(Math.min(...points.map(p => p.x)))));
  const top = Math.min(height, Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))));
  const right = Math.min(width, Math.max(0, Math.ceil(Math.max(...points.map(p => p.x)))));
  const bottom = Math.min(height, Math.max(0, Math.ceil(Math.max(...points.map(p => p.y)))));
  const maskWidth = right - left, maskHeight = bottom - top, bytes = new Uint8Array(maskWidth * maskHeight);
  for (let y = top; y < bottom; y++) {
    if ((y - top) % 16 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (signal?.aborted) throw new Error('Painting selection cancelled'); }
    for (let x = left; x < right; x++) bytes[(y - top) * maskWidth + x - left] = Math.round(selectionCoverage(snapshot, x + .5, y + .5) * 255);
  }
  if (signal?.aborted) throw new Error('Painting selection cancelled');
  return { allocatedBytes: bytes.byteLength, coverage: (x, y) => inside(x, y) && x >= left && y >= top && x < right && y < bottom ? bytes[(y - top) * maskWidth + x - left] / 255 : 0 };
}
