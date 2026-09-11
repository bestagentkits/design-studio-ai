import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PagedPaintRuntime } from '../src/shared/paged-paint-runtime';
import { PaintRuntime, type PaintBrush } from '../src/shared/paint-runtime';
import type { PaintTileStore } from '../src/shared/paint-tile-cache';

const brush: PaintBrush = { size: 12, spacing: .2, flow: .8, opacity: 1, texture: .4, seed: 9, color: [200, 20, 40, 255], pickup: .5, deposit: 1 };
const points = [{ x: 505, y: 15, pressure: .8 }, { x: 540, y: 15, pressure: .6 }];
async function fixture(run: (store: PaintTileStore) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-paged-paint-'));
  const store: PaintTileStore = {
    async read(key) { try { return await readFile(join(directory, key)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } },
    async write(key, bytes) { await writeFile(join(directory, key), bytes); },
  };
  try { await run(store); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('paged strokes match the CPU kernel across tile boundaries after eviction and preserve immutable undo', async () => fixture(async store => {
  const paged = new PagedPaintRuntime(1024, 512, store, 1), memory = new PaintRuntime(1024, 512);
  paged.addLayer('ink'); memory.addLayer('ink');
  await paged.stroke('ink', points, brush); memory.stroke('ink', points, brush);
  const first = await paged.readTile('ink', 0, 0);
  const blue = { ...brush, color: [0, 0, 255, 255] as PaintBrush['color'] };
  await paged.stroke('ink', points, blue); memory.stroke('ink', points, blue);
  assert.equal(paged.tileCount, 2); assert.equal(paged.residentBytes, 1024 ** 2);
  for (const x of [0, 1, 0]) assert.deepEqual(await paged.readTile('ink', x, 0), memory.copyTile('ink', x, 0));
  const generation = paged.generation;
  paged.undo(); assert.equal(paged.generation, generation + 1); assert.deepEqual(await paged.readTile('ink', 0, 0), first);
  paged.redo(); assert.equal(paged.generation, generation + 2); assert.deepEqual(await paged.readTile('ink', 0, 0), memory.copyTile('ink', 0, 0));
  await assert.rejects(paged.stroke('ink', points, brush, generation), /generation conflict/);
}));

test('failed second tile write and cancellation cannot publish partial pixels', async () => fixture(async backing => {
  let writes = 0, fail = false;
  const store: PaintTileStore = { read: key => backing.read(key), async write(key, bytes) { if (fail && ++writes === 2) throw new Error('Disk full'); await backing.write(key, bytes); } };
  const paged = new PagedPaintRuntime(1024, 512, store, 1); paged.addLayer('ink');
  await paged.stroke('ink', points, brush);
  const original = await paged.readTile('ink', 0, 0), generation = paged.generation;
  fail = true;
  await assert.rejects(paged.stroke('ink', points, { ...brush, color: [0, 255, 0, 255] }), /Disk full/);
  assert.equal(paged.generation, generation); assert.deepEqual(await paged.readTile('ink', 0, 0), original);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(paged.stroke('ink', points, brush, generation, abort.signal), /abort/i);
  assert.equal(paged.generation, generation);
  fail = false; await paged.stroke('ink', points, brush); assert.equal(paged.generation, generation + 1);
}));

test('a structural change or abort during a durable write rejects the in-flight generation', async () => fixture(async backing => {
  let duringWrite = () => {};
  const store: PaintTileStore = { read: key => backing.read(key), async write(key, bytes) { await backing.write(key, bytes); duringWrite(); } };
  const paged = new PagedPaintRuntime(1024, 512, store); paged.addLayer('ink');
  duringWrite = () => { paged.addLayer('remote'); duringWrite = () => {}; };
  await assert.rejects(paged.stroke('ink', points, brush), /generation conflict/);
  assert.equal(paged.tileCount, 0); assert.equal(await paged.readTile('ink', 0, 0), undefined);
  const abort = new AbortController(); duringWrite = () => abort.abort();
  await assert.rejects(paged.stroke('ink', points, brush, paged.generation, abort.signal), /abort/i);
  assert.equal(paged.tileCount, 0);
}));

test('invalid inputs never access storage and imported tiles do not alias source bytes', async () => fixture(async backing => {
  let reads = 0;
  const store: PaintTileStore = { read: key => { reads++; return backing.read(key); }, write: (key, bytes) => backing.write(key, bytes) };
  const paged = new PagedPaintRuntime(1024, 512, store); paged.addLayer('ink');
  await assert.rejects(paged.stroke('ink', [{ x: Infinity, y: 1, pressure: 1 }], brush), /Invalid/);
  // Uncloneable entries demonstrate count rejection happens before allocating the input snapshot.
  await assert.rejects(paged.stroke('ink', Array(10001).fill(() => {}), brush), /Invalid paint point count/);
  assert.equal(reads, 0);
  const memory = new PaintRuntime(512, 512, 1); memory.addLayer('ink');
  const bytes = new Uint8Array(1024 ** 2); bytes.set([255, 0, 0, 255]);
  memory.loadTile('ink', 0, 0, bytes); bytes.fill(0);
  assert.deepEqual(memory.pixel(0, 0), [255, 0, 0, 255]);
}));
