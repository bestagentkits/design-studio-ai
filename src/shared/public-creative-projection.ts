import type { DesignDocument } from './schema';
import { visitDocumentAssetIds } from './document-asset-references';

/** Public files contain visible output, never editable paint source or private board elements. */
export function publicCreativeProjection(document: DesignDocument): DesignDocument {
  const doc = structuredClone(document);
  if (doc.schemaVersion !== 2) return doc;
  const boards = new Set<string>(), keepAssets = new Set<string>();
  const usePainting = (id: string) => {
    const painting = doc.paintings.find(p => p.id === id), composite = painting?.composite;
    if (!painting || !composite || composite.generation !== painting.generation) throw new Error('Save the painting to build its verified public composite before exporting.');
    const asset = doc.assets.find(a => a.id === composite.assetId); if (!asset) throw new Error('Painting composite is unavailable');
    keepAssets.add(asset.id); return asset;
  };
  for (const page of doc.pages) {
    const hidden = new Set(page.nodes.filter(n => n.visible === false).map(n => n.id));
    let changed = true;
    while (changed) { changed = false; for (const n of page.nodes) if (n.parentId && hidden.has(n.parentId) && !hidden.has(n.id)) { hidden.add(n.id); changed = true; } }
    page.nodes = page.nodes.filter(n => !['board', 'artwork'].includes(n.type) || !hidden.has(n.id));
    for (const node of page.nodes) {
      if (node.type === 'board' && node.boardId) boards.add(node.boardId);
      if (node.type === 'artwork' && node.paintingId) { node.src = usePainting(node.paintingId).url; node.type = 'image'; delete node.paintingId; }
      if (node.src) { const asset = doc.assets.find(a => a.url === node.src); if (asset) keepAssets.add(asset.id); }
      if (node.scene?.material?.textureAssetId) keepAssets.add(node.scene.material.textureAssetId);
    }
  }
  doc.boards = doc.boards.filter(b => boards.has(b.id));
  for (const board of doc.boards) {
    const hidden = new Set(board.elements.filter(e => !e.visible).map(e => e.id));
    let changed = true;
    while (changed) { changed = false; for (const e of board.elements) if (e.parentId && hidden.has(e.parentId) && !hidden.has(e.id)) { hidden.add(e.id); changed = true; } }
    board.elements = board.elements.filter(e => !hidden.has(e.id) && !(e.type === 'connector' && [e.start, e.end].some(p => p.binding && hidden.has(p.binding.elementId)))).map(e => {
      if (e.type !== 'painting') return e;
      const { paintingId, ...base } = e;
      return { ...base, type: 'image' as const, assetId: usePainting(paintingId).id };
    });
    const ids = new Set(board.elements.map(e => e.id));
    board.mindMap = board.mindMap?.filter(n => ids.has(n.elementId)).map(n => n.parentId && !ids.has(n.parentId) ? { ...n, parentId: undefined } : n);
  }
  doc.paintings = [];
  visitDocumentAssetIds(doc, id => { keepAssets.add(id); return id; });
  doc.assets = doc.assets.filter(a => keepAssets.has(a.id));
  const nodes = new Set(doc.pages.flatMap(p => p.nodes.map(n => n.id)));
  if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.filter(t => nodes.has(t.nodeId));
  return doc;
}
