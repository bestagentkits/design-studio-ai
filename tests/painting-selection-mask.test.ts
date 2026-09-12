import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaintingSelectionMask } from '../src/shared/painting-selection-mask';
import { type PaintingSelection } from '../src/shared/painting-selection';
test('selection mask rasterizes explicit feather bytes at named pixels', async () => {
  const rectangle = await createPaintingSelectionMask(24, 24, { kind: 'rectangle', points: [{ x: 2, y: 3 }, { x: 18, y: 20 }], feather: 3 });
  assert.equal(rectangle.coverage(10, 12), 1); // interior pixel, farther than the 3px feather from every edge
  assert.equal(rectangle.coverage(0, 0), 0); // outside the polygon
  assert.equal(rectangle.coverage(2, 12), Math.round(Math.min(1, 0.5 / 3) * 255) / 255); // pixel center 2.5, 0.5px inside the left edge x=2
  assert.equal(rectangle.coverage(2, 12), 43 / 255); // pinned: a different feather denominator or pixel-center offset changes this byte
  assert.equal(rectangle.coverage(3, 10), Math.round(Math.min(1, 1.5 / 3) * 255) / 255); // pixel center 3.5, 1.5px inside the same edge
  assert.equal(rectangle.coverage(3, 10), 128 / 255); // pinned against feather and pixel-center drift
  assert.equal(rectangle.coverage(10, 3), 43 / 255); // transposed candidate: 0.5px below the top edge y=3
  assert.notEqual(rectangle.coverage(3, 10), rectangle.coverage(10, 3)); // a swapped x/y rasterization flips this
  assert.ok(rectangle.allocatedBytes < 24 * 24);
  const lasso = await createPaintingSelectionMask(24, 24, { kind: 'lasso', points: [{ x: 2, y: 1 }, { x: 18, y: 1 }, { x: 10, y: 8 }, { x: 20, y: 21 }, { x: 1, y: 18 }], feather: 2 });
  assert.equal(lasso.coverage(10, 3), 1); // interior pixel, farther than the 2px feather from every edge
  assert.equal(lasso.coverage(0, 0), 0); // outside the polygon
  assert.ok(lasso.allocatedBytes < 24 * 24);
});
test('coverage snapshots the selection and never reevaluates mutated polygons', async () => {
  const selection: PaintingSelection = { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 8, y: 8 }], feather: 0 };
  const pending = createPaintingSelectionMask(16, 16, selection); selection.points[1] = { x: 1, y: 1 };
  const mask = await pending; assert.equal(mask.coverage(7, 7), 1); assert.equal(mask.coverage(8, 8), 0);
});
test('mask bounds unrestricted, off-canvas and invalid-coordinate reads', async () => {
  const full = await createPaintingSelectionMask(8, 8); assert.equal(full.allocatedBytes, 0); assert.equal(full.coverage(7, 7), 1);
  for (const [x, y] of [[-1, 0], [8, 0], [.5, 1], [NaN, 1]]) assert.equal(full.coverage(x, y), 0);
  const empty = await createPaintingSelectionMask(8, 8, { kind: 'rectangle', points: [{ x: -100, y: -100 }, { x: -1, y: -1 }], feather: 0 });
  assert.equal(empty.allocatedBytes, 0); assert.equal(empty.coverage(0, 0), 0);
});
test('excess polygon work fails before painting and cancellation stops rasterization', async () => {
  const polygon: PaintingSelection = { kind: 'lasso', points: Array.from({ length: 2048 }, (_, i) => ({ x: i % 400, y: i % 300 })), feather: 0 };
  await assert.rejects(createPaintingSelectionMask(4096, 4096, polygon), /work budget/);
  await assert.rejects(createPaintingSelectionMask(0, 32), /dimensions/);
  const controller = new AbortController();
  const pending = createPaintingSelectionMask(512, 512, { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 512, y: 512 }], feather: 0 }, controller.signal);
  controller.abort(); await assert.rejects(pending, /cancelled/);
});
