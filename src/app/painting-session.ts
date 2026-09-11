import { createPaintingSelectionMask, type PaintingSelectionMask } from '../shared/painting-selection-mask';
import type { DesignDocument, AssetRef } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
import { PaintRuntime, type PaintBrush } from '../shared/paint-runtime';
import type { PaintingDraft } from '../shared/painting-fill';
import { fillPainting, type PaintingFillOptions } from '../shared/painting-fill';
import { type PaintingSelection } from '../shared/painting-selection';
import { encodePaintPng, decodePaintTile, paintHash } from '../shared/paint-png';
import { paintingSourceHash } from '../shared/paint-composite';
import { compositePaintingInBrowser as compositePainting } from './painting-compositor';
import { api } from './api';

export class PaintingSession {
  private abort = new AbortController();
  dispose() { this.abort.abort(); this.selectionAbort?.abort(); this.cache.clear(); this.masks.clear(); this.surface = undefined; }
  private composite(painting: Painting, load: (id: string, hash: string) => Promise<Uint8Array>) { return compositePainting(painting, load, this.abort.signal); }
  private cache = new Map<string, Uint8Array>();
  private surface?: Uint8Array;
  private masks = new Map<string, Uint8Array>();
  private selectionMask?: PaintingSelectionMask;
  private selectionAbort?: AbortController;
  async select(selection?: PaintingSelection) {
    this.selectionAbort?.abort(); const controller = new AbortController(); this.selectionAbort = controller;
    const abort = () => controller.abort(); this.abort.signal.addEventListener('abort', abort, { once: true });
    try { const mask = await createPaintingSelectionMask(this.painting.width, this.painting.height, selection, controller.signal); if (!controller.signal.aborted) this.selectionMask = mask; }
    finally { this.abort.signal.removeEventListener('abort', abort); }
  }
  readonly runtime: PaintRuntime;
  constructor(readonly document: DesignDocument, readonly painting: Painting, readonly layerId: string, readonly editMask = false) {
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
    if (layer.mask?.enabled) for (const tile of layer.mask.tiles) this.masks.set(`${tile.x},${tile.y}`, await this.load(tile.assetId, tile.hash));
    for (const tile of (this.editMask ? layer.mask?.tiles ?? [] : layer.tiles)) this.runtime.loadTile(layer.id, tile.x, tile.y, await this.load(tile.assetId, tile.hash));
    this.runtime.configureLayer(layer.id, { locked: layer.locked || this.painting.groups.some(g => g.id === layer.groupId && 'locked' in g && g.locked === true), opacity: layer.opacity, visible: layer.visible });
    this.surface = await this.composite(this.painting, (id, hash) => this.load(id, hash));
  }
  maskCoverage(x: number, y: number) {
    const layer = this.painting.layers.find(l => l.id === this.layerId)!;
    return !this.editMask && layer.mask?.enabled ? (this.masks.get(`${Math.floor(x / 512)},${Math.floor(y / 512)}`)?.[((y % 512) * 512 + x % 512) * 4 + 3] ?? 0) / 255 : 1;
  }
  async fill(options: PaintingFillOptions, visible: boolean, signal?: AbortSignal) {
    const layer = this.painting.layers.find(l => l.id === this.layerId)!;
    if (layer.locked || this.painting.groups.some(g => g.id === layer.groupId && 'locked' in g && g.locked === true)) throw new Error('Unlock this layer and its group before painting.');
    const source = (x: number, y: number) => this.runtime.pixel(x, y, this.layerId);
    const sample = visible ? (x: number, y: number) => { const i = (y * this.painting.width + x) * 4; return Array.from(this.surface!.slice(i, i + 4)) as [number, number, number, number]; } : source;
    const selection = await createPaintingSelectionMask(this.painting.width, this.painting.height, options.selection, signal);
    return fillPainting(this.painting.width, this.painting.height, { ...options, selection: undefined, alphaLock: !this.editMask && layer.alphaLock }, source, sample, (x, y) => this.maskCoverage(x, y) * selection.coverage(x, y), signal);
  }
  beginStroke(brush: PaintBrush) {
    const surface = this.surface, selection = this.selectionMask;
    if (!surface) throw new Error('Wait for the painting to load.');
    if (!this.editMask && brush.mode === 'erase' && this.painting.layers.find(l => l.id === this.layerId)?.alphaLock) throw new Error('Turn off alpha lock before erasing.');
    // Pickup sees the frozen visible surface; deposits modify only the selected layer.
    return this.runtime.beginStroke(this.layerId, brush, (x, y) => {
      const i = (y * this.painting.width + x) * 4;
      return this.editMask ? this.runtime.pixel(x, y, this.layerId) : [surface[i], surface[i + 1], surface[i + 2], surface[i + 3]];
    }, (x, y) => this.maskCoverage(x, y) * (selection?.coverage(x, y) ?? 1));
  }
  async preview(canvas: HTMLCanvasElement, draft?: PaintingDraft, painting = this.painting, valid: () => boolean = () => true) {
    const current = structuredClone(painting), layer = current.layers.find(l => l.id === this.layerId);
    const temporary = new Map<string, Uint8Array>();
    if (layer && draft && this.editMask) layer.mask ??= { enabled: true, tiles: [] };
    if (layer && draft) for (const key of draft.dirtyKeys) {
      const [x, y] = key.split(',').map(Number), id = `draft-${x}-${y}`;
      const pixels = draft.copyTile(x, y); if (!pixels) continue;
      if (!this.editMask && layer.alphaLock) { const source = this.runtime.copyTile(this.layerId, x, y); for (let i = 3; i < pixels.length; i += 4) pixels[i] = source?.[i] ?? 0; }
      temporary.set(id, pixels); const target = this.editMask ? layer.mask! : layer; target.tiles = target.tiles.filter(t => t.x !== x || t.y !== y);
      target.tiles.push({ x, y, assetId: id, hash: '', generation: painting.generation });
    }
    const pixels = await this.composite(current, (id, hash) => temporary.has(id) ? Promise.resolve(temporary.get(id)!) : this.load(id, hash));
    if (!valid()) return;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas context unavailable. Your source layers remain intact; reload the canvas or download a backup.');
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), painting.width, painting.height), 0, 0);
  }
  async upload(png: Uint8Array, name: string): Promise<AssetRef> {
    const data = new FormData(); data.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
    const result = await api<{ asset: AssetRef }>(`/api/projects/${this.document.id}/assets`, { method: 'POST', body: data }); return result.asset;
  }
  async finishSettings(next: Painting): Promise<AssetRef[]> {
    const assets: AssetRef[] = [], temporary = new Map<string, Uint8Array>();
    if (next.width < this.painting.width || next.height < this.painting.height) {
      for (const layer of next.layers) for (const tiles of [layer.tiles, layer.mask?.tiles ?? []]) {
        for (const tile of tiles) {
          if ((tile.x + 1) * 512 <= next.width && (tile.y + 1) * 512 <= next.height) continue;
          const pixels = (await this.load(tile.assetId, tile.hash)).slice(); let changed = false;
          for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (tile.x * 512 + x >= next.width || tile.y * 512 + y >= next.height) {
            const i = (y * 512 + x) * 4;
            if (pixels[i] || pixels[i + 1] || pixels[i + 2] || pixels[i + 3]) { pixels.fill(0, i, i + 4); changed = true; }
          }
          if (!changed) continue;
          const png = await encodePaintPng(512, 512, pixels), asset = await this.upload(png, `${next.name} cropped tile.png`);
          assets.push(asset); temporary.set(asset.id, pixels); tile.assetId = asset.id; tile.hash = await paintHash(png); tile.generation = next.generation;
        }
      }
    }
    const pixels = await this.composite(next, (id, hash) => temporary.has(id) ? Promise.resolve(temporary.get(id)!) : this.load(id, hash));
    const preview = await this.upload(await encodePaintPng(next.width, next.height, pixels), `${next.name} preview.png`);
    next.composite = { assetId: preview.id, generation: next.generation, sourceHash: await paintingSourceHash(next) };
    assets.push(preview); return assets;
  }
  async finish(stroke: PaintingDraft): Promise<{ painting: Painting; assets: AssetRef[] }> {
    const next = structuredClone(this.painting); next.generation++;
    const layer = next.layers.find(l => l.id === this.layerId)!, assets: AssetRef[] = [], tiles = new Map<string, Uint8Array>();
    if (layer.locked || this.painting.groups.some(g => g.id === layer.groupId && 'locked' in g && g.locked === true)) throw new Error('Unlock this layer and its group before painting.');
    if (this.editMask) layer.mask ??= { enabled: true, tiles: [] };
    const target = this.editMask ? layer.mask! : layer;
    if (this.document.assets.length + stroke.dirtyKeys.length + 1 > 2000) throw new Error('Asset budget reached. Export a backup before starting another painting.');
    for (const key of stroke.dirtyKeys) {
      const [x, y] = key.split(',').map(Number); const pixels = stroke.copyTile(x, y)!;
      if (!this.editMask && layer.alphaLock) { const source = this.runtime.copyTile(this.layerId, x, y); for (let i = 3; i < pixels.length; i += 4) pixels[i] = source?.[i] ?? 0; }
      const png = await encodePaintPng(512, 512, pixels), asset = await this.upload(png, `${next.name} tile.png`);
      assets.push(asset); tiles.set(asset.id, pixels); target.tiles = target.tiles.filter(t => t.x !== x || t.y !== y);
      target.tiles.push({ x, y, assetId: asset.id, hash: await paintHash(png), generation: next.generation });
    }
    const pixels = await this.composite(next, (id, hash) => tiles.has(id) ? Promise.resolve(tiles.get(id)!) : this.load(id, hash));
    const png = await encodePaintPng(next.width, next.height, pixels), preview = await this.upload(png, `${next.name} preview.png`);
    assets.push(preview); next.composite = { assetId: preview.id, generation: next.generation, sourceHash: await paintingSourceHash(next) };
    return { painting: next, assets };
  }
}
