import type { z } from 'zod';
import type { Board } from './board-schema';
import type { Painting } from './painting-schema';

/** Validate references separately from structural parsing so no unknown content is stripped. */
export function validateCreativeDocument(doc: {
  boards: Board[]; paintings: Painting[];
  assets: { id: string; mimeType: string; url: string }[];
  pages: { nodes: { id: string; type: string; boardId?: string; paintingId?: string; crop?: unknown }[] }[];
}, ctx: z.RefinementCtx, unique: (id: string) => void) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const assets = new Map(doc.assets.map(a => [a.id, a]));
  const paintings = new Set(doc.paintings.map(p => p.id)), boards = new Set(doc.boards.map(b => b.id));
  const asset = (id: string, png = false) => {
    const value = assets.get(id);
    if (!value) issue(`Unknown creative asset: ${id}`);
    if (png && value && value.mimeType !== 'image/png') issue('Painting tiles and composites must be lossless PNG assets');
  };
  for (const page of doc.pages) for (const node of page.nodes) {
    if (node.type === 'board' && (!node.boardId || !boards.has(node.boardId) || !node.crop)) issue('Board embeds require an existing board and explicit crop');
    if (node.type === 'artwork' && (!node.paintingId || !paintings.has(node.paintingId))) issue('Artwork must reference an existing painting');
    if (node.type !== 'board' && (node.boardId || node.crop)) issue('Only board nodes may contain board references');
    if (node.type !== 'artwork' && node.paintingId) issue('Only artwork nodes may contain painting references');
  }
  let count = doc.pages.reduce((sum, p) => sum + p.nodes.length, 0), points = 0;
  for (const board of doc.boards) {
    unique(board.id); count += board.elements.length;
    const elements = new Map(board.elements.map(e => [e.id, e]));
    for (const element of board.elements) {
      unique(element.id);
      if (element.type === 'stroke') points += element.points.length;
      if (element.type === 'path') points += element.commands.length;
      const seen = new Set([element.id]); let parent = element.parentId;
      while (parent) {
        const target = elements.get(parent);
        if (!target || !['group', 'frame'].includes(target.type) || seen.has(parent)) { issue('Invalid or cyclic board group parent'); break; }
        seen.add(parent); parent = target.parentId;
      }
      if ('assetId' in element) asset(element.assetId);
      if (element.type === 'gif') { asset(element.posterAssetId); if (assets.get(element.assetId)?.mimeType !== 'image/gif') issue('GIF elements require a GIF asset'); }
      if (element.type === 'painting' && !paintings.has(element.paintingId)) issue('Board references an unknown painting');
      if (element.type === 'connector') for (const endpoint of [element.start, element.end]) {
        if (endpoint.binding) {
          const target = elements.get(endpoint.binding.elementId);
          if (!target || target.type === 'connector' || target.type === 'group') issue('Connector must bind to an existing non-connector element');
        }
      }
    }
    const tree = new Map(board.mindMap?.map(n => [n.elementId, n]));
    if (tree.size !== (board.mindMap?.length ?? 0)) issue('Duplicate mind-map member');
    for (const node of tree.values()) {
      if (!elements.has(node.elementId)) issue('Unknown mind-map element');
      const seen = new Set([node.elementId]); let parent = node.parentId;
      while (parent) {
        if (!tree.has(parent) || seen.has(parent)) { issue('Invalid or cyclic mind-map parent'); break; }
        seen.add(parent); parent = tree.get(parent)?.parentId;
      }
    }
  }
  if (count > 5000) issue('Maximum 5000 nodes and board elements per document');
  if (points > 200000) issue('Maximum 200000 stroke samples and path commands per document');
  for (const painting of doc.paintings) {
    unique(painting.id);
    const groups = new Set(painting.groups.map(g => g.id));
    for (const group of painting.groups) unique(group.id);
    for (const [index, layer] of painting.layers.entries()) {
      unique(layer.id);
      if (layer.groupId && !groups.has(layer.groupId)) issue('Unknown paint group');
      if (layer.clipping && index === 0) issue('A clipping layer needs a layer below it');
      for (const tiles of [layer.tiles, layer.mask?.tiles ?? []]) {
        const positions = new Set<string>();
        for (const tile of tiles) {
          const key = `${tile.x}:${tile.y}`;
          if (positions.has(key)) issue('Duplicate painting tile position');
          positions.add(key);
          if (tile.x * 512 >= painting.width || tile.y * 512 >= painting.height) issue('Painting tile lies outside the painting');
          if (tile.generation > painting.generation) issue('Tile generation exceeds painting generation');
          asset(tile.assetId, true);
        }
      }
    }
    if (painting.composite) {
      asset(painting.composite.assetId, true);
      if (painting.composite.generation !== painting.generation) issue('Painting composite is stale');
    }
  }
}
