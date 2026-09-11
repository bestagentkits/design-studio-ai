import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaintRuntime, type PaintBrush } from '../src/shared/paint-runtime';
import { probeBrush } from '../scripts/board-paint-preview';
const points = [{ x: 40, y: 80, pressure: .8 }, { x: 100, y: 85, pressure: .6 }, { x: 180, y: 80, pressure: .9 }];
function runtime() { const p = new PaintRuntime(512, 512); p.addLayer('ink'); return p; }
test('incremental preview equals committed and one-shot pixels for every brush profile', () => {
  for (const name of ['bristle', 'dry', 'wash', 'smudge']) {
    const a = runtime(), b = runtime();
    const ground = probeBrush('bristle', 40, .8, '#3366bb'); a.stroke('ink', points, ground); b.stroke('ink', points, ground);
    const brush = probeBrush(name, 30, .8, '#dd5533'), live = a.beginStroke('ink', brush);
    for (const point of points) live.append([point]);
    const preview = live.copyTile(0, 0); live.commit(); b.stroke('ink', points, brush);
    assert.deepEqual(preview, a.copyTile('ink', 0, 0)); assert.deepEqual(preview, b.copyTile('ink', 0, 0));
  }
});
test('cancelled draft, failed append and stale generation leave committed pixels intact', () => {
  const p = runtime(), brush = probeBrush('bristle', 30, .8, '#dd5533');
  const live = p.beginStroke('ink', brush); live.append(points);
  assert.equal(p.copyTile('ink', 0, 0), undefined); assert.ok(live.copyTile(0, 0));
  live.cancel(); assert.throws(() => live.commit(), /closed/); assert.equal(p.copyTile('ink', 0, 0), undefined);
  const bad = p.beginStroke('ink', brush); bad.append(points);
  assert.throws(() => bad.append([{ x: NaN, y: 3, pressure: 1 }])); assert.throws(() => bad.commit(), /closed/);
  const stale = p.beginStroke('ink', brush); stale.append(points); p.configureLayer('ink', { locked: true });
  assert.throws(() => stale.commit(), /conflict/); assert.equal(p.copyTile('ink', 0, 0), undefined);
});
test('brush profiles produce distinct textured pixels; smudge carries real source color', () => {
  const tiles = ['bristle', 'dry', 'wash'].map(name => { const p = runtime(); p.stroke('ink', points, probeBrush(name, 40, .8, '#cc5533')); return p.copyTile('ink', 0, 0)!; });
  assert.notDeepEqual(tiles[0], tiles[1]); assert.notDeepEqual(tiles[0], tiles[2]);
  const p = runtime();
  const blue: PaintBrush = { size: 20, spacing: .2, flow: 1, opacity: 1, texture: 0, seed: 1, color: [0, 0, 255, 255], pickup: 0, deposit: 1 };
  p.stroke('ink', [points[0]], blue);
  p.stroke('ink', [points[0], { x: 110, y: 80, pressure: .8 }], probeBrush('smudge', 30, 1, '#ff0000'));
  const carried = p.pixel(100, 80); assert.ok(carried[2] > 200 && carried[0] === 0 && carried[3] > 0);
  const blank = runtime(); blank.stroke('ink', points, probeBrush('smudge', 30, 1, '#ff0000'));
  assert.equal(blank.allocatedBytes, 0);
});
test('copy-on-write forks retain both pixels and layer settings after future edits', () => {
  const p = runtime(); p.stroke('ink', points, probeBrush('bristle', 30, .8, '#cc5533'));
  const snapshot = p.fork(), bytes = snapshot.copyTile('ink', 0, 0);
  p.stroke('ink', points, probeBrush('wash', 60, .8, '#0033ff')); p.configureLayer('ink', { visible: false });
  assert.deepEqual(snapshot.copyTile('ink', 0, 0), bytes); assert.equal(snapshot.layerSettings[0].visible, true);
});

test('eraser removes alpha without recoloring or changing neighboring layers', () => {
  const p = runtime();
  p.stroke('ink', points, probeBrush('bristle', 40, 1, '#2255cc'));
  p.addLayer('upper'); p.stroke('upper', points, probeBrush('bristle', 40, 1, '#ff5533'));
  const lower = p.copyTile('ink', 0, 0), before = p.copyTile('upper', 0, 0)!;
  p.stroke('upper', points, probeBrush('erase', 40, 1, '#000000'));
  const after = p.copyTile('upper', 0, 0)!;
  assert.ok(after.some((value, i) => i % 4 === 3 && value < before[i]));
  for (let i = 0; i < after.length; i++) if (i % 4 !== 3) assert.equal(after[i], before[i]);
  assert.deepEqual(p.copyTile('ink', 0, 0), lower);
});
