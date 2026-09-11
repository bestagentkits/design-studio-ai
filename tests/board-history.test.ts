import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardHistory } from '../src/app/board-history';
import { createDocument } from '../src/shared/catalog';
import { mergeDocuments, MergeConflict } from '../src/shared/document-merge';

const initial = () => {
  const doc = createDocument('slides');
  doc.pages[0].nodes = [{ id: 'object', name: 'Object', type: 'shape', x: 0, y: 0, width: 100, height: 100 }];
  return doc;
};

test('an entire gesture is one undo and echoes do not duplicate history', () => {
  const h = new BoardHistory(initial(), 1, mergeDocuments);
  h.begin();
  for (let x = 1; x <= 100; x++) h.update(d => { d.pages[0].nodes[0].x = x; return d; });
  assert.equal(h.undoCount, 0);
  h.finish(); assert.equal(h.undoCount, 1);
  assert.equal(h.receive(h.committed, 2), true);
  assert.equal(h.receive(h.committed, 2), false);
  assert.equal(h.undo().pages[0].nodes[0].x, 0);
  assert.equal(h.redo().pages[0].nodes[0].x, 100);
});

test('late sync during gesture preserves remote edits through finish, undo and redo', () => {
  const d = initial(), h = new BoardHistory(d, 1, mergeDocuments);
  h.begin(); h.update(draft => { draft.pages[0].nodes[0].x = 50; return draft; });
  const remote = structuredClone(d); remote.pages[0].nodes[0].name = 'Remote name';
  h.receive(remote, 2);
  assert.equal(h.document.pages[0].nodes[0].name, 'Object');
  assert.equal(h.finish().pages[0].nodes[0].name, 'Remote name');
  assert.equal(h.undo().pages[0].nodes[0].name, 'Remote name');
  assert.equal(h.redo().pages[0].nodes[0].name, 'Remote name');
  assert.equal(h.remoteRevision, 2);
});

test('cancel after late sync discards only the draft', () => {
  const d = initial(), h = new BoardHistory(d, 1, mergeDocuments);
  h.begin(); h.update(draft => { draft.pages[0].nodes[0].x = 50; return draft; });
  const remote = structuredClone(d); remote.pages[0].nodes[0].x = 80;
  h.receive(remote, 2);
  assert.throws(() => h.finish(), MergeConflict);
  assert.equal(h.active, true); assert.equal(h.document.pages[0].nodes[0].x, 50);
  assert.equal(h.cancel().pages[0].nodes[0].x, 80);
  assert.equal(h.undoCount, 0);
});

test('undo cannot overwrite a later remote change to the same field', () => {
  const h = new BoardHistory(initial(), 1, mergeDocuments);
  h.begin(); h.update(d => { d.pages[0].nodes[0].x = 50; return d; }); h.finish();
  h.receive(h.committed, 2);
  const remote = h.committed; remote.pages[0].nodes[0].x = 80; h.receive(remote, 3);
  assert.throws(() => h.undo(), MergeConflict);
  assert.equal(h.undoCount, 1); assert.equal(h.committed.pages[0].nodes[0].x, 80);
});

test('caller mutations, invalid bounds and no-op gestures cannot corrupt history', () => {
  assert.throws(() => new BoardHistory(initial(), NaN, mergeDocuments));
  const d = initial(), h = new BoardHistory(d, 1, mergeDocuments, 1);
  d.pages[0].nodes[0].x = 99; h.document.pages[0].nodes[0].x = 88;
  assert.equal(h.document.pages[0].nodes[0].x, 0);
  h.begin(); h.finish(); assert.equal(h.undoCount, 0);
  for (const x of [10, 20]) { h.begin(); h.update(d => { d.pages[0].nodes[0].x = x; return d; }); h.finish(); }
  assert.equal(h.undoCount, 1); assert.equal(h.undo().pages[0].nodes[0].x, 10);
});
