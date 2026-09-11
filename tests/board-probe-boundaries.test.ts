import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardHistory } from '../src/app/board-history';
import { createDocument } from '../src/shared/catalog';
import { mergeDocuments, MergeConflict } from '../src/shared/document-merge';
import { PaintRuntime, type PaintBrush } from '../src/shared/paint-runtime';

const brush: PaintBrush = { size: 8, spacing: .25, flow: 1, opacity: 1, texture: 0,
  seed: 42, color: [255, 0, 0, 255], pickup: 0, deposit: 1 };
const point = (x: number) => ({ x, y: 8, pressure: 1 });
const initial = () => {
  const document = createDocument('slides');
  document.pages[0].nodes = [{ id: 'object', type: 'shape', name: 'Object', x: 0, y: 0, width: 100, height: 100 }];
  return document;
};

test('a rejected remote merge preserves revision and accepts a later nonconflicting snapshot', () => {
  const base = initial(), history = new BoardHistory(base, 1, mergeDocuments);
  history.begin(); history.update(d => { d.pages[0].nodes[0].x = 50; return d; }); history.finish();
  const conflict = structuredClone(base); conflict.pages[0].nodes[0].x = 80;
  assert.throws(() => history.receive(conflict, 2), MergeConflict);
  assert.equal(history.remoteRevision, 1);
  assert.equal(history.committed.pages[0].nodes[0].x, 50);
  const remote = structuredClone(base); remote.pages[0].nodes[0].name = 'Remote';
  assert.equal(history.receive(remote, 3), true);
  assert.equal(history.undo().pages[0].nodes[0].name, 'Remote');
  assert.equal(history.redo().pages[0].nodes[0].x, 50);
});

test('a new gesture after undo invalidates the old redo branch', () => {
  const history = new BoardHistory(initial(), 1, mergeDocuments);
  for (const x of [10, 20]) {
    history.begin(); history.update(d => { d.pages[0].nodes[0].x = x; return d; }); history.finish();
  }
  history.undo();
  history.begin(); history.update(d => { d.pages[0].nodes[0].x = 30; return d; }); history.finish();
  assert.equal(history.redo().pages[0].nodes[0].x, 30);
  assert.equal(history.undo().pages[0].nodes[0].x, 10);
});

test('tile budget spans layers and failed allocation preserves existing ink and layer order', () => {
  const runtime = new PaintRuntime(1024, 32, 2);
  runtime.addLayer('a'); runtime.addLayer('b');
  runtime.stroke('a', [point(8)], brush);
  runtime.stroke('b', [point(8)], { ...brush, color: [0, 0, 255, 255] });
  assert.throws(() => runtime.stroke('b', [point(8), point(600)], brush), /budget/);
  assert.equal(runtime.allocatedBytes, 2 * 512 * 512 * 4);
  assert.deepEqual(runtime.pixel(8, 8), [0, 0, 255, 255]);
  assert.deepEqual(runtime.pixel(600, 8), [0, 0, 0, 0]);
  runtime.moveLayer('a', 1);
  assert.deepEqual(runtime.pixel(8, 8), [255, 0, 0, 255]);
});

test('paint pixel snapshots cannot mutate empty pixels in the same or another runtime', () => {
  const runtime = new PaintRuntime(32, 32), other = new PaintRuntime(32, 32);
  runtime.addLayer('a'); other.addLayer('b');
  // JavaScript consumers are not protected by the TypeScript readonly annotation.
  const snapshot = runtime.pixel(8, 8, 'a') as unknown as number[];
  try {
    snapshot[0] = 123; snapshot[3] = 255;
    assert.deepEqual([...runtime.pixel(9, 9, 'a')], [0, 0, 0, 0]);
    assert.deepEqual(other.pixel(9, 9), [0, 0, 0, 0]);
  } finally {
    // Restore the caller-owned value even when a faulty runtime shares it.
    snapshot.fill(0);
  }
});
