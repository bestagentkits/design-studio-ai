import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { documentSchema } from '../src/shared/schema';
import { upgradeDocument, restoreDocumentSnapshot } from '../src/shared/document-upgrade';
import { boardElementSchema } from '../src/shared/board-schema';
import { paintingSchema } from '../src/shared/painting-schema';
import { mutateDocument } from '../src/shared/operations';
import { mergeDocuments, MergeConflict } from '../src/shared/document-merge';
import { publicCreativeProjection } from '../src/shared/public-creative-projection';
import { remapDocumentAssets } from '../src/shared/document-asset-references';
import { renderSvg } from '../src/shared/render';

function fixture() {
  const doc = upgradeDocument(createDocument('web', 'Creative'));
  doc.boards.push({ id: 'board-a', name: 'Sketches', background: '#ffffff', elements: [boardElementSchema.parse({ id: 'stroke-a', name: 'Ink', type: 'stroke', x: 0, y: 0, width: 200, height: 100, stroke: '#123456', fill: 'none', strokeWidth: 16, algorithm: 'perfect-freehand-1.2.3', points: [{ x: 10, y: 10, pressure: .2 }, { x: 100, y: 40, pressure: .8 }] })] });
  doc.pages[0].nodes.push({ id: 'embed-a', type: 'board', name: 'Sketch', x: 0, y: 0, width: 640, height: 480, boardId: 'board-a', crop: { x: 0, y: 0, width: 640, height: 480 } });
  return doc;
}
const painting = (id = 'painting-a') => paintingSchema.parse({ id, name: 'Paint', width: 512, height: 512, generation: 0, colorSpace: 'srgb', algorithm: 'cpu-srgb-grain-v1', tileSize: 512, layers: [{ id: id + '-layer', name: 'Paint layer', visible: true, locked: false, opacity: 1, blend: 'normal', tiles: [] }] });

test('v2 upgrade is pure, keeps v1 content, and rejects downgrade/unknown versions instead of stripping roots', () => {
  const legacy = createDocument('web', 'Legacy'), before = structuredClone(legacy), doc = upgradeDocument(legacy);
  assert.deepEqual(legacy, before); assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(doc.pages, legacy.pages); assert.deepEqual(doc.metadata, legacy.metadata);
  assert.equal(documentSchema.parse(fixture()).schemaVersion, 2);
  assert.throws(() => documentSchema.parse({ ...doc, schemaVersion: 1 }));
  assert.throws(() => documentSchema.parse({ ...legacy, schemaVersion: 3 }));
  assert.equal(restoreDocumentSnapshot(doc, legacy).schemaVersion, 2);
});
test('board ink survives canonical operations, SVG rendering, independent embed duplication and connector deletion', () => {
  const doc = fixture(), duplicate = mutateDocument(doc, [{ op: 'duplicate-node', nodeId: 'embed-a' }]);
  assert.equal(duplicate.schemaVersion, 2); if (duplicate.schemaVersion !== 2) return;
  assert.equal(duplicate.boards.length, 2); assert.notEqual(duplicate.boards[0].elements[0].id, duplicate.boards[1].elements[0].id);
  assert.match(renderSvg(duplicate), /data-board-element="stroke-a"/); assert.match(renderSvg(duplicate), / Q /);
  const connector = boardElementSchema.parse({ id: 'edge', type: 'connector', name: 'Link', x: 0, y: 0, width: 1, height: 1, stroke: '#123456', fill: 'none', strokeWidth: 2, start: { point: { x: 0, y: 0 }, binding: { elementId: 'stroke-a', anchor: { x: 1, y: .5 } } }, end: { point: { x: 300, y: 200 } }, routing: 'elbow', bends: [], startArrow: 'none', endArrow: 'arrow' });
  const linked = mutateDocument(doc, [{ op: 'upsert-board-elements', boardId: 'board-a', elements: [connector] }]);
  const removed = mutateDocument(linked, [{ op: 'remove-board-elements', boardId: 'board-a', elementIds: ['stroke-a'] }]);
  assert.equal(removed.schemaVersion === 2 && removed.boards[0].elements.length, 0);
});
test('painting edits conflict as a whole while independent paintings merge; undo increases generation', () => {
  const base = fixture(); base.paintings = [painting(), painting('painting-b')];
  const local = structuredClone(base), remote = structuredClone(base);
  local.paintings[0].generation++; local.paintings[0].layers[0].opacity = .5;
  remote.paintings[0].generation++; remote.paintings[0].layers[0].name = 'Remote';
  assert.throws(() => mergeDocuments(base, local, remote), MergeConflict);
  remote.paintings[0] = structuredClone(base.paintings[0]); remote.paintings[1].generation++; remote.paintings[1].layers[0].name = 'Other';
  const merged = mergeDocuments(base, local, remote); assert.equal(merged.schemaVersion, 2);
  const restored = restoreDocumentSnapshot(local, base); assert.equal(restored.schemaVersion === 2 && restored.paintings[0].generation, 2);
});
test('painting composite-only refresh merges with local painting source edits and retained assets', () => {
  const base = fixture(), art = painting();
  art.composite = { assetId: 'preview-a', sourceHash: 'b'.repeat(64), generation: 0 }; base.paintings = [art];
  base.assets = [{ id: 'preview-a', name: 'Preview A', type: 'image', mimeType: 'image/png', url: '/api/assets/preview-a' }];
  const local = structuredClone(base), remote = structuredClone(base);
  delete local.paintings[0].composite; local.paintings[0].generation++; local.paintings[0].layers[0].opacity = .5;
  remote.assets.push({ id: 'preview-b', name: 'Preview B', type: 'image', mimeType: 'image/png', url: '/api/assets/preview-b' });
  remote.paintings[0].composite = { assetId: 'preview-b', sourceHash: 'b'.repeat(64), generation: 0 };
  const merged = mergeDocuments(base, local, remote);
  assert.equal(merged.schemaVersion, 2); assert.equal(merged.paintings[0].generation, 1);
  assert.equal(merged.paintings[0].layers[0].opacity, .5); assert.equal(merged.paintings[0].composite, undefined);
  assert.deepEqual(merged.assets.map(a => a.id).sort(), ['preview-a', 'preview-b']);
  const sourceChanged = structuredClone(base); sourceChanged.paintings[0].generation++; sourceChanged.paintings[0].layers[0].name = 'Remote';
  assert.throws(() => mergeDocuments(base, local, sourceChanged), MergeConflict);
});
test('nested asset remapping covers textures, board media, paint masks/tiles and composites', () => {
  const doc = fixture(), art = painting();
  const old = { id: 'old', name: 'Tile', type: 'image', mimeType: 'image/png', url: '/api/assets/old' }, next = { ...old, id: 'new', url: '/api/assets/new' };
  doc.assets = [old]; art.layers[0].tiles = [{ x: 0, y: 0, assetId: 'old', hash: 'a'.repeat(64), generation: 0 }];
  art.layers[0].mask = { enabled: true, tiles: structuredClone(art.layers[0].tiles) }; art.composite = { assetId: 'old', sourceHash: 'b'.repeat(64), generation: 0 }; doc.paintings.push(art);
  remapDocumentAssets(doc, new Map([['old', next]]));
  assert.equal(doc.paintings[0].layers[0].mask?.tiles[0].assetId, 'new'); assert.equal(doc.paintings[0].composite?.assetId, 'new');
  assert.equal(documentSchema.parse(doc).schemaVersion, 2);
});
test('public projection excludes hidden board data and all original painting pixels', () => {
  const doc = fixture(), art = painting(); art.layers[0].tiles = [{ x: 0, y: 0, assetId: 'secret-tile', hash: 'a'.repeat(64), generation: 0 }]; art.composite = { assetId: 'public-pixels', generation: 0, sourceHash: 'b'.repeat(64) }; doc.paintings.push(art);
  doc.assets = ['secret-tile', 'public-pixels', 'unused-secret'].map(id => ({ id, name: id, type: 'image', mimeType: 'image/png', url: `/api/assets/${id}` }));
  doc.boards[0].elements[0].visible = false; doc.boards[0].elements[0].name = 'Secret note';
  doc.pages[0].nodes.push({ id: 'paint-embed', type: 'artwork', name: 'Art', x: 0, y: 0, width: 512, height: 512, paintingId: art.id });
  const result = publicCreativeProjection(doc), text = JSON.stringify(result);
  assert.doesNotMatch(text, /secret-tile|unused-secret|Secret note/); assert.match(text, /public-pixels/);
  assert.equal(result.schemaVersion === 2 && result.paintings.length, 0); assert.equal(documentSchema.parse(result).schemaVersion, 2);
});
test('blank board painting embeds render while nonblank paintings still require composites', () => {
  const blank = fixture(), blankPaint = painting('blank-paint');
  blank.paintings.push(blankPaint);
  blank.boards[0].elements.push(boardElementSchema.parse({ id: 'blank-paint-embed', name: 'Blank paint', type: 'painting', x: 10, y: 10, width: 120, height: 120, paintingId: blankPaint.id }));
  assert.doesNotThrow(() => renderSvg(documentSchema.parse(blank)));

  const painted = fixture(), paintedLayer = painting('painted-layer');
  painted.assets.push({ id: 'painted-tile', name: 'Tile', type: 'image', mimeType: 'image/png', url: '/api/assets/painted-tile' });
  paintedLayer.layers[0].tiles = [{ x: 0, y: 0, assetId: 'painted-tile', hash: 'a'.repeat(64), generation: 0 }];
  painted.paintings.push(paintedLayer);
  painted.boards[0].elements.push(boardElementSchema.parse({ id: 'painted-embed', name: 'Painted embed', type: 'painting', x: 10, y: 10, width: 120, height: 120, paintingId: paintedLayer.id }));
  assert.throws(() => renderSvg(documentSchema.parse(painted)), /Save a current painting composite/);
});

test('redo of a removed painting advances beyond the editor history generation floor', () => {
  const removed = fixture(), old = fixture(); old.paintings.push(painting());
  const once = restoreDocumentSnapshot(removed, old, 9);
  assert.equal(once.schemaVersion === 2 && once.paintings[0].generation, 10);
  const twice = restoreDocumentSnapshot(removed, old, 10);
  assert.equal(twice.schemaVersion === 2 && twice.paintings[0].generation, 11);
});

test('unroutable overlapping connector remains visible with a warning in static exports', async () => {
  const { diagramNode, diagramEdge } = await import('../src/shared/diagram-presets');
  const { renderHtml } = await import('../src/shared/render');
  const doc = fixture();
  doc.boards[0].elements = [diagramNode('left', 'flowchart', 'process', 'Left'), diagramNode('right', 'flowchart', 'process', 'Right', 400), diagramNode('overlap', 'flowchart', 'process', 'Overlapping node', 100), diagramEdge('connection', 'left', 'right', 'Still connected')];
  const svg = renderSvg(doc), html = renderHtml(doc);
  for (const output of [svg, html]) { assert.match(output, /data-route-warning="true"/); assert.match(output, /Still connected/); assert.match(output, /No obstacle-free route/); }
  assert.equal(doc.boards[0].elements[3].type, 'connector');
});
