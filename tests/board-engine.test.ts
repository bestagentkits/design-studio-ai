import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cubicPathBounds, cubicPathToSvg, flattenCubicPath, hitTestCubicPath, hitTestPressureStroke,
  pressureRadius, pressureStrokeToSvg, screenToWorld, transformedAnchor, validateBoardPoint, worldToScreen } from '../src/shared/board-geometry';
import type { BoardCubicPath } from '../src/shared/board-geometry';
const arch: BoardCubicPath = { start: { x: 0, y: 0 }, segments: [
  { control1: { x: 0, y: 100 }, control2: { x: 100, y: 100 }, end: { x: 100, y: 0 } },
] };
const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
test('world/screen inversion survives negative world coordinates, distant pans and supported zoom limits', () => {
  for (const zoom of [.01, .2, 1, 7.5, 100]) for (const point of [{ x: -123.75, y: 81.125 }, { x: 1_000_000, y: -1_000_000 }]) {
    const camera = { x: -600_000, y: 42_000, zoom };
    const restored = screenToWorld(worldToScreen(point, camera), camera);
    near(restored.x, point.x); near(restored.y, point.y);
  }
  assert.deepEqual(worldToScreen({ x: 15, y: 25 }, { x: 10, y: 20, zoom: 2 }), { x: 10, y: 10 });
});
test('cubic extrema are interior curve extrema rather than control-box bounds; editing remains structured', () => {
  assert.deepEqual(cubicPathBounds(arch), { x: 0, y: 0, width: 100, height: 75 });
  assert.equal(cubicPathToSvg(arch), 'M 0 0 C 0 100 100 100 100 0');
  const edited = structuredClone(arch);
  edited.segments[0].control1.y = edited.segments[0].control2.y = 200;
  assert.equal(cubicPathBounds(edited).height, 150);
  assert.equal(cubicPathBounds(arch).height, 75);
});
test('adaptive cubic geometry preserves closed-endpoint loops and a known midpoint', () => {
  const points = flattenCubicPath(arch, .01);
  assert.ok(points.some(p => p.x === 50 && p.y === 75));
  const loop = { start: { x: 0, y: 0 }, segments: [{ control1: { x: 100, y: 100 }, control2: { x: -100, y: 100 }, end: { x: 0, y: 0 } }] };
  assert.ok(flattenCubicPath(loop).length > 10);
  near(cubicPathBounds(loop).width, 100 / Math.sqrt(3));
});
test('curve hit testing follows visible stroke width and constant screen tolerance at each zoom', () => {
  for (const zoom of [.1, 1, 12, 100]) {
    const camera = { x: -30, y: 20, zoom };
    const apex = worldToScreen({ x: 50, y: 75 }, camera);
    assert.equal(hitTestCubicPath(arch, { x: apex.x, y: apex.y + zoom + 2 }, camera, 2, 3), true);
    assert.equal(hitTestCubicPath(arch, { x: apex.x, y: apex.y + zoom + 4 }, camera, 2, 3), false);
  }
});
test('normalized connector anchor follows element center rotation and flip', () => {
  const transform = { x: 10, y: 20, width: 100, height: 40, rotation: 90 };
  const right = transformedAnchor(transform, { x: 1, y: .5 });
  near(right.x, 60); near(right.y, 90);
  const flipped = transformedAnchor({ ...transform, flipX: true }, { x: 1, y: .5 });
  near(flipped.x, 60); near(flipped.y, -10);
  const center = transformedAnchor({ ...transform, flipY: true }, { x: .5, y: .5 });
  near(center.x, 60); near(center.y, 40);
});
test('pressure outline has deterministic round dots and widening ink, including duplicate samples', () => {
  const points = [{ x: 0, y: 0, pressure: 0 }, { x: 100, y: 0, pressure: 1 }];
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.equal(pressureRadius(0, 20), 1); assert.equal(pressureRadius(1, 20), 10);
  assert.equal(hitTestPressureStroke(points, { x: 10, y: 4 }, camera, 20, 0), false);
  assert.equal(hitTestPressureStroke(points, { x: 90, y: 4 }, camera, 20, 0), true);
  const dot = [{ x: 50, y: 50, pressure: 1 }];
  assert.equal(hitTestPressureStroke(dot, { x: 59, y: 50 }, camera, 20, 0), true);
  assert.equal(hitTestPressureStroke(dot, { x: 58, y: 58 }, camera, 20, 0), false);
  assert.match(pressureStrokeToSvg(dot, 20), / A 10 10 /);
  assert.equal(pressureStrokeToSvg(points, 20), pressureStrokeToSvg(structuredClone(points), 20));
  assert.doesNotMatch(pressureStrokeToSvg([...dot, ...dot], 20), /NaN|Infinity/);
  const enlarged = { ...camera, zoom: 4 };
  assert.equal(hitTestPressureStroke(dot, { x: 241, y: 200 }, enlarged, 20, 2), true);
  assert.equal(hitTestPressureStroke(dot, { x: 243, y: 200 }, enlarged, 20, 2), false);
});
test('an empty cubic path has no visible stroke even when marked closed', () => {
  assert.equal(hitTestCubicPath({ start: { x: 0, y: 0 }, segments: [], closed: true },
    { x: 0, y: 0 }, { x: 0, y: 0, zoom: 1 }, 10), false);
});
test('geometry rejects nonfinite coordinates, unsafe camera transforms and unbounded work', () => {
  for (const x of [NaN, Infinity, -Infinity, 1_000_001]) assert.throws(() => validateBoardPoint({ x, y: 0 }), RangeError);
  for (const zoom of [0, -1, NaN, Infinity, 101]) assert.throws(() => worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0, zoom }), RangeError);
  assert.throws(() => cubicPathToSvg({ ...arch, segments: Array(257).fill(arch.segments[0]) }), RangeError);
  assert.throws(() => cubicPathToSvg({ ...arch, start: { x: '0 onclick=alert(1)' as unknown as number, y: 0 } }), RangeError);
  assert.throws(() => pressureStrokeToSvg([], 4), RangeError);
  assert.throws(() => pressureStrokeToSvg(Array(4097).fill({ x: 0, y: 0, pressure: .5 }), 4), RangeError);
  assert.throws(() => pressureStrokeToSvg([{ x: 0, y: 0, pressure: 1.1 }], 4), RangeError);
  assert.throws(() => transformedAnchor({ x: 0, y: 0, width: 10, height: 10 }, { x: 2, y: .5 }), RangeError);
});
