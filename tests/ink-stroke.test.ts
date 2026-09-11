import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InkInput, inkOutline, inkStrokeToSvg, hitTestInk } from '../src/shared/ink-stroke';
function trace(dt: number) {
  const input = new InkInput(false);
  return Array.from({ length: 81 }, (_, i) => input.sample(i * 3, 80, i * dt, .5));
}
test('timestamp velocity makes the same fast spatial trace substantially thinner than slow ink', () => {
  const slow = trace(20), fast = trace(1);
  assert.ok(slow[40].pressure > fast[40].pressure * 2);
  const thickness = (points: typeof slow) => { const middle = inkOutline(points, 24).filter(p => p[0] > 90 && p[0] < 150); return Math.max(...middle.map(p => p[1])) - Math.min(...middle.map(p => p[1])); };
  assert.ok(thickness(slow) > thickness(fast) * 1.8);
  assert.match(inkStrokeToSvg(slow, 24), / Q /);
  assert.equal(hitTestInk(slow, 24, 120, 80, 0), true);
  assert.equal(hitTestInk(slow, 24, 120, 110, 0), false);
});
test('pressure transitions filter velocity, retain actual pen pressure and validate time', () => {
  const input = new InkInput(false);
  let last = input.sample(0, 0, 0, .5);
  for (let i = 1; i < 100; i++) {
    const next = input.sample(i * 2, 0, i < 50 ? i * 20 : 1000 + (i - 50), .5);
    assert.ok(Math.abs(next.pressure - last.pressure) < .15); last = next;
  }
  const pen = new InkInput(true);
  assert.equal(pen.sample(0, 0, 0, .2).pressure, .2);
  assert.equal(pen.sample(100, 0, 1, .9).pressure, .9);
  assert.throws(() => pen.sample(101, 0, 0, .5), /backwards/);
  assert.throws(() => pen.sample(NaN, 0, 2, .5));
});
test('dots, repeated samples and completed taper remain finite and deterministic', () => {
  const dot = [{ x: 50, y: 50, pressure: .7 }];
  assert.ok(inkStrokeToSvg(dot, 16).length > 0);
  assert.equal(hitTestInk(dot, 16, 50, 50, 0), true);
  const points = trace(10);
  assert.equal(inkStrokeToSvg(points, 16), inkStrokeToSvg(structuredClone(points), 16));
  assert.doesNotMatch(inkStrokeToSvg([...dot, ...dot], 16), /NaN|Infinity/);
  assert.notEqual(inkStrokeToSvg(points, 16, false), inkStrokeToSvg(points, 16, true));
  assert.throws(() => inkStrokeToSvg([], 16));
});
