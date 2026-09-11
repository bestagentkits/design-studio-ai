import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaintingSelectionMask } from '../src/shared/painting-selection-mask';
import { selectionCoverage, type PaintingSelection } from '../src/shared/painting-selection';
test('selection mask agrees with polygon and feather coverage to byte precision', async () => {
  const selections: PaintingSelection[] = [
    { kind: 'rectangle', points: [{ x: 2, y: 3 }, { x: 18, y: 20 }], feather: 3 },
    { kind: 'lasso', points: [{ x: 2, y: 1 }, { x: 18, y: 1 }, { x: 10, y: 8 }, { x: 20, y: 21 }, { x: 1, y: 18 }], feather: 2 },
  ];
  for (const selection of selections) {
    const mask = await createPaintingSelectionMask(24, 24, selection);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) assert.ok(Math.abs(mask.coverage(x, y) - selectionCoverage(selection, x + .5, y + .5)) <= .5 / 255 + Number.EPSILON);
    assert.ok(mask.allocatedBytes < 24 * 24);
  }
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
