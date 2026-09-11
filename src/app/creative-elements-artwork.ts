import { type AssetRef, type DesignDocument, documentSchema, uid } from '../shared/schema';
import type { BoardElement } from '../shared/board-schema';
import { boardElementLocked } from '../shared/board-editing';
import { ELEMENT_ARTWORK_LICENSE, ELEMENT_LIBRARY, elementArtwork, type LibraryElement } from '../shared/creative-elements-catalog';
import { rasterizeElementSvg } from './creative-elements-svg';

export const bundledAttribution = (item: LibraryElement) => `${ELEMENT_ARTWORK_LICENSE} | Studio recipe v1:${item.id}`;
export function bundledStickerRecipe(element: BoardElement): LibraryElement | undefined {
  if (element.type !== 'sticker') return undefined;
  return ELEMENT_LIBRARY.find(item => item.kind === 'sticker' && item.recolorable && element.attribution === bundledAttribution(item));
}
/** Keep deterministic vector recipe identity, but store only supported raster bytes in document assets. */
export async function bundledArtworkAsset(item: LibraryElement, color: string, variant = 0): Promise<AssetRef> {
  const source = elementArtwork(item, color, variant).replace('width="128" height="128"', 'width="512" height="512"');
  const { blob } = await rasterizeElementSvg(source);
  const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read rendered artwork')); reader.readAsDataURL(blob); });
  return { id: uid(), name: `${item.name} · Studio recipe v1:${item.id}`, type: 'image', mimeType: 'image/png', size: blob.size, url };
}
/** Recolor from the original known recipe; names may change and earlier asset bytes remain immutable. */
export async function recolorBundledSticker(doc: DesignDocument, element: BoardElement, color: string): Promise<DesignDocument> {
  const item = bundledStickerRecipe(element); if (!item) throw new Error('Only bundled artwork recipes support recoloring.');
  const board = doc.schemaVersion === 2 ? doc.boards.find(b => b.elements.some(e => e.id === element.id)) : undefined;
  if (!board || boardElementLocked(board, element)) throw new Error('Unlock the sticker and its parent before recoloring.');
  const base = structuredClone(doc), replacement = await bundledArtworkAsset(item, color);
  base.assets.push(replacement);
  if (base.schemaVersion === 2) { const target = base.boards.find(b => b.id === board.id)?.elements.find(e => e.id === element.id); if (target?.type !== 'sticker') throw new Error('Sticker unavailable'); target.assetId = replacement.id; }
  return documentSchema.parse(base);
}
