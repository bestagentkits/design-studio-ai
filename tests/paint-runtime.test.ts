import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaintRuntime, type PaintBrush } from '../src/shared/paint-runtime';
const brush: PaintBrush = { size: 8, spacing: 0.25, flow: 1, opacity: 1, texture: 0, seed: 42, color: [255, 0, 0, 255], pickup: 0, deposit: 1 };
const point = (x: number, y = 8, pressure = 1) => ({ x, y, pressure });
function runtime(width = 64, height = 32, budget = 64) { const r = new PaintRuntime(width, height, budget); r.addLayer('a'); return r; }
test('sparse tiles allocate only painted regions and known source-over pixels', () => {
  const r = runtime(1024, 1024); assert.equal(r.allocatedBytes, 0);
  r.stroke('a', [point(8)], brush); assert.deepEqual(r.pixel(8, 8), [255, 0, 0, 255]);
  assert.equal(r.allocatedBytes, 512 * 512 * 4);
  r.addLayer('b'); r.stroke('b', [point(8)], { ...brush, color: [0, 0, 255, 128] });
  assert.deepEqual(r.pixel(8, 8), [127, 0, 128, 255]);
  r.configureLayer('b', { visible: false }); assert.deepEqual(r.pixel(8, 8), [255, 0, 0, 255]);
  r.configureLayer('b', { visible: true, opacity: 0 }); assert.deepEqual(r.pixel(8, 8), [255, 0, 0, 255]);
  r.configureLayer('b', { opacity: 1 }); r.moveLayer('a', 1); assert.deepEqual(r.pixel(8, 8), [255, 0, 0, 255]);
});
test('seeded grain repeats but seed and pressure affect deposited pixels', () => {
  const a = runtime(), b = runtime(), c = runtime();
  a.stroke('a', [point(8)], { ...brush, texture: 1 }); b.stroke('a', [point(8)], { ...brush, texture: 1 });
  c.stroke('a', [point(8)], { ...brush, texture: 1, seed: 73 });
  assert.deepEqual(a.pixel(8, 8), b.pixel(8, 8)); assert.notDeepEqual(a.pixel(8, 8), c.pixel(8, 8));
  const light = runtime(); light.stroke('a', [point(8, 8, 0.2)], brush);
  assert.equal(light.pixel(10, 8)[3], 0); assert.ok(a.pixel(10, 8)[3] > 0);
  const zero = runtime(); zero.stroke('a', [point(8, 8, 0)], brush); assert.equal(zero.allocatedBytes, 0);
});
test('spacing crosses point boundaries and paints continuous paths', () => {
  const a = runtime(), b = runtime();
  a.stroke('a', [point(8), point(28)], brush);
  b.stroke('a', [point(8), point(9), point(13), point(28)], brush);
  for (let x = 8; x <= 28; x++) { assert.equal(a.pixel(x, 8)[3], 255); assert.deepEqual(a.pixel(x, 8), b.pixel(x, 8)); }
});
test('pickup carries actual blue pixels into blank space independently of red brush overdraw', () => {
  const exact = runtime(); exact.stroke('a', [point(8)], { ...brush, color: [0, 0, 255, 255] });
  exact.stroke('a', [point(8)], { ...brush, pickup: 0.5 });
  assert.deepEqual(exact.pixel(8, 8), [128, 0, 128, 255]);
  const r = runtime(); r.stroke('a', [point(8)], { ...brush, color: [0, 0, 255, 255] });
  r.stroke('a', [point(8), point(24)], { ...brush, pickup: 0.5 });
  const result = r.pixel(24, 8); assert.ok(result[2] > result[0]); assert.ok(result[3] > 0);
  const ordinary = runtime(); ordinary.stroke('a', [point(8), point(24)], brush);
  assert.deepEqual(ordinary.pixel(24, 8), [255, 0, 0, 255]);
  const before = r.pixel(24, 8); r.stroke('a', [point(24)], { ...brush, deposit: 0 }); assert.deepEqual(r.pixel(24, 8), before);
});
test('invalid input, locked layers and memory rejection cannot partially mutate pixels', () => {
  const r = runtime(1024, 32, 1); r.stroke('a', [point(8)], brush); const before = r.pixel(8, 8);
  assert.throws(() => r.stroke('a', [point(8), point(600)], { ...brush, color: [0, 255, 0, 255] }), /budget/);
  assert.deepEqual(r.pixel(8, 8), before); assert.equal(r.pixel(510, 8)[3], 0);
  for (const bad of [NaN, Infinity, -1]) assert.throws(() => r.stroke('a', [point(bad)], brush), /Invalid/);
  assert.throws(() => r.stroke('a', [point(8)], { ...brush, size: Infinity }), /Invalid/);
  r.configureLayer('a', { locked: true }); assert.throws(() => r.stroke('a', [point(8)], brush), /locked/);
  assert.deepEqual(r.pixel(8, 8), before);
});
