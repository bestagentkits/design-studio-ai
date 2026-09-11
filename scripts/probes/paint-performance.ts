import { PaintRuntime, PAINT_TILE_SIZE, type PaintBrush } from '../../src/shared/paint-runtime';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, totalmem } from 'node:os';

const brush: PaintBrush = { size: 24, spacing: .2, flow: .8, opacity: 1, texture: .6, seed: 42,
  color: [220, 40, 20, 255], pickup: .25, deposit: 1 };
function exercise(width: number, layers: number, tileBudget: number) {
  const runtime = new PaintRuntime(width, width, tileBudget);
  const timings: number[] = [];
  let error: string | undefined;
  const start = performance.now();
  for (let layer = 0; layer < layers; layer++) runtime.addLayer(`layer-${layer}`);
  try {
    for (let layer = 0; layer < layers; layer++) {
      for (let y = 32; y < width; y += PAINT_TILE_SIZE) for (let x = 32; x < width; x += PAINT_TILE_SIZE) {
        const before = performance.now();
        runtime.stroke(`layer-${layer}`, [{ x, y, pressure: .8 }, { x: x + 64, y: y + 64, pressure: .6 }], brush);
        timings.push(performance.now() - before);
      }
    }
  } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  timings.sort((a, b) => a - b);
  return { width, layers, tileBudget, requestedTileCoverage: (width / PAINT_TILE_SIZE) ** 2 * layers,
    committedStrokes: timings.length, allocatedBytes: runtime.allocatedBytes, elapsedMs: performance.now() - start,
    strokeP95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * .95))], error: error ?? null };
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: platform(), osRelease: release(),
  cpu: cpus()[0].model, ramBytes: totalmem(), method: 'Node CPU prototype, one short real textured/mixing stroke per tile per layer. Not browser frame/input latency or a physical iPad measurement.',
  results: [exercise(2048, 12, 192), exercise(4096, 24, 256)] }, null, 2));
