import type { DesignDocument, AssetRef } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
import { PaintRuntime, type PaintBrush } from '../shared/paint-runtime';
import type { PaintStroke } from '../shared/paint-stroke';
import { encodePaintPng, decodePaintTile, paintHash } from '../shared/paint-png';
import { compositePainting, paintingSourceHash } from '../shared/paint-composite';
import { api } from './api';

export class PaintingSession {
  private cache = new Map<string, Uint8Array>();
  private surface?: Uint8Array;
  readonly runtime: PaintRuntime;
  constructor(readonly document: DesignDocument, readonly painting: Painting, readonly layerId: string) {
    this.runtime = new PaintRuntime(painting.width, painting.height, 64);
    this.runtime.addLayer(layerId);
  }
  async load(assetId: string, hash: string): Promise<Uint8Array> {
    const cached = this.cache.get(assetId);
    if (cached) { this.cache.delete(assetId); this.cache.set(assetId, cached); return cached; }
    const asset = this.document.assets.find(a => a.id === assetId);
    if (!asset || asset.url !== `/api/assets/${assetId}`) throw new Error('Import the painting assets into this project before editing.');
    const response = await fetch(asset.url); if (!response.ok) throw new Error('A painting tile could not be loaded.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await paintHash(bytes) !== hash) throw new Error('A painting tile checksum does not match.');
    const pixels = await decodePaintTile(bytes); this.cache.set(assetId, pixels);
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return pixels;
  }
  async initialize() {
    const layer = this.painting.layers.find(l => l.id === this.layerId);
    if (!layer) throw new Error('Select a painting layer.');
    for (const tile of layer.tiles) this.runtime.loadTile(layer.id, tile.x, tile.y, await this.load(tile.assetId, tile.hash));
    this.runtime.configureLayer(layer.id, { locked: layer.locked, opacity: layer.opacity, visible: layer.visible });
    this.surface = await compositePainting(this.painting, (id, hash) => this.load(id, hash));
  }
  beginStroke(brush: PaintBrush) {
    const surface = this.surface;
    if (!surface) throw new Error('Wait for the painting to load.');
    if (brush.mode === 'erase' && this.painting.layers.find(l => l.id === this.layerId)?.alphaLock) throw new Error('Turn off alpha lock before erasing.');
    // Pickup sees the frozen visible surface; deposits modify only the selected layer.
    return this.runtime.beginStroke(this.layerId, brush, (x, y) => {
      const i = (y * this.painting.width + x) * 4;
      return [surface[i], surface[i + 1], surface[i + 2], surface[i + 3]];
    });
  }
  async preview(canvas: HTMLCanvasElement, draft?: PaintStroke, painting = this.painting, valid: () => boolean = () => true) {
    const current = structuredClone(painting), layer = current.layers.find(l => l.id === this.layerId);
    const temporary = new Map<string, Uint8Array>();
    if (layer && draft) for (const key of draft.dirtyKeys) {
      const [x, y] = key.split(',').map(Number), id = `draft-${x}-${y}`;
      const pixels = draft.copyTile(x, y); if (!pixels) continue;
      if (layer.alphaLock) { const source = this.runtime.copyTile(this.layerId, x, y); for (let i = 3; i < pixels.length; i += 4) pixels[i] = source?.[i] ?? 0; }
      temporary.set(id, pixels); layer.tiles = layer.tiles.filter(t => t.x !== x || t.y !== y);
      layer.tiles.push({ x, y, assetId: id, hash: '', generation: painting.generation });
    }
    const pixels = await compositePainting(current, (id, hash) => temporary.has(id) ? Promise.resolve(temporary.get(id)!) : this.load(id, hash));
    if (!valid()) return;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), painting.width, painting.height), 0, 0);
  }
  async upload(png: Uint8Array, name: string): Promise<AssetRef> {
    const data = new FormData(); data.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
    const result = await api<{ asset: AssetRef }>(`/api/projects/${this.document.id}/assets`, { method: 'POST', body: data }); return result.asset;
  }
  async finishSettings(next: Painting): Promise<AssetRef> {
    const pixels = await compositePainting(next, (id, hash) => this.load(id, hash));
    const preview = await this.upload(await encodePaintPng(next.width, next.height, pixels), `${next.name} preview.png`);
    next.composite = { assetId: preview.id, generation: next.generation, sourceHash: await paintingSourceHash(next) };
    return preview;
  }
  async finish(stroke: PaintStroke): Promise<{ painting: Painting; assets: AssetRef[] }> {
    const next = structuredClone(this.painting); next.generation++;
    const layer = next.layers.find(l => l.id === this.layerId)!, assets: AssetRef[] = [], tiles = new Map<string, Uint8Array>();
    if (layer.locked) throw new Error('Unlock this layer before painting.');
    if (this.document.assets.length + stroke.dirtyKeys.length + 1 > 2000) throw new Error('Asset budget reached. Export a backup before starting another painting.');
    for (const key of stroke.dirtyKeys) {
      const [x, y] = key.split(',').map(Number); const pixels = stroke.copyTile(x, y)!;
      if (layer.alphaLock) { const source = this.runtime.copyTile(this.layerId, x, y); for (let i = 3; i < pixels.length; i += 4) pixels[i] = source?.[i] ?? 0; }
      const png = await encodePaintPng(512, 512, pixels), asset = await this.upload(png, `${next.name} tile.png`);
      assets.push(asset); tiles.set(asset.id, pixels); layer.tiles = layer.tiles.filter(t => t.x !== x || t.y !== y);
      layer.tiles.push({ x, y, assetId: asset.id, hash: await paintHash(png), generation: next.generation });
    }
    const pixels = await compositePainting(next, (id, hash) => tiles.has(id) ? Promise.resolve(tiles.get(id)!) : this.load(id, hash));
    const png = await encodePaintPng(next.width, next.height, pixels), preview = await this.upload(png, `${next.name} preview.png`);
    assets.push(preview); next.composite = { assetId: preview.id, generation: next.generation, sourceHash: await paintingSourceHash(next) };
    return { painting: next, assets };
  }
}
