import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagramTemplate, diagramNode, diagramEdge } from '../src/shared/diagram-presets';
import { diagramEndpoint, diagramConnectorPoints, orthogonalRoute, diagramLabelPoint } from '../src/shared/diagram-routing';
import { layoutDiagram, prepareDiagramLayout, acceptDiagramLayout, diagramHiddenIds } from '../src/shared/diagram-layout';
import { applyDiagramOperation, diagramValidationErrors } from '../src/shared/diagram-operations';
import { boardSchema } from '../src/shared/board-schema';
import { createDocument } from '../src/shared/catalog';
import { upgradeDocument } from '../src/shared/document-upgrade';
import { diagramNodeSvg } from '../src/shared/diagram-render';
for (const family of ['flowchart', 'architecture', 'user-flow', 'mind-map'] as const) test(`${family} template preserves editable graph and labels`, () => {
  const board = boardSchema.parse({ id: 'b', name: family, ...diagramTemplate(family, family) });
  assert.ok(board.elements.length >= 7); assert.deepEqual(diagramValidationErrors(board), []);
  const laid = layoutDiagram(board, family === 'mind-map' ? 'tree' : 'layered');
  assert.equal(laid.elements.length, board.elements.length);
});
test('orthogonal routing avoids a blocking rectangle and keeps endpoints', () => {
  const path = orthogonalRoute({ x: 0, y: 50 }, { x: 300, y: 50 }, [{ x: 100, y: 0, width: 100, height: 100 }]);
  assert.deepEqual(path[0], { x: 0, y: 50 }); assert.deepEqual(path.at(-1), { x: 300, y: 50 });
  assert.ok(path.some(p => p.y === 0 || p.y === 100));
  assert.ok(path.every((p, i) => !i || p.x === path[i - 1].x || p.y === path[i - 1].y));
});
test('bound endpoints follow rotated ports and manual bends survive layouts', () => {
  const source = diagramNode('a', 'flowchart', 'process', 'A'); source.rotation = 90;
  const edge = diagramEdge('edge', 'a', 'b'); edge.bends = [{ x: 400, y: 20 }];
  const board = boardSchema.parse({ id: 'b1', name: 'test', elements: [source, diagramNode('b', 'flowchart', 'end', 'B', 600), edge] });
  const endpoint = diagramEndpoint(board, edge.start); assert.ok(Math.abs(endpoint.x - 90) < 1e-6); assert.equal(endpoint.y, 130);
  assert.deepEqual(diagramConnectorPoints(board, edge)[1], edge.bends[0]);
  const result = layoutDiagram(board, 'layered'); assert.deepEqual(result.elements.find(e => e.id === 'edge'), edge);
});
test('selected layout preserves locked nodes and rejects stale results', () => {
  const board = boardSchema.parse({ id: 'b', name: 'test', ...diagramTemplate('flowchart', 'f') }); board.elements[1].locked = true;
  const result = layoutDiagram(board, 'layered', ['f_n0', 'f_n1']);
  assert.deepEqual(result.elements[1], board.elements[1]); assert.deepEqual(result.elements[2], board.elements[2]);
  const ticket = prepareDiagramLayout(board, 'layered'); board.elements[0].x++;
  assert.throws(() => acceptDiagramLayout(board, [], ticket), /changed/);
});
test('mind-map collapse hides descendants and edges without deleting semantic state', () => {
  const board = boardSchema.parse({ id: 'b', name: 'test', ...diagramTemplate('mind-map', 'm') }); board.mindMap![0].collapsed = true;
  const hidden = diagramHiddenIds(board); assert.ok(hidden.has('m_n1')); assert.ok(hidden.has('m_e0')); assert.equal(board.elements.length, 7);
  board.mindMap![0].parentId = 'm_n1'; assert.ok(diagramValidationErrors(board).some(e => /cycle/.test(e)));
});
test('semantic operations insert, connect, detach and preserve source documents', () => {
  let doc = upgradeDocument(createDocument('slides')); doc.boards.push(boardSchema.parse({ id: 'board', name: 'test', elements: [] }));
  const initial = structuredClone(doc);
  doc = upgradeDocument(applyDiagramOperation(doc, { op: 'diagram-template', boardId: 'board', family: 'mind-map', prefix: 'map' }));
  doc = upgradeDocument(applyDiagramOperation(doc, { op: 'mind-map-insert', boardId: 'board', relativeId: 'map_n1', relation: 'sibling', id: 'new', label: 'New sibling' }));
  assert.equal(doc.boards[0].mindMap!.find(n => n.elementId === 'new')?.parentId, 'map_n0');
  doc = upgradeDocument(applyDiagramOperation(doc, { op: 'diagram-detach', boardId: 'board', edgeId: 'new_edge', endpoint: 'start' }));
  const edge = doc.boards[0].elements.find(e => e.id === 'new_edge'); assert.ok(edge?.type === 'connector' && !edge.start.binding);
  assert.equal(initial.boards[0].elements.length, 0);
});
test('label placement follows route length and semantic SVG escapes user text', () => {
  assert.deepEqual(diagramLabelPoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), { x: 100, y: 0 });
  const svg = diagramNodeSvg(diagramNode('x', 'flowchart', 'process', '<script>'), createDocument('slides'));
  assert.match(svg, /&lt;script&gt;/); assert.doesNotMatch(svg, /<script>/);
});

test('new diagram templates avoid existing artwork and earlier template ports', () => {
  let doc = upgradeDocument(createDocument('slides')); doc.boards.push(boardSchema.parse({ id: 'board', name: 'test', elements: [diagramNode('art', 'flowchart', 'process', 'Artwork', 60, 80)] }));
  for (const family of ['flowchart', 'architecture', 'user-flow', 'mind-map'] as const) doc = upgradeDocument(applyDiagramOperation(doc, { op: 'diagram-template', boardId: 'board', family, prefix: family }));
  for (const element of doc.boards[0].elements) if (element.type === 'connector') assert.ok(diagramConnectorPoints(doc.boards[0], element).length >= 2);
});
test('large boards route against all obstacles without rejecting the count alone', () => {
  const boxes = Array.from({ length: 600 }, (_, i) => ({ x: 100 + i % 30 * 260, y: Math.floor(i / 30) * 200, width: 180, height: 80 }));
  const route = orthogonalRoute({ x: 0, y: 120 }, { x: 9000, y: 120 }, boxes);
  assert.deepEqual(route, [{ x: 0, y: 120 }, { x: 9000, y: 120 }]);
});

test('pointer bindings choose transformed declared ports instead of node centers', async () => {
  const { nearestDiagramBinding } = await import('../src/shared/diagram-routing');
  const node = diagramNode('node', 'flowchart', 'process', 'Node', 100, 100); node.rotation = 90;
  const binding = nearestDiagramBinding(node, { x: 190, y: 235 });
  assert.equal(binding.elementId, 'node'); assert.equal(binding.port, 'right');
  assert.deepEqual(binding.anchor, { x: 1, y: .5 });
});

test('architecture layout keeps owned nodes inside their system boundary', () => {
  const board = boardSchema.parse({ id: 'board', name: 'architecture', ...diagramTemplate('architecture', 'arch') });
  const next = layoutDiagram(board, 'layered');
  const boundary = next.elements.find(e => e.type === 'frame')!;
  for (const node of next.elements.filter(e => e.parentId === boundary.id)) {
    assert.ok(node.x >= boundary.x && node.y >= boundary.y);
    assert.ok(node.x + node.width <= boundary.x + boundary.width && node.y + node.height <= boundary.y + boundary.height);
  }
});
