import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { documentSchema, type DesignNode, type DesignPage } from '../src/shared/schema';
import { meshSchema, type MeshData } from '../src/shared/design-capabilities';
import { resolveLayout, subtree } from '../src/shared/layout';
import { ease } from '../src/shared/easing';
import { transformNode } from '../src/shared/transform';
import { mergeDocuments, MergeConflict } from '../src/shared/document-merge';
import { editMesh } from '../src/shared/mesh-editing';
import { duplicateDocument, mutateDocument } from '../src/shared/operations';
import { interpolateNode } from '../src/shared/render';

const node = (id: string, changes: Partial<DesignNode> = {}): DesignNode => ({ id, name: id, type: 'shape', x: 20, y: 30, width: 40, height: 20, ...changes });
const page = (nodes: DesignNode[], layout?: DesignPage['layout']): DesignPage => ({ id: 'page', name: 'Page', width: 300, height: 200, background: '#fff', nodes, layout });
const document = (nodes = [node('a'), node('b'), node('c')]) => ({ ...createDocument('web', 'Structured'), pages: [page(nodes)] });
const quad = (): MeshData => ({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3], uv: [0, 0, 1, 0, 1, 1, 0, 1] });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('legacy child coordinates remain in page space and layout does not mutate inputs', () => {
  const input = page([node('parent', { type: 'frame', x: 100, y: 100 }), node('child', { parentId: 'parent', x: 12, y: 13 })]);
  const before = structuredClone(input), output = resolveLayout(input);
  assert.equal(output.nodes[1].x, 12); assert.equal(output.nodes[1].y, 13);
  assert.deepEqual(input, before);
  assert.deepEqual([...subtree(input, 'parent')], ['parent', 'child']);
});
test('flex layout places fixed and fill children with padding and excludes absolute children', () => {
  const output = resolveLayout(page([node('a'), node('b', { sizing: { width: 'fill' } }), node('overlay', { position: 'absolute', x: 5 })], { mode: 'flex', direction: 'row', gap: 10, padding: 10, align: 'center' }));
  assert.deepEqual(output.nodes.map(n => [n.x, n.y, n.width]), [[10, 90, 40], [60, 90, 230], [5, 30, 40]]);
});
test('nested flex and hidden ancestors affect descendants', () => {
  const output = resolveLayout(page([node('parent', { type: 'frame', x: 100, y: 50, width: 180, height: 100, layout: { mode: 'flex', padding: 10, gap: 5 } }), node('child', { parentId: 'parent' }), node('next', { parentId: 'parent' })]));
  assert.deepEqual(output.nodes.slice(1).map(n => [n.x, n.y]), [[110, 60], [110, 85]]);
  const hidden = page([node('parent', { visible: false }), node('child', { parentId: 'parent' })]);
  assert.equal(resolveLayout(hidden).nodes[1].visible, false);
});
test('grid advances rows by their tallest child and fills column width', () => {
  const output = resolveLayout(page([node('a', { height: 30 }), node('b', { height: 60 }), node('c')], { mode: 'grid', columns: 2, gap: 10, padding: 10, align: 'stretch' }));
  assert.deepEqual(output.nodes.map(n => [n.x, n.y, n.width]), [[10, 10, 135], [155, 10, 135], [10, 80, 135]]);
});
test('flex wraps after the available width and sizes before positioning the next child', () => {
  const wrapped = resolveLayout(page([node('a', { width: 180 }), node('b', { width: 100 })], { mode: 'flex', direction: 'row', gap: 10, padding: 10, wrap: true }));
  assert.deepEqual(wrapped.nodes.map(n => [n.x, n.y]), [[10, 10], [10, 40]]);
  const constrained = resolveLayout(page([node('a', { width: 100, sizing: { maxWidth: 50 } }), node('b')], { mode: 'flex', direction: 'row', gap: 10 }));
  assert.equal(constrained.nodes[0].width, 50);
  assert.equal(constrained.nodes[1].x, 60);
});
test('hierarchy validates missing parents, multi-node cycles, and reparent operations atomically', () => {
  for (const nodes of [[node('a', { parentId: 'missing' })], [node('a', { parentId: 'b' }), node('b', { parentId: 'a' })]]) assert.equal(documentSchema.safeParse(document(nodes)).success, false);
  const input = document([node('parent', { type: 'frame' }), node('child', { type: 'group', parentId: 'parent' }), node('leaf', { parentId: 'child' })]);
  const before = structuredClone(input);
  assert.throws(() => mutateDocument(input, [{ op: 'reparent-node', nodeId: 'parent', parentId: 'child', index: 0 }]), /cyclic/);
  assert.deepEqual(input, before);
  assert.throws(() => mutateDocument(input, [{ op: 'reparent-node', nodeId: 'child', parentId: 'leaf', index: 0 }]), /container/);
  assert.equal(mutateDocument(input, [{ op: 'remove-node', nodeId: 'parent' }]).pages[0].nodes.length, 0);
});
test('duplication remaps hierarchy, interactions and timeline references together', () => {
  const input = document([node('parent', { type: 'frame' }), node('child', { parentId: 'parent', interactions: [{ trigger: 'click', action: 'navigate', target: 'page' }, { trigger: 'click', action: 'toggle', target: 'parent' }] })]);
  input.timeline = { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'child', keyframes: [] }] };
  const output = duplicateDocument(input), [parent, child] = output.pages[0].nodes;
  assert.notEqual(parent.id, 'parent'); assert.equal(child.parentId, parent.id);
  assert.equal(child.interactions![0].target, output.pages[0].id);
  assert.equal(child.interactions![1].target, parent.id);
  assert.equal(output.timeline!.tracks[0].nodeId, child.id);
});
test('keyframe edits are sorted, collision checked and blocked by track locks', () => {
  const input = document();
  input.timeline = { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'a', keyframes: [{ time: 0, values: { x: 0 } }, { time: 2, values: { x: 20 } }] }] };
  const output = mutateDocument(input, [{ op: 'upsert-keyframe', trackId: 'track', keyframe: { time: 1, values: { x: 10 }, easing: 'easeIn' } }]);
  assert.deepEqual(output.timeline!.tracks[0].keyframes.map(k => k.time), [0, 1, 2]);
  assert.throws(() => mutateDocument(output, [{ op: 'upsert-keyframe', trackId: 'track', previousTime: 1, keyframe: { time: 2, values: { x: 30 } } }]), /unique/);
  output.timeline!.tracks[0].locked = true;
  assert.throws(() => mutateDocument(output, [{ op: 'remove-keyframe', trackId: 'track', time: 1 }]), /Unlock/);
  assert.throws(() => mutateDocument(input, [{ op: 'upsert-keyframe', trackId: 'track', keyframe: { time: 3, values: { x: 10 } } }]), /duration/);
});
test('easing clamps endpoints, supports cubic bezier and preserves a step until the end', () => {
  for (const curve of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'spring', 'step', [.42, 0, .58, 1]] as const) {
    const easing = Array.isArray(curve) ? [...curve] as [number, number, number, number] : curve as 'linear';
    assert.equal(ease(-1, easing), 0); assert.equal(ease(2, easing), 1);
    assert.ok(Number.isFinite(ease(.5, easing)));
  }
  close(ease(.5, [.42, 0, .58, 1]), .5);
  assert.equal(ease(.999, 'step'), 0); assert.equal(ease(.5, 'easeIn'), .125);
});
test('transforms preserve opposite edges, respect rotation and constrain aspect ratio', () => {
  const original = node('a', { x: 0, y: 0, width: 100, height: 50 });
  assert.deepEqual(transformNode(original, 10, 20, 'move'), { x: 10, y: 20 });
  assert.deepEqual(transformNode(original, 10, 0, 'w'), { x: 10, y: 0, width: 90, height: 50 });
  const constrained = transformNode(original, 40, 0, 'se', true);
  assert.equal(constrained.width! / constrained.height!, 2);
  const rotated = transformNode({ ...original, rotation: 90 }, 0, 20, 'e');
  close(rotated.width!, 120); close(rotated.x!, -10); close(rotated.y!, 10);
  assert.equal(transformNode(original, -200, 0, 'e').width, 8);
});
test('scene and bone interpolation applies easing without changing source vectors', () => {
  const original = node('mesh', { type: 'model3d', scene: { position: [2, 3, 4], bones: [{ name: 'root', parent: -1, position: [0, 0, 0] }] } });
  const input = document([original]), before = structuredClone(original);
  input.timeline = { duration: 2, fps: 30, tracks: [{ id: 'track', nodeId: 'mesh', keyframes: [
    { time: 0, values: { 'scene.position.x': 2, 'scene.scale.y': 1, 'scene.rotation.z': 0, 'scene.bones.0.rotation.z': 0, 'scene.bones.0.position.y': 0 }, easing: 'easeIn' },
    { time: 2, values: { 'scene.position.x': 10, 'scene.scale.y': 9, 'scene.rotation.z': 80, 'scene.bones.0.rotation.z': 80, 'scene.bones.0.position.y': 8 } },
  ] }] };
  const output = interpolateNode(original, input, 1);
  assert.deepEqual(output.scene!.position, [3, 3, 4]); assert.deepEqual(output.scene!.scale, [.1, 2, .1]);
  assert.deepEqual(output.scene!.rotation, [0, 0, 10]); assert.deepEqual(output.scene!.bones![0].rotation, [0, 0, 10]);
  assert.deepEqual(output.scene!.bones![0].position, [0, 1, 0]); assert.deepEqual(original, before);
  input.timeline.tracks[0].muted = true;
  assert.deepEqual(interpolateNode(original, input, 1).scene, before.scene);
});
test('three-way merge combines independent fields, insertions, and unchanged deletions', () => {
  const base = document(), local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].nodes[0].x = 80; remote.pages[0].nodes[0].y = 90;
  local.pages[0].nodes.push(node('local')); remote.pages[0].nodes.push(node('remote'));
  local.pages[0].nodes = local.pages[0].nodes.filter(n => n.id !== 'b');
  const merged = mergeDocuments(base, local, remote);
  assert.equal(merged.pages[0].nodes[0].x, 80); assert.equal(merged.pages[0].nodes[0].y, 90);
  assert.deepEqual(new Set(merged.pages[0].nodes.map(n => n.id)), new Set(['a', 'c', 'local', 'remote']));
  assert.equal(base.pages[0].nodes[0].x, 20);
});
test('three-way merge reports same-field, delete-versus-edit, and incompatible order conflicts', () => {
  const base = document();
  for (const scenario of ['field', 'deletion', 'order']) {
    const local = structuredClone(base), remote = structuredClone(base);
    if (scenario === 'field') { local.pages[0].nodes[0].x = 1; remote.pages[0].nodes[0].x = 2; }
    if (scenario === 'deletion') { local.pages[0].nodes.shift(); remote.pages[0].nodes[0].y = 1; }
    if (scenario === 'order') { local.pages[0].nodes.reverse(); remote.pages[0].nodes.push(remote.pages[0].nodes.shift()!); }
    assert.throws(() => mergeDocuments(base, local, remote), (error: unknown) => error instanceof MergeConflict && error.paths.some(path => path.includes(scenario === 'order' ? '.order' : '[a]')));
  }
});
test('undo after autosave merges against the sent snapshot and preserves a remote field change', () => {
  const beforeEdit = document(), sending = structuredClone(beforeEdit);
  sending.pages[0].nodes[0].x = 80;
  const remote = structuredClone(sending), undone = structuredClone(beforeEdit);
  remote.pages[0].nodes[0].y = 90;
  remote.metadata.updatedAt = '2026-09-08T10:00:00.000Z';
  const output = mergeDocuments(sending, undone, remote);
  assert.equal(output.pages[0].nodes[0].x, 20); assert.equal(output.pages[0].nodes[0].y, 90);
  assert.equal(output.metadata.updatedAt, remote.metadata.updatedAt);
  const redone = structuredClone(output); redone.pages[0].nodes[0].x = 80;
  const newerRemote = structuredClone(output); newerRemote.pages[0].nodes[1].y = 120;
  const final = mergeDocuments(output, redone, newerRemote);
  assert.equal(final.pages[0].nodes[0].x, 80); assert.equal(final.pages[0].nodes[0].y, 90);
  assert.equal(final.pages[0].nodes[1].y, 120);
});
test('extrusion lifts the selected surface and only bridges its boundary edges', () => {
  const input = quad(), before = structuredClone(input), output = editMesh(input, { op: 'extrude', selection: [0, 1], amount: 2 });
  assert.equal(output.positions.length / 3, 8); assert.equal(output.indices.length / 3, 10);
  assert.deepEqual(output.positions.slice(12).filter((_, i) => i % 3 === 2), [2, 2, 2, 2]);
  assert.equal(output.uv!.length, 16); assert.deepEqual(input, before);
});
test('subdivision shares edge midpoints and interpolates UV coordinates', () => {
  const output = editMesh(quad(), { op: 'subdivide', selection: [] });
  assert.equal(output.positions.length / 3, 9); assert.equal(output.indices.length / 3, 8);
  const center = Array.from({ length: 9 }, (_, i) => i).find(i => output.positions[i * 3] === .5 && output.positions[i * 3 + 1] === .5)!;
  assert.deepEqual(output.uv!.slice(center * 2, center * 2 + 2), [.5, .5]);
  assert.equal(meshSchema.safeParse(output).success, true);
});
test('mesh edits reject unknown selections and malformed geometry', () => {
  assert.throws(() => editMesh(quad(), { op: 'translate', selection: [99] }), /Unknown vertex/);
  assert.throws(() => editMesh(quad(), { op: 'extrude', selection: [99] }), /Unknown face/);
  assert.throws(() => editMesh(quad(), { op: 'subdivide', selection: [99] }), /Unknown face/);
  assert.equal(meshSchema.safeParse({ ...quad(), indices: [0, 1, 99] }).success, false);
  assert.equal(meshSchema.safeParse({ ...quad(), uv: [0, 0] }).success, false);
});
test('UV projection is finite and skinning permits vertex edits but rejects topology edits', () => {
  for (const op of ['uv-planar', 'uv-sphere'] as const) {
    const uv = editMesh(quad(), { op, selection: [] }).uv!;
    assert.equal(uv.length, 8); assert.ok(uv.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  }
  const skinned = { ...quad(), skinIndices: Array(16).fill(0), skinWeights: Array.from({ length: 16 }, (_, i) => i % 4 ? 0 : 1) };
  for (const op of ['extrude', 'inset', 'delete-faces', 'subdivide', 'weld'] as const) assert.throws(() => editMesh(skinned, { op, selection: [0] }), /unskinned/);
  const translated = editMesh(skinned, { op: 'translate', selection: [0], vector: [1, 2, 3] });
  assert.deepEqual(translated.positions.slice(0, 3), [1, 2, 3]); assert.deepEqual(translated.skinWeights, skinned.skinWeights);
  assert.equal(documentSchema.safeParse(document([node('mesh', { type: 'model3d', scene: { mesh: skinned } })])).success, false);
});
