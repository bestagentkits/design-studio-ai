import type { DesignDocument } from '../shared/schema';
import { boardGifFrame } from '../shared/creative-elements-gif-playback';
import { renderGifFrame, type GifAnimation } from '../shared/gif-timeline';
import { loadGifAsset } from './creative-elements-gif-loader';

// Cache only derived data, bounded across repeated frame exports. Source bytes remain owned assets.
const cache = new Map<string, GifAnimation>();
let cacheBytes = 0;
const cost = (value: GifAnimation) => value.original.byteLength + value.frames.reduce((sum, frame) => sum + frame.rgba.byteLength, 0);
export async function cachedCreativeGif(url: string): Promise<GifAnimation> {
  const existing = cache.get(url); if (existing) return existing;
  const animation = await loadGifAsset(url), bytes = cost(animation);
  while (cache.size && (cacheBytes + bytes > 128 * 1024 ** 2 || cache.size >= 6)) { const key = cache.keys().next().value!; cacheBytes -= cost(cache.get(key)!); cache.delete(key); }
  if (bytes <= 128 * 1024 ** 2) { cache.set(url, animation); cacheBytes += bytes; }
  return animation;
}
/** Replace only a clone's poster references; the saved GIF bytes and document are untouched. */
export async function sampleCreativeGifs(input: DesignDocument, timeSeconds?: number): Promise<DesignDocument> {
  if (input.schemaVersion !== 2) return input;
  const doc = structuredClone(input);
  for (const board of doc.boards) for (const element of board.elements) {
    if (element.type !== 'gif' || !element.visible) continue;
    if (timeSeconds === undefined) { Object.assign(element, { type: 'image', assetId: element.posterAssetId }); continue; }
    const source = doc.assets.find(a => a.id === element.assetId); if (!source) throw new Error(`GIF source unavailable: ${element.name}`);
    const animation = await cachedCreativeGif(source.url), frame = boardGifFrame(animation, element, timeSeconds * 1000);
    const canvas = document.createElement('canvas'); canvas.width = animation.width; canvas.height = animation.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(renderGifFrame(animation, frame)), animation.width, animation.height), 0, 0);
    const id = `sample_${doc.assets.length}`;
    if (doc.assets.some(a => a.id === id)) throw new Error('Sample asset identifier collision');
    doc.assets.push({ id, name: `${element.name} frame`, type: 'image', mimeType: 'image/png', url: canvas.toDataURL('image/png') });
    element.posterAssetId = id;
    // The cloned document now contains the exact sample: no asynchronous playback during capture.
    Object.assign(element, { type: 'image', assetId: id });
  }
  return doc;
}
export async function creativeGifDuration(doc: DesignDocument): Promise<number> {
  if (doc.schemaVersion !== 2) return 0; let duration = 0;
  for (const board of doc.boards) for (const element of board.elements) if (element.type === 'gif' && element.playing && element.visible) {
    const asset = doc.assets.find(a => a.id === element.assetId); if (!asset) throw new Error(`GIF source unavailable: ${element.name}`);
    const animation = await cachedCreativeGif(asset.url); duration = Math.max(duration, ((element.startMs ?? 0) + animation.durationMs) / 1000);
  }
  return duration;
}
