import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';
import { PagedPaintRuntime } from '../../src/shared/paged-paint-runtime';
const zip = promisify(deflate), unzip = promisify(inflate);
const directory = await mkdtemp(join(tmpdir(), 'studio-paged-workload-'));
let storedBytes = 0;
try {
  const painting = new PagedPaintRuntime(4096, 4096, {
    async read(key) { try { return await unzip(await readFile(join(directory, key))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } },
    async write(key, bytes) { const data = await zip(bytes); await writeFile(join(directory, key), data); storedBytes += data.byteLength; },
  }, 8);
  for (let layer = 0; layer < 24; layer++) painting.addLayer(`layer-${layer}`);
  const start = performance.now(), timings = [];
  for (let layer = 0; layer < 24; layer++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const before = performance.now();
    await painting.stroke(`layer-${layer}`, [{ x: x * 512 + 40, y: y * 512 + 40, pressure: .8 }, { x: x * 512 + 220, y: y * 512 + 190, pressure: .6 }], {
      size: 24, spacing: .2, flow: .8, opacity: 1, texture: .6, seed: layer * 64 + y * 8 + x, color: [220, 40, 20, 255], pickup: .25, deposit: 1,
    });
    timings.push(performance.now() - before);
  }
  // Revisit evicted source tiles with real pickup/deposit, then test immutable undo bytes.
  const original = await painting.readTile('layer-0', 0, 0);
  await painting.stroke('layer-0', [{ x: 40, y: 40, pressure: .8 }, { x: 100, y: 100, pressure: .6 }], {
    size: 24, spacing: .2, flow: .8, opacity: 1, texture: .6, seed: 3, color: [20, 40, 220, 255], pickup: .5, deposit: 1,
  });
  const changed = await painting.readTile('layer-0', 0, 0);
  if (changed!.every((value, index) => value === original![index])) throw new Error('Pickup/deposit did not change source');
  const generation = painting.generation; painting.undo();
  const restored = await painting.readTile('layer-0', 0, 0);
  if (!restored!.every((value, index) => value === original![index]) || painting.generation <= generation) throw new Error('Immutable undo failed');
  timings.sort((a, b) => a - b);
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), method: 'Node CPU real textured stroke in each tile of 24 layers, compressed-file durable writes, evicted source pickup and full-byte undo. No browser/iPad latency or full-frame compositor measurement.',
    dimensions: [4096, 4096], layers: 24, tiles: painting.tileCount, strokes: timings.length,
    cacheResidentBytes: painting.residentBytes, storedBytes, elapsedMs: performance.now() - start,
    strokeP95Ms: timings[Math.floor(timings.length * .95)], processRssBytes: process.memoryUsage().rss,
    sourceReloadAndUndo: 'pass' }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
