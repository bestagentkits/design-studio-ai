import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { documentSchema, type DesignNode, type DesignPage, type DesignDocument } from '../src/shared/schema';
import { resolveLayout } from '../src/shared/layout';
import { mutateDocument } from '../src/shared/operations';
import { renderSvg } from '../src/shared/render';

const node = (id: string, patch: Partial<DesignNode> = {}): DesignNode => ({ id, name: id, type: 'shape', x: 0, y: 0, width: 40, height: 30, ...patch });
const document = (nodes: DesignNode[], layout?: DesignPage['layout']) => ({ ...createDocument('web', 'Regression'), pages: [{ id: 'page', name: 'Page', width: 300, height: 200, background: '#fff', nodes, layout }] });
const box = (doc: DesignDocument, id: string) => { const n = resolveLayout(doc.pages[0]).nodes.find(n => n.id === id)!; return [n.x, n.y, n.width, n.height]; };

test('SVG evaluates local animation before resolving animated parent offsets', () => {
  const doc = document([node('parent', { type: 'group', x: 100, y: 60, layout: { mode: 'absolute' } }), node('child', { parentId: 'parent', x: 10, y: 5 })]);
  doc.timeline = { duration: 2, fps: 30, tracks: [
    { id: 'parent-track', nodeId: 'parent', keyframes: [{ time: 0, values: { x: 100 } }, { time: 2, values: { x: 200 } }] },
    { id: 'child-track', nodeId: 'child', keyframes: [{ time: 0, values: { x: 10 } }, { time: 2, values: { x: 30 } }] },
  ] };
  const before = structuredClone(doc);
  assert.match(renderSvg(doc, 0, 1), /data-node-id="child" transform="translate\(170 65\)/);
  assert.deepEqual(doc, before);
});

test('wrapped row fill uses remaining space on its own line', () => {
  const doc = document([node('a', { width: 200 }), node('b', { width: 200 }), node('fill', { sizing: { width: 'fill' } })], { mode: 'flex', direction: 'row', wrap: true, gap: 10, align: 'start' });
  assert.deepEqual(box(doc, 'a'), [0, 0, 200, 30]);
  assert.deepEqual(box(doc, 'b'), [0, 40, 200, 30]);
  assert.deepEqual(box(doc, 'fill'), [210, 40, 90, 30]);
});
test('wrapped columns allocate height independently and use constrained widths for line spacing', () => {
  const doc = document([node('a', { height: 150, width: 80 }), node('b', { height: 150 }), node('fill', { sizing: { height: 'fill' } })], { mode: 'flex', direction: 'column', wrap: true, gap: 10 });
  assert.deepEqual(box(doc, 'b'), [90, 0, 40, 150]);
  assert.deepEqual(box(doc, 'fill'), [90, 160, 40, 40]);
});
test('fill redistribution satisfies simultaneous minimum and maximum constraints', () => {
  const doc = document([node('a', { sizing: { width: 'fill', minWidth: 240 } }), node('b', { sizing: { width: 'fill', maxWidth: 90 } })], { mode: 'flex', direction: 'row' });
  assert.equal(box(doc, 'a')[2], 240); assert.equal(box(doc, 'b')[2], 60);
  const capped = document([node('a', { sizing: { width: 'fill', maxWidth: 40 } }), node('b', { sizing: { width: 'fill' } })], { mode: 'flex', direction: 'row', gap: 10 });
  assert.equal(box(capped, 'a')[2], 40); assert.deepEqual(box(capped, 'b'), [50, 0, 250, 30]);
});
test('wrapping respects fill minimums and justifies each row separately', () => {
  const doc = document([node('a', { width: 200 }), node('b', { width: 200 }), node('fill', { sizing: { width: 'fill', minWidth: 100 } })], { mode: 'flex', direction: 'row', wrap: true, justify: 'end', gap: 10 });
  assert.deepEqual(box(doc, 'a'), [100, 0, 200, 30]); assert.deepEqual(box(doc, 'b'), [100, 40, 200, 30]); assert.deepEqual(box(doc, 'fill'), [0, 80, 300, 30]);
});
test('absolute layout conversion preserves legacy page-space children and is not repeated', () => {
  const original = document([node('parent', { type: 'frame', x: 100, y: 80 }), node('child', { parentId: 'parent', x: 120, y: 95 })]);
  const next = mutateDocument(original, [{ op: 'update-node', nodeId: 'parent', changes: { layout: { mode: 'absolute' } } }]);
  assert.deepEqual(box(next, 'child'), [120, 95, 40, 30]);
  assert.equal(next.pages[0].nodes[1].x, 20); assert.equal(original.pages[0].nodes[1].x, 120);
  const again = mutateDocument(next, [{ op: 'update-node', nodeId: 'parent', changes: { layout: { mode: 'absolute' } } }]);
  assert.deepEqual(box(again, 'child'), box(next, 'child'));
});
test('nested flex to absolute freezes the resolved child position and fill size', () => {
  const original = document([node('outer', { type: 'frame', x: 50, y: 40, width: 200, height: 150, layout: { mode: 'absolute' } }), node('parent', { type: 'frame', parentId: 'outer', x: 20, y: 10, width: 150, height: 100, layout: { mode: 'flex', direction: 'row', padding: 10 } }), node('child', { parentId: 'parent', sizing: { width: 'fill' } })]);
  const next = mutateDocument(original, [{ op: 'update-node', nodeId: 'parent', changes: { layout: { mode: 'absolute' } } }]);
  assert.deepEqual(box(next, 'child'), box(original, 'child')); assert.equal(next.pages[0].nodes[2].sizing?.width, 'fixed');
});
test('page layout conversion preserves its children without adding an origin', () => {
  const original = document([node('a'), node('b')], { mode: 'flex', direction: 'row', padding: 15, gap: 10 });
  const next = mutateDocument(original, [{ op: 'update-page', pageId: 'page', changes: { layout: { mode: 'absolute' } } }]);
  assert.deepEqual(box(next, 'a'), box(original, 'a')); assert.deepEqual(box(next, 'b'), box(original, 'b'));
});
test('grouping uses measured hug bounds and parent page-space origin', () => {
  const original = document([node('parent', { type: 'frame', x: 100, y: 100, width: 500, layout: { mode: 'absolute' } }), node('text', { parentId: 'parent', type: 'text', text: 'Measured text', sizing: { width: 'hug' } })]);
  const next = mutateDocument(original, [{ op: 'group-nodes', pageId: 'page', nodeIds: ['text'], groupId: 'g', bounds: [{ id: 'text', x: 120, y: 130, width: 363, height: 30 }, { id: 'parent', x: 100, y: 100, width: 500, height: 30 }] }]);
  assert.deepEqual(box(next, 'g'), [120, 130, 363, 30]); assert.equal(next.pages[0].nodes.find(n => n.id === 'text')!.width, 363);
});
test('measured group bounds reject missing, duplicate, unrelated and nonfinite entries atomically', () => {
  const original = document([node('a'), node('b')]); const before = structuredClone(original);
  const valid = { id: 'a', x: 0, y: 0, width: 40, height: 30 };
  for (const bounds of [[], [valid, valid], [valid, { ...valid, id: 'b' }], [{ ...valid, width: Infinity }]]) assert.throws(() => mutateDocument(original, [{ op: 'group-nodes', pageId: 'page', nodeIds: ['a'], bounds }]));
  assert.deepEqual(original, before);
  const nested = document([node('parent', { type: 'group' }), node('child', { parentId: 'parent' })]);
  assert.throws(() => mutateDocument(nested, [{ op: 'group-nodes', pageId: 'page', nodeIds: ['child'], bounds: [{ ...valid, id: 'child' }] }]), /parent/);
});
test('grouping fill siblings freezes their previous dimensions', () => {
  const original = document([node('a', { sizing: { width: 'fill' } }), node('b', { sizing: { width: 'fill' } })], { mode: 'flex', direction: 'row', gap: 10 });
  const next = mutateDocument(original, [{ op: 'group-nodes', pageId: 'page', nodeIds: ['a', 'b'], groupId: 'g' }]);
  assert.equal(next.pages[0].nodes.find(n => n.id === 'a')!.sizing?.width, 'fixed');
  assert.equal(box(next, 'a')[2], 145); assert.equal(box(next, 'b')[2], 145);
});
test('duplicate clones a mixed-coordinate subtree, remaps internal interactions and animation', () => {
  const original = document([node('root', { type: 'group', x: 100, y: 100, layout: { mode: 'absolute' } }), node('frame', { type: 'frame', parentId: 'root', x: 10, y: 20 }), node('leaf', { parentId: 'frame', x: 120, y: 130, interactions: [{ trigger: 'click', action: 'toggle', target: 'root' }, { trigger: 'click', action: 'navigate', target: 'page' }, { trigger: 'click', action: 'url', target: 'https://example.com' }] })]);
  const animated = { ...original, timeline: { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'leaf', keyframes: [{ time: 0, values: { x: 120, opacity: .5 } }] }] } };
  const before = structuredClone(animated), next = mutateDocument(animated, [{ op: 'duplicate-node', nodeId: 'root', duplicateId: 'copy' }]);
  assert.equal(next.pages[0].nodes.length, 6); assert.deepEqual(animated, before);
  const copiedFrame = next.pages[0].nodes.find(n => n.parentId === 'copy')!, copiedLeaf = next.pages[0].nodes.find(n => n.parentId === copiedFrame.id)!;
  assert.deepEqual(box(next, 'copy').slice(0, 2), [124, 124]); assert.deepEqual(box(next, copiedFrame.id).slice(0, 2), [134, 144]); assert.deepEqual(box(next, copiedLeaf.id).slice(0, 2), [144, 154]);
  assert.equal(copiedLeaf.interactions![0].target, 'copy'); assert.equal(copiedLeaf.interactions![1].target, 'page'); assert.equal(copiedLeaf.interactions![2].target, 'https://example.com');
  const copiedTrack = next.timeline!.tracks.find(t => t.nodeId === copiedLeaf.id)!; assert.notEqual(copiedTrack.id, 'track'); assert.deepEqual(copiedTrack.keyframes[0].values, { x: 144, opacity: .5 });
  assert.equal(documentSchema.safeParse(next).success, true);
});
test('duplicate preserves local child animation coordinates and rejects ID collisions', () => {
  const original = document([node('root', { type: 'group', layout: { mode: 'absolute' } }), node('child', { parentId: 'root', x: 10 })]);
  const animated = { ...original, timeline: { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'child', keyframes: [{ time: 0, values: { x: 10 } }] }] } };
  const next = mutateDocument(animated, [{ op: 'duplicate-node', nodeId: 'root', duplicateId: 'copy', offset: { x: 50, y: 0 } }]);
  const child = next.pages[0].nodes.find(n => n.parentId === 'copy')!; assert.equal(child.x, 10); assert.equal(next.timeline!.tracks.find(t => t.nodeId === child.id)!.keyframes[0].values.x, 10);
  assert.throws(() => mutateDocument(animated, [{ op: 'duplicate-node', nodeId: 'root', duplicateId: 'child' }]));
});
test('structural edits convert animated coordinates by parent origins rather than measured pose', () => {
  const original = document([node('a', { x: 100, y: 80 })]);
  const animated = { ...original, timeline: { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'a', keyframes: [{ time: 0, values: { x: 100, y: 80 } }, { time: 2, values: { x: 200, y: 160 } }] }] } };
  const grouped = mutateDocument(animated, [{ op: 'group-nodes', pageId: 'page', nodeIds: ['a'], groupId: 'g', bounds: [{ id: 'a', x: 150, y: 120, width: 40, height: 30 }] }]);
  assert.deepEqual(grouped.timeline!.tracks[0].keyframes.map(k => k.values), [{ x: -50, y: -40 }, { x: 50, y: 40 }]);
  const ungrouped = mutateDocument(grouped, [{ op: 'ungroup-node', nodeId: 'g' }]);
  assert.deepEqual(ungrouped.timeline!.tracks[0].keyframes, animated.timeline.tracks[0].keyframes);
  const target = node('target', { type: 'group', x: 30, y: 20, layout: { mode: 'absolute' } });
  const reparented = mutateDocument({ ...animated, pages: [{ ...animated.pages[0], nodes: [...animated.pages[0].nodes, target] }] }, [{ op: 'reparent-node', nodeId: 'a', parentId: 'target', index: 0 }]);
  assert.deepEqual(reparented.timeline!.tracks[0].keyframes[0].values, { x: 70, y: 60 });
});
test('legacy absolute conversion subtracts the new local origin from existing keys', () => {
  const original = document([node('parent', { type: 'frame', x: 100, y: 80 }), node('child', { parentId: 'parent', x: 120, y: 95 })]);
  const animated = { ...original, timeline: { duration: 1, fps: 30, tracks: [{ id: 'track', nodeId: 'child', keyframes: [{ time: 0, values: { x: 130, y: 100 } }] }] } };
  const next = mutateDocument(animated, [{ op: 'update-node', nodeId: 'parent', changes: { layout: { mode: 'absolute' } } }]);
  assert.deepEqual(next.timeline!.tracks[0].keyframes[0].values, { x: 30, y: 20 });
});
