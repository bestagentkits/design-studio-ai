import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePaintPng, decodePaintTile, paintHash } from '../src/shared/paint-png';
import { compositePainting } from '../src/shared/paint-composite';
import { paintingSchema } from '../src/shared/painting-schema';

test('lossless tile bytes round-trip and reject corruption, wrong dimensions and truncation', async () => {
  const pixels = new Uint8Array(512 * 512 * 4); for (let i = 0; i < pixels.length; i++) pixels[i] = i * 31 % 256;
  const png = await encodePaintPng(512, 512, pixels); assert.deepEqual(await decodePaintTile(png), pixels); assert.equal((await paintHash(png)).length, 64);
  const corrupt = png.slice(); corrupt[40] ^= 1; await assert.rejects(decodePaintTile(corrupt));
  await assert.rejects(decodePaintTile(png.subarray(0, -1)));
  await assert.rejects(decodePaintTile(await encodePaintPng(1, 1, new Uint8Array(4))), /512/);
});
test('trusted compositor honors hidden layers, masks and blending without publishing source', async () => {
  const paint = paintingSchema.parse({ id: 'p', name: 'Art', width: 1, height: 1, generation: 0, colorSpace: 'srgb', algorithm: 'cpu-srgb-grain-v1', tileSize: 512, layers: ['red', 'blue'].map(id => ({ id, name: id, visible: true, locked: false, opacity: 1, blend: 'normal', tiles: [{ x: 0, y: 0, assetId: id, hash: 'a'.repeat(64), generation: 0 }] })) });
  const load = async (id: string) => { const pixels = new Uint8Array(512 * 512 * 4); pixels.set(id === 'red' ? [255, 0, 0, 255] : [0, 0, 255, 255]); return pixels; };
  paint.layers[1].opacity = .5; assert.deepEqual(Array.from(await compositePainting(paint, load)), [128, 0, 128, 255]);
  paint.layers[1].visible = false; assert.deepEqual(Array.from(await compositePainting(paint, load)), [255, 0, 0, 255]);
  paint.layers[1].visible = true; paint.layers[1].mask = { enabled: true, tiles: [] }; assert.deepEqual(Array.from(await compositePainting(paint, load)), [255, 0, 0, 255]);
});
