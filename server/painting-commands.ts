import { createPaintingSelectionMask } from '../src/shared/painting-selection-mask';
import type { Context } from 'hono';
import type { Env } from './types';
import { paintingCommandSchema } from '../src/shared/painting-command';
import { documentSchema } from '../src/shared/schema';
import { PaintRuntime } from '../src/shared/paint-runtime';
import { paintBrushPreset } from '../src/shared/paint-brush-presets';
import { selectionCoverage, validatePaintingSelection } from '../src/shared/painting-selection';
import { fillPainting, type PaintingDraft } from '../src/shared/painting-fill';
import { decodePaintTile, encodePaintPng, paintHash } from '../src/shared/paint-png';
import { compositePainting } from '../src/shared/paint-composite';
import { fail, owner } from './security';
import { projectRow, saveDocument, storeAsset } from './projects';
import { readCreativeReceipt } from './creative-save-receipts';
import { reserveCreativeWork } from './asset-lifecycle';

/** Raster commands are owner-scoped, bounded and committed through the same document CAS. */
export async function executePaintingCommand(c: Context<Env>, projectId: string, input: unknown) {
  const command = paintingCommandSchema.parse(input);
  const row = await projectRow(c, projectId);
  const identity = { key: command.operationId, hash: await paintHash(new TextEncoder().encode(JSON.stringify(command))) };
  const previous = await readCreativeReceipt(c, projectId, identity); if (previous) return previous;
  if (row.revision !== command.expectedRevision) fail(409, 'revision_conflict', 'Project changed. Reload before painting.');
  if (command.expectedBriefRevision !== undefined) { const brief = await c.env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(projectId, owner(c)).first<{ revision: number }>(); if ((brief?.revision ?? 0) !== command.expectedBriefRevision) fail(409, 'revision_conflict', 'Brief changed. Reload before painting.'); }
  const doc = documentSchema.parse(JSON.parse(row.document));
  const painting = doc.schemaVersion === 2 && doc.paintings.find(p => p.id === command.paintingId);
  if (!painting) fail(404, 'not_found', 'Painting not found.');
  if (painting.generation !== command.expectedGeneration) fail(409, 'painting_generation_conflict', 'Painting changed. Reload before painting.');
  const layer = painting.layers.find(l => l.id === command.layerId);
  if (!layer) fail(404, 'not_found', 'Layer not found.');
  if (layer.locked || painting.groups.some(g => g.id === layer.groupId && g.locked)) fail(409, 'paint_layer_locked', 'Unlock the layer before painting.');
  try { if (command.selection) validatePaintingSelection(command.selection); } catch (e) { fail(400, 'invalid_paint_selection', (e as Error).message); }
  const points = command.action.type === 'stroke' ? command.action.points : [command.action];
  if (points.some(p => p.x >= painting.width || p.y >= painting.height)) fail(400, 'invalid_paint_point', 'Paint points must lie inside the painting.');
  const lease = await reserveCreativeWork(c, projectId);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const selectionMask = await createPaintingSelectionMask(painting.width, painting.height, command.selection, controller.signal);
    const cache = new Map<string, Uint8Array>();
    const load = async (assetId: string, hash: string) => {
      lease.assertActive(); const cached = cache.get(assetId); if (cached) return cached;
      const asset = await c.env.DB.prepare('SELECT storage_key FROM assets WHERE id=? AND user_id=? AND project_id=? AND mime_type=?').bind(assetId, owner(c), projectId, 'image/png').first<{ storage_key: string }>();
      if (!asset) fail(400, 'invalid_paint_tile', 'Painting tile is unavailable.');
      const blob = await c.env.ASSETS_BUCKET.get(asset.storage_key); if (!blob) fail(400, 'invalid_paint_tile', 'Painting tile bytes are missing.');
      const bytes = new Uint8Array(await blob.arrayBuffer()); if (await paintHash(bytes) !== hash) fail(400, 'paint_hash_mismatch', 'Painting tile checksum differs.');
      const pixels = await decodePaintTile(bytes); cache.set(assetId, pixels); if (cache.size > 8) cache.delete(cache.keys().next().value!); return pixels;
    };
    const runtime = new PaintRuntime(painting.width, painting.height, 64); runtime.addLayer(layer.id);
    for (const tile of layer.tiles) runtime.loadTile(layer.id, tile.x, tile.y, await load(tile.assetId, tile.hash));
    const masks = new Map<string, Uint8Array>(); if (layer.mask?.enabled) for (const tile of layer.mask.tiles) masks.set(`${tile.x},${tile.y}`, await load(tile.assetId, tile.hash));
    const coverage = (x: number, y: number) => layer.mask?.enabled ? (masks.get(`${Math.floor(x / 512)},${Math.floor(y / 512)}`)?.[((y % 512) * 512 + x % 512) * 4 + 3] ?? 0) / 255 : 1;
    const surface = await compositePainting(painting, load), source = (x: number, y: number) => runtime.pixel(x, y, layer.id);
    const sample = (x: number, y: number): [number, number, number, number] => { const i = (y * painting.width + x) * 4; return [surface[i], surface[i + 1], surface[i + 2], surface[i + 3]]; };
    const action = command.action; let draft: PaintingDraft;
    if (action.type === 'fill') draft = await fillPainting(painting.width, painting.height, { ...action, selection: command.selection, alphaLock: layer.alphaLock }, source, action.sampleVisible ? sample : source, coverage, controller.signal);
    else {
      if (action.preset === 'erase' && layer.alphaLock) fail(409, 'paint_alpha_locked', 'Turn off alpha lock before erasing.');
      const brush = { ...paintBrushPreset(action.preset, action.size, action.flow, action.color), seed: action.seed, tilt: action.tilt };
      const stroke = runtime.beginStroke(layer.id, brush, sample, (x, y) => coverage(x, y) * selectionMask.coverage(x,y));
      for (const point of action.points) { lease.assertActive(); stroke.append([point]); } stroke.seal(); draft = stroke;
    }
    if (doc.assets.length + draft.dirtyKeys.length + 1 > 2000) fail(413, 'asset_budget_exceeded', 'Painting asset budget reached.');
    painting.generation++; delete painting.composite;
    for (const key of draft.dirtyKeys) {
      lease.assertActive(); const [x, y] = key.split(',').map(Number), pixels = draft.copyTile(x, y)!;
      if (layer.alphaLock) { const before = runtime.copyTile(layer.id, x, y); for (let i = 3; i < pixels.length; i += 4) pixels[i] = before?.[i] ?? 0; }
      const png = await encodePaintPng(512, 512, pixels), asset = await storeAsset(c, projectId, `${painting.name} tile.png`, 'image/png', new Uint8Array(png).buffer);
      doc.assets.push(asset); layer.tiles = layer.tiles.filter(t => t.x !== x || t.y !== y); layer.tiles.push({ x, y, assetId: asset.id, hash: await paintHash(png), generation: painting.generation });
    }
    // The save service acquires its own compositing lease and atomically records the receipt.
    await lease.release();
    return await saveDocument(c, projectId, doc, command.expectedRevision, command.expectedBriefRevision, command.operationId, identity);
  } finally { clearTimeout(timeout); await lease.release(); }
}
