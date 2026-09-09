import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import type { DesignNode } from '../src/shared/schema';
import { canMoveNode, isNodeProtected, localMovement, moveNodeTree, selectedRoots, toggleSelection } from '../src/app/editor-selection';
const node = (id: string, extra: Partial<DesignNode> = {}): DesignNode => ({ id, type: 'shape', name: id, x: 10, y: 20, width: 100, height: 50, ...extra });
test('selection toggles preserve order and selected ancestors own descendants once', () => {
  assert.deepEqual(toggleSelection(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleSelection(['a'], 'b'), ['a', 'b']);
  const page = createDocument('slides').pages[0];
  page.nodes = [node('a'), node('b', { parentId: 'a' }), node('c')];
  assert.deepEqual(selectedRoots(page, ['b', 'a', 'c']).map(n => n.id), ['a', 'c']);
});
test('locked ancestors, hidden ancestors, and locked subtree members protect batch mutations', () => {
  const page = createDocument('slides').pages[0];
  page.nodes = [node('locked', { locked: true }), node('child', { parentId: 'locked' }), node('hidden', { visible: false }), node('hidden-child', { parentId: 'hidden' }), node('group'), node('member', { parentId: 'group', locked: true }), node('free')];
  assert.equal(isNodeProtected(page, page.nodes[1]), true);
  assert.deepEqual(selectedRoots(page, page.nodes.map(n => n.id)).map(n => n.id), ['free']);
});
test('movement respects flow and translates legacy coordinates without shifting local children', () => {
  const page = createDocument('slides').pages[0];
  page.nodes = [node('root'), node('layout', { parentId: 'root', layout: { mode: 'absolute' } }), node('local', { parentId: 'layout' }), node('legacy', { parentId: 'local' })];
  const patches: string[] = [];
  moveNodeTree(page, page.nodes[0], 7, -2, (item, patch) => { patches.push(item.id); Object.assign(item, patch); });
  assert.deepEqual(patches, ['root', 'layout', 'legacy']);
  assert.equal(page.nodes[2].x, 10); assert.equal(page.nodes[3].x, 17);
  page.layout = { mode: 'flex' };
  assert.equal(canMoveNode(page, page.nodes[0]), false);
  page.nodes[0].position = 'absolute'; assert.equal(canMoveNode(page, page.nodes[0]), true);
});
test('canvas movement is converted through accumulated ancestor rotation', () => {
  const doc = createDocument('slides'), page = doc.pages[0];
  page.nodes = [node('parent', { rotation: 90 }), node('child', { parentId: 'parent' })];
  const delta = localMovement(doc, page, page.nodes[1], 0, 10, 0);
  assert.ok(Math.abs(delta.x) < 1e-10); assert.equal(delta.y, -10);
});
