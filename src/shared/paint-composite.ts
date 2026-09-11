import type { Painting } from './painting-schema';
import { paintHash } from './paint-png';

export function paintSource(painting: Painting): string {
  const { composite: _composite, ...source } = painting;
  return JSON.stringify(source);
}
export const paintingSourceHash = (painting: Painting) => paintHash(new TextEncoder().encode(paintSource(painting)));
/** Sparse source tiles load one at a time; the destination is bounded to 4096² RGBA. */
export async function compositePainting(painting: Painting, load: (assetId: string, hash: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const output = new Uint8Array(painting.width * painting.height * 4);
  for (let ty = 0; ty < Math.ceil(painting.height / 512); ty++) for (let tx = 0; tx < Math.ceil(painting.width / 512); tx++) {
    let clipAlpha = new Uint8Array(512 * 512);
    for (const layer of painting.layers) {
      const group = painting.groups.find(g => g.id === layer.groupId);
      if (!layer.visible || group?.visible === false) { if (!layer.clipping) clipAlpha.fill(0); continue; }
      const tile = layer.tiles.find(t => t.x === tx && t.y === ty);
      if (!tile) { if (!layer.clipping) clipAlpha.fill(0); continue; }
      const pixels = await load(tile.assetId, tile.hash);
      if (pixels.length !== 512 * 512 * 4) throw new Error('Invalid decoded paint tile');
      const maskTile = layer.mask?.enabled ? layer.mask.tiles.find(t => t.x === tx && t.y === ty) : undefined;
      const mask = maskTile ? await load(maskTile.assetId, maskTile.hash) : undefined;
      const opacity = layer.opacity * (group?.opacity ?? 1);
      for (let y = 0; y < Math.min(512, painting.height - ty * 512); y++) for (let x = 0; x < Math.min(512, painting.width - tx * 512); x++) {
        const at = (y * 512 + x) * 4, to = ((ty * 512 + y) * painting.width + tx * 512 + x) * 4;
        let sa = pixels[at + 3] / 255 * opacity * (layer.mask?.enabled ? (mask ? mask[at + 3] / 255 : 0) : 1);
        if (layer.clipping) sa *= clipAlpha[at / 4] / 255; else clipAlpha[at / 4] = Math.round(sa * 255);
        const da = output[to + 3] / 255, alpha = sa + da * (1 - sa);
        if (!alpha) continue;
        for (let c = 0; c < 3; c++) {
          const s = pixels[at + c] / 255, d = output[to + c] / 255;
          const mixed = layer.blend === 'multiply' ? s * d : layer.blend === 'screen' ? s + d - s * d : layer.blend === 'overlay' ? (d <= .5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)) : s;
          output[to + c] = Math.round(((1 - sa) * da * d + (1 - da) * sa * s + sa * da * mixed) / alpha * 255);
        }
        output[to + 3] = Math.round(alpha * 255);
      }
    }
  }
  return output;
}
