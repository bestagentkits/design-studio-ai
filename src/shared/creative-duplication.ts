import type { DesignDocument, DesignNode } from './schema';

/** Immutable pixel assets may be shared; editable boards/layer manifests must not be. */
export function duplicateCreativeEmbeds(doc: DesignDocument, nodes: DesignNode[], nextId = () => crypto.randomUUID()) {
  if (doc.schemaVersion !== 2) return;
  const paintings = new Map<string, string>(), boards = new Map<string, string>();
  const paintingCopy = (id: string) => {
    if (paintings.has(id)) return paintings.get(id)!;
    const original = doc.paintings.find(p => p.id === id);
    if (!original) throw new Error('Unknown painting');
    const copy = structuredClone(original); copy.id = nextId();
    const groups = new Map(copy.groups.map(g => [g.id, nextId()]));
    for (const g of copy.groups) g.id = groups.get(g.id)!;
    for (const layer of copy.layers) { layer.id = nextId(); if (layer.groupId) layer.groupId = groups.get(layer.groupId); }
    // Immutable composite bytes remain a valid preview; Save derives a fresh source hash.
    paintings.set(id, copy.id); doc.paintings.push(copy); return copy.id;
  };
  const boardCopy = (id: string) => {
    if (boards.has(id)) return boards.get(id)!;
    const original = doc.boards.find(b => b.id === id);
    if (!original) throw new Error('Unknown board');
    const copy = structuredClone(original); copy.id = nextId();
    const ids = new Map(copy.elements.map(e => [e.id, nextId()]));
    for (const e of copy.elements) {
      e.id = ids.get(e.id)!; if (e.parentId) e.parentId = ids.get(e.parentId);
      if (e.type === 'painting') e.paintingId = paintingCopy(e.paintingId);
      if (e.type === 'connector') for (const p of [e.start, e.end]) if (p.binding) p.binding.elementId = ids.get(p.binding.elementId)!;
    }
    for (const n of copy.mindMap ?? []) { n.elementId = ids.get(n.elementId)!; if (n.parentId) n.parentId = ids.get(n.parentId); }
    boards.set(id, copy.id); doc.boards.push(copy); return copy.id;
  };
  for (const node of nodes) {
    if (node.type === 'board' && node.boardId) node.boardId = boardCopy(node.boardId);
    if (node.type === 'artwork' && node.paintingId) node.paintingId = paintingCopy(node.paintingId);
  }
}
