import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';
import { PaintTileCache, PAINT_TILE_BYTES } from '../../src/shared/paint-tile-cache';
import { PaintRuntime } from '../../src/shared/paint-runtime';
const zip = promisify(deflate), unzip = promisify(inflate);
const directory = await mkdtemp(join(tmpdir(), 'studio-paint-storage-'));
const runtime = new PaintRuntime(512, 512, 1); runtime.addLayer('ink');
runtime.stroke('ink', [{ x: 40, y: 40, pressure: .8 }, { x: 250, y: 250, pressure: .6 }], {
  size: 24, spacing: .2, flow: .8, opacity: 1, texture: .6, seed: 42, color: [220, 40, 20, 255], pickup: .25, deposit: 1 });
const tile = runtime.copyTile('ink', 0, 0)!;
let storedBytes = 0;
try {
  const cache = new PaintTileCache({
    async read(key) { try { return await unzip(await readFile(join(directory, key))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    async write(key, bytes) { const compressed = await zip(bytes); await writeFile(join(directory, key), compressed); storedBytes += compressed.byteLength; },
  }, 8);
  const start = performance.now();
  // Repeat one actual brush tile to isolate storage working-set behavior from brush cost.
  for (let i = 0; i < 1536; i++) await cache.edit(`tile-${i}`, bytes => bytes.set(tile), true);
  await cache.flush();
  for (const i of [0, 511, 1023, 1535]) {
    const restored = await cache.read(`tile-${i}`);
    if (!restored.every((value, index) => value === tile[index])) throw new Error('Tile round-trip mismatch');
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), method: 'Node temporary compressed-file backing; repeated real brush tile; four full-byte reload checks. Storage feasibility only, not browser brush latency or a production persistence adapter.',
    tiles: 1536, logicalBytes: 1536 * PAINT_TILE_BYTES, cacheResidentBytes: cache.residentBytes, capacity: 8,
    storedBytes, elapsedMs: performance.now() - start, roundTrip: 'pass' }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
