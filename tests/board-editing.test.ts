import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardSchema, boardElementSchema, type Board } from '../src/shared/board-schema';
import { createDocument } from '../src/shared/catalog';
import { upgradeDocument } from '../src/shared/document-upgrade';
import { applyBoardEditingOperation, boardEditingSchema, duplicateBoardSelection, boardElementLocked } from '../src/shared/board-editing';
import { captureBoardSelection, duplicateBoardSelectionBundle } from '../src/shared/board-selection';
import { diagramNode, diagramEdge, diagramTemplate } from '../src/shared/diagram-presets';
import { diagramEndpoint } from '../src/shared/diagram-routing';
import { transformedAnchor } from '../src/shared/board-geometry';
function edit(board: Board, action: unknown) { const doc = upgradeDocument(createDocument('slides')); doc.boards.push(board); return upgradeDocument(applyBoardEditingOperation(doc, boardEditingSchema.parse(action))).boards[0]; }
const group = (id: string, parentId?: string) => boardElementSchema.parse({ type: 'group', id, name: id, x: 0, y: 0, width: 180, height: 80, parentId });
test('group transform updates descendants once and preserves connector bindings', () => {
  const a = diagramNode('a', 'flowchart', 'process', 'A'); a.parentId = 'g';
  const b = diagramNode('b', 'flowchart', 'process', 'B', 500); const edge = diagramEdge('e', 'a', 'b'); edge.parentId = 'g';
  const board = boardSchema.parse({ id: 'board', name: 'b', elements: [group('g'), a, b, edge] });
  const next = edit(board, { op: 'transform-board-elements', boardId: 'board', elementIds: ['g', 'a'], dx: 24 });
  assert.equal(next.elements.find(e => e.id === 'a')!.x, 24); assert.equal(next.elements.find(e => e.id === 'b')!.x, 500);
  const connected = next.elements.find(e => e.id === 'e'); assert.ok(connected?.type === 'connector'); assert.equal(connected.end.binding?.elementId, 'b');
});
test('ancestor lock blocks child edits', () => {
  const g = group('g'); g.locked = true; const a = diagramNode('a', 'flowchart', 'process', 'A'); a.parentId = g.id;
  const board = boardSchema.parse({ id: 'board', name: 'b', elements: [g, a] }); assert.equal(boardElementLocked(board, a), true);
  assert.throws(() => edit(board, { op: 'transform-board-elements', boardId: 'board', elementIds: ['a'], dx: 1 }), /Unlock/);
});
test('reflection of a rotated node matches reflected world anchors', () => {
  const a = diagramNode('a', 'flowchart', 'process', 'A'); a.rotation = 30;
  const board = boardSchema.parse({ id: 'board', name: 'b', elements: [a] }); const old = transformedAnchor(a, { x: 1, y: .5 });
  const next = edit(board, { op: 'transform-board-elements', boardId: 'board', elementIds: ['a'], flipX: true }); const point = transformedAnchor(next.elements[0], { x: 1, y: .5 });
  assert.ok(Math.abs(point.x - (180 - old.x)) < 1e-8); assert.ok(Math.abs(point.y - old.y) < 1e-8);
});
test('duplicate remaps internal bindings and snapshots detached external anchors', () => {
  const a = diagramNode('a', 'flowchart', 'process', 'A'), b = diagramNode('b', 'flowchart', 'process', 'B', 500), e = diagramEdge('e', 'a', 'b');
  const board = boardSchema.parse({ id: 'board', name: 'b', elements: [a, b, e] }); let i = 0;
  const copies = duplicateBoardSelection(board, ['a', 'e'], () => `copy${i++}`), edge = copies[1]; assert.ok(edge.type === 'connector');
  assert.equal(edge.start.binding?.elementId, copies[0].id); assert.equal(edge.end.binding, undefined);
  assert.deepEqual(edge.end.point, { x: 524, y: 64 });
});
test('clipboard roundtrip remaps mind-map topology', () => {
  const board = boardSchema.parse({ id: 'board', name: 'b', ...diagramTemplate('mind-map', 'm') });
  const captured = captureBoardSelection(board, board.elements.map(e => e.id)); let i = 0;
  const pasted = duplicateBoardSelectionBundle(captured, captured.elements.map(e => e.id), () => `new${i++}`);
  assert.equal(pasted.mindMap?.[1].parentId, pasted.mindMap?.[0].elementId); assert.notEqual(pasted.mindMap?.[0].elementId, 'm_n0');
});
test('nested ungroup preserves children and detached anchor positions', () => {
  const outer = group('outer'), inner = boardElementSchema.parse({ ...group('inner', 'outer'), type: 'frame', stroke: '#000000', fill: 'none', strokeWidth: 1, label: 'Inner' }), a = diagramNode('a', 'flowchart', 'process', 'A'); a.parentId = 'inner';
  const edge = diagramEdge('edge', 'inner', 'a'); const board = boardSchema.parse({ id: 'board', name: 'b', elements: [outer, inner, a, edge] }); const before = diagramEndpoint(board, edge.start);
  const next = edit(board, { op: 'ungroup-board-elements', boardId: 'board', elementIds: ['inner', 'outer'] });
  assert.equal(next.elements.find(e => e.id === 'a')!.parentId, undefined); const e = next.elements.find(e => e.id === 'edge'); assert.ok(e?.type === 'connector'); assert.equal(e.start.binding, undefined); assert.deepEqual(e.start.point, before);
});

test('path rebasing preserves every rotated and flipped control point', async () => {
  const { normalizeBoardPath } = await import('../src/shared/board-path-normalize');
  for (const rotation of [0, 37, -90]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const path = boardElementSchema.parse({ type: 'path', id: 'path', name: 'Curve', x: 120, y: 50, width: 80, height: 60, rotation, flipX, flipY, stroke: '#000000', fill: 'none', strokeWidth: 3, commands: [{ op: 'M', x: -40, y: -30 }, { op: 'C', x1: -20, y1: 140, x2: 140, y2: -70, x: 180, y: 100 }] });
    assert.ok(path.type === 'path');
    const world = () => path.commands.flatMap(command => {
      const c = command as unknown as Record<string, number>, result: { x: number; y: number }[] = [];
      for (const suffix of ['', '1', '2']) if (typeof c['x' + suffix] === 'number') {
        const angle = path.rotation * Math.PI / 180, x = (c['x' + suffix] - path.width / 2) * (path.flipX ? -1 : 1), y = (c['y' + suffix] - path.height / 2) * (path.flipY ? -1 : 1);
        result.push({ x: path.x + path.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: path.y + path.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) });
      } return result;
    });
    const before = world(); normalizeBoardPath(path); const after = world();
    before.forEach((p, i) => assert.ok(Math.hypot(p.x - after[i].x, p.y - after[i].y) < 1e-8));
    assert.equal(path.width, 220); assert.equal(path.height, 210);
  }
});
