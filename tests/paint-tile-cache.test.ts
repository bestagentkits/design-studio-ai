import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaintTileCache, PAINT_TILE_BYTES, type PaintTileStore } from '../src/shared/paint-tile-cache';

test('real disk-backed eviction bounds resident bytes and restores exact pixels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-paint-cache-'));
  const store: PaintTileStore = {
    async read(key) { try { return await readFile(join(directory, key)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    async write(key, bytes) { await writeFile(join(directory, key), bytes); },
  };
  try {
    const cache = new PaintTileCache(store, 2);
    for (let i = 0; i < 12; i++) await cache.edit(`tile-${i}`, bytes => { bytes[0] = i + 1; bytes[PAINT_TILE_BYTES - 1] = 255; }, true);
    assert.equal(cache.residentBytes, 2 * PAINT_TILE_BYTES);
    await cache.flush();
    const reopened = new PaintTileCache(store, 1);
    for (let i = 11; i >= 0; i--) { const bytes = await reopened.read(`tile-${i}`); assert.equal(bytes[0], i + 1); assert.equal(bytes.at(-1), 255); }
    const copy = await reopened.read('tile-0'); copy[0] = 99;
    assert.equal((await reopened.read('tile-0'))[0], 1);
    await assert.rejects(reopened.read('missing'), /tile is missing/);
    await assert.rejects(reopened.edit('new', () => { throw new Error('Cancelled creation'); }, true), /Cancelled/);
    await assert.rejects(reopened.read('new'), /tile is missing/);
    await assert.rejects(reopened.edit('new', async () => { throw new Error('Async failure'); }, true), /synchronous/);
    await new Promise(resolve => setTimeout(resolve, 0));
    await assert.rejects(reopened.read('new'), /tile is missing/);
    await assert.rejects(reopened.edit('../outside', () => {}), /Invalid tile key/);
    await assert.rejects(reopened.edit('tile-0', bytes => { bytes[0] = 88; throw new Error('Cancel'); }), /Cancel/);
    assert.equal((await reopened.read('tile-0'))[0], 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed persistence retains dirty bytes, rejects eviction and allows retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-paint-cache-'));
  const blocked = join(directory, 'store');
  await writeFile(blocked, 'not a directory');
  const store: PaintTileStore = {
    async read() { return undefined; },
    async write(key, bytes) { await writeFile(join(blocked, key), bytes); },
  };
  try {
    const cache = new PaintTileCache(store, 1);
    await cache.edit('a', bytes => { bytes[0] = 42; }, true);
    await assert.rejects(cache.read('b'));
    assert.equal((await cache.read('a'))[0], 42);
    await rm(blocked); await mkdir(blocked); await cache.flush();
    assert.equal((await readFile(join(blocked, 'a')))[0], 42);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
