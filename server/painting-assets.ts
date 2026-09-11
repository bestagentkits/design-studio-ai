import { assertPaintingTransition } from '../src/shared/painting-transition';
import { reserveCreativeWork } from './asset-lifecycle';
import type { Context } from 'hono';
import type { Env } from './types';
import type { DesignDocument } from '../src/shared/schema';
import { decodePaintTile, encodePaintPng, paintHash } from '../src/shared/paint-png';
import { compositePainting, paintSource, paintingSourceHash } from '../src/shared/paint-composite';
import { fail, owner } from './security';
import { storeAsset } from './projects';

/** Browser composites are previews. Only this compositor supplies persisted/public pixels. */
export async function preparePaintingAssets(c: Context<Env>, projectId: string, next: DesignDocument, previous?: DesignDocument) {
  if (next.schemaVersion !== 2) return;
  const changedPaintings = next.paintings.filter(p => { const old = previous?.schemaVersion === 2 ? previous.paintings.find(o => o.id === p.id) : undefined; return !old?.composite || paintSource(old) !== paintSource(p); });
  const outputPixels = changedPaintings.reduce((sum, p) => sum + p.width * p.height, 0);
  const sourcePixels = changedPaintings.reduce((sum, p) => sum + p.layers.reduce((n, l) => n + l.tiles.length + (l.mask?.tiles.length ?? 0), 0) * 512 * 512, 0);
  if (outputPixels > 64 * 1024 * 1024 || sourcePixels > 512 * 1024 * 1024) fail(413, 'painting_work_budget_exceeded', 'This save exceeds 64 megapixels of composite output or 512 megapixels of source tiles. Save smaller independent painting batches.');
  const changed = changedPaintings.length > 0;
  const lease = changed ? await reserveCreativeWork(c, projectId) : undefined;
  try {
  for (const painting of next.paintings) {
    lease?.assertActive();
    const old = previous?.schemaVersion === 2 ? previous.paintings.find(p => p.id === painting.id) : undefined;
    for (const layer of painting.layers) for (const tile of [...layer.tiles, ...layer.mask?.tiles ?? []]) {
      const ref = next.assets.find(a => a.id === tile.assetId);
      if (!ref || ref.url !== `/api/assets/${tile.assetId}` || ref.mimeType !== 'image/png') fail(400, 'paint_asset_required', 'Paint tile IDs must resolve to their owned project PNG bytes.');
    }
    if (old && paintSource(old) === paintSource(painting) && old.composite) {
      painting.composite = structuredClone(old.composite);
      const ref = previous!.assets.find(a => a.id === old.composite!.assetId);
      if (!ref) fail(400, 'missing_paint_composite', 'The saved painting composite is missing.');
      next.assets = next.assets.filter(a => a.id !== ref.id); next.assets.push(structuredClone(ref));
      continue;
    }
    if (old) { try { assertPaintingTransition(old, painting); } catch (error) { fail(409, 'paint_layer_locked', error instanceof Error ? error.message : 'Paint layer is locked'); } }
    if (old && painting.generation <= old.generation) fail(409, 'painting_generation_conflict', 'Painting pixels or settings changed. Use a new generation after reloading the current painting.');
    if (next.assets.length >= 2000) fail(413, 'asset_budget_exceeded', 'Leave one asset slot for the verified painting composite.');
    const load = async (assetId: string, hash: string) => {
      lease?.assertActive();
      const ref = next.assets.find(a => a.id === assetId);
      if (!ref || ref.url !== `/api/assets/${assetId}`) fail(400, 'paint_asset_required', 'Import paint tiles as owned project PNG assets.');
      const row = await c.env.DB.prepare('SELECT storage_key,mime_type,size FROM assets WHERE id=? AND user_id=? AND project_id=?').bind(assetId, owner(c), projectId).first<{ storage_key: string; mime_type: string; size: number }>();
      if (!row || row.mime_type !== 'image/png' || row.size > 2 * 1024 * 1024) fail(400, 'invalid_paint_tile', 'Painting tile is unavailable or exceeds its byte limit.');
      const blob = await c.env.ASSETS_BUCKET.get(row.storage_key);
      if (!blob) fail(400, 'missing_paint_tile', 'Painting tile bytes are missing. Restore the asset before saving.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (await paintHash(bytes) !== hash) fail(400, 'paint_hash_mismatch', 'Painting tile checksum does not match its immutable bytes.');
      try { return await decodePaintTile(bytes); } catch (error) { fail(400, 'invalid_paint_tile', error instanceof Error ? error.message : 'Invalid paint PNG'); }
    };
    // Validate even hidden layers: they remain editable source, but never become public source assets.
    for (const layer of painting.layers) for (const tile of [...layer.tiles, ...layer.mask?.tiles ?? []]) await load(tile.assetId, tile.hash);
    const pixels = await compositePainting(painting, load), png = await encodePaintPng(painting.width, painting.height, pixels);
    lease?.assertActive();
    const composite = await storeAsset(c, projectId, `${painting.name} composite.png`, 'image/png', new Uint8Array(png).buffer);
    next.assets.push(composite);
    painting.composite = { assetId: composite.id, generation: painting.generation, sourceHash: await paintingSourceHash(painting) };
  }
  lease?.assertActive();
  } finally { await lease?.release(); }
}
