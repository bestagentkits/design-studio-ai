import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import { subtree } from '../shared/layout';
import { interpolateNode } from '../shared/render';

export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}
export function isNodeProtected(page: DesignPage, node: DesignNode): boolean {
  let current: DesignNode | undefined = node;
  while (current) {
    if (current.locked || current.visible === false) return true;
    current = page.nodes.find(item => item.id === current!.parentId);
  }
  return false;
}
/** A selected ancestor owns its descendants, so no subtree is transformed twice. */
export function selectedRoots(page: DesignPage, ids: readonly string[], protectSubtree = true): DesignNode[] {
  const selected = new Set(ids);
  return page.nodes.filter(node => {
    if (!selected.has(node.id) || isNodeProtected(page, node)) return false;
    let parent = page.nodes.find(item => item.id === node.parentId);
    while (parent) { if (selected.has(parent.id)) return false; parent = page.nodes.find(item => item.id === parent!.parentId); }
    const descendants = protectSubtree ? subtree(page, node.id) : new Set<string>();
    return !page.nodes.some(item => item.locked && descendants.has(item.id));
  });
}
export function canMoveNode(page: DesignPage, node: DesignNode): boolean {
  const parent = page.nodes.find(item => item.id === node.parentId);
  const layout = parent?.layout ?? (!node.parentId ? page.layout : undefined);
  return !layout || layout.mode === 'absolute' || node.position === 'absolute';
}
export function localMovement(doc: DesignDocument, page: DesignPage, node: DesignNode, time: number, dx: number, dy: number) {
  let rotation = 0, parent = page.nodes.find(item => item.id === node.parentId);
  while (parent) { rotation += interpolateNode(parent, doc, time).rotation ?? 0; parent = page.nodes.find(item => item.id === parent!.parentId); }
  const angle = rotation * Math.PI / 180;
  return { x: dx * Math.cos(angle) + dy * Math.sin(angle), y: -dx * Math.sin(angle) + dy * Math.cos(angle) };
}
/** Explicit layouts store child coordinates locally; legacy containers use page coordinates. */
export function moveNodeTree(page: DesignPage, target: DesignNode, dx: number, dy: number, patch: (node: DesignNode, values: Partial<DesignNode>) => void) {
  patch(target, { x: target.x + dx, y: target.y + dy });
  const walk = (parent: DesignNode) => {
    for (const child of page.nodes.filter(item => item.parentId === parent.id)) {
      if (!parent.layout) patch(child, { x: child.x + dx, y: child.y + dy });
      walk(child);
    }
  };
  walk(target);
}
