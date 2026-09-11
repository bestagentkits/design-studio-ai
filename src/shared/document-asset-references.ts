import type { AssetRef, DesignDocument } from './schema';

/** Explicit references only: free-form text and opaque user data must never be rewritten. */
export function visitDocumentAssetIds(doc: DesignDocument, visit: (id: string) => string): void {
  for (const page of doc.pages) for (const node of page.nodes) {
    if (node.scene?.material?.textureAssetId) node.scene.material.textureAssetId = visit(node.scene.material.textureAssetId);
  }
  for (const character of doc.characters ?? []) for (const attachment of character.attachments) {
    if (attachment.assetId) attachment.assetId = visit(attachment.assetId);
    if (attachment.frames) attachment.frames = attachment.frames.map(visit);
  }
  if (doc.schemaVersion !== 2) return;
  for (const board of doc.boards) for (const element of board.elements) {
    if ('assetId' in element) element.assetId = visit(element.assetId);
    if (element.type === 'gif') element.posterAssetId = visit(element.posterAssetId);
  }
  for (const painting of doc.paintings) {
    if (painting.composite) painting.composite.assetId = visit(painting.composite.assetId);
    for (const layer of painting.layers) for (const tile of [...layer.tiles, ...layer.mask?.tiles ?? []]) tile.assetId = visit(tile.assetId);
  }
}
export function ownedDocumentAssetIds(doc: DesignDocument): Set<string> {
  const refs = new Set<string>();
  for (const asset of doc.assets) if (asset.url.startsWith('/api/assets/')) refs.add(asset.url.slice('/api/assets/'.length));
  for (const page of doc.pages) for (const node of page.nodes) if (node.src?.startsWith('/api/assets/')) refs.add(node.src.slice('/api/assets/'.length));
  return refs;
}
export function remapDocumentAssets(doc: DesignDocument, mapping: Map<string, AssetRef>): void {
  const registry = new Map(doc.assets.map(asset => [asset.id, mapping.get(asset.url.split('/').pop()!)?.id ?? asset.id]));
  visitDocumentAssetIds(doc, id => registry.get(id) ?? id);
  doc.assets = doc.assets.map(asset => mapping.get(asset.url.split('/').pop()!) ?? asset);
  for (const asset of mapping.values()) if (!doc.assets.some(a => a.id === asset.id)) doc.assets.push(asset);
  for (const page of doc.pages) for (const node of page.nodes) if (node.src?.startsWith('/api/assets/')) {
    const replacement = mapping.get(node.src.split('/').pop()!);
    if (replacement) node.src = replacement.url;
  }
}
