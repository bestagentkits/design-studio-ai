import type { DesignNode, DesignPage } from './schema';
import type { Layout } from './design-capabilities';

export function childrenOf(page: DesignPage, parentId?: string) { return page.nodes.filter(n => n.parentId === parentId); }
export function subtree(page: DesignPage, id: string): Set<string> {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const n of page.nodes) if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); changed = true; }
  }
  return ids;
}
type Box = Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>;
const constrain = (node: DesignNode, axis: 'width' | 'height', value: number) => Math.min(node.sizing?.[axis === 'width' ? 'maxWidth' : 'maxHeight'] ?? 20000, Math.max(node.sizing?.[axis === 'width' ? 'minWidth' : 'minHeight'] ?? 0, value));
function flexLayout(nodes: DesignNode[], layout: Layout, box: Box) {
  const padding = layout.padding ?? 0, gap = layout.gap ?? 0, row = layout.direction === 'row';
  const main = row ? 'width' : 'height', other = row ? 'height' : 'width';
  const available = Math.max(0, box[main] - 2 * padding), crossAvailable = Math.max(0, box[other] - 2 * padding);
  const lines: DesignNode[][] = [[]]; let used = 0;
  // A fill item has zero flex basis; its minimum size still participates in wrapping.
  for (const node of nodes) {
    node.width = constrain(node, 'width', node.width); node.height = constrain(node, 'height', node.height);
    const basis = node.sizing?.[main] === 'fill' ? constrain(node, main, 0) : node[main];
    let line = lines[lines.length - 1];
    if (layout.wrap && line.length && used + gap + basis > available) { line = []; lines.push(line); used = 0; }
    used += (line.length ? gap : 0) + basis; line.push(node);
  }
  let cross = padding;
  for (const line of lines) {
    const fills = line.filter(n => n.sizing?.[main] === 'fill');
    let remaining = Math.max(0, available - line.filter(n => n.sizing?.[main] !== 'fill').reduce((sum, n) => sum + n[main], 0) - Math.max(0, line.length - 1) * gap);
    let pending = [...fills];
    // Redistribute space after min/max constraints freeze a fill item.
    while (pending.length) {
      const share = remaining / pending.length;
      const total = pending.reduce((sum, n) => sum + constrain(n, main, share), 0);
      if (Math.abs(total - remaining) < 1e-8) { pending.forEach(n => { n[main] = constrain(n, main, share); }); break; }
      const constrained = pending.filter(n => total > remaining ? constrain(n, main, share) > share : constrain(n, main, share) < share);
      if (!constrained.length) { pending.forEach(n => { n[main] = constrain(n, main, share); }); break; }
      for (const node of constrained) { node[main] = constrain(node, main, share); remaining = Math.max(0, remaining - node[main]); }
      pending = pending.filter(n => !constrained.includes(n));
    }
    for (const node of line) if (node.sizing?.[other] === 'fill') node[other] = constrain(node, other, crossAvailable);
    const lineCross = layout.wrap ? Math.max(0, ...line.map(n => n[other])) : crossAvailable;
    const spare = Math.max(0, available - line.reduce((sum, n) => sum + n[main], 0) - Math.max(0, line.length - 1) * gap);
    let cursor = padding + (layout.justify === 'center' ? spare / 2 : layout.justify === 'end' ? spare : 0);
    const spacing = layout.justify === 'space-between' && line.length > 1 ? gap + spare / (line.length - 1) : gap;
    for (const node of line) {
      if (layout.align === 'stretch') node[other] = constrain(node, other, lineCross);
      const offset = Math.max(0, lineCross - node[other]) * (layout.align === 'center' ? .5 : layout.align === 'end' ? 1 : 0);
      node.x = box.x + (row ? cursor : cross + offset); node.y = box.y + (row ? cross + offset : cursor);
      cursor += node[main] + spacing;
    }
    cross += lineCross + gap;
  }
}
// Legacy children remain in page space. Explicit layouts opt into local coordinates.
export function resolveLayout(page: DesignPage): DesignPage {
  const result = structuredClone(page);
  const walk = (parentId: string | undefined, layout: Layout | undefined, box: Box, hidden = false) => {
    const children = childrenOf(result, parentId);
    if (hidden) children.forEach(n => { n.visible = false; });
    if (layout?.mode === 'absolute' && parentId) children.forEach(n => { n.x += box.x; n.y += box.y; });
    if (layout && layout.mode !== 'absolute') {
      const flow = children.filter(n => n.position !== 'absolute' && n.visible !== false);
      if (layout.mode === 'flex') flexLayout(flow, layout, box);
      else {
        const padding = layout.padding ?? 0, gap = layout.gap ?? 0, columns = layout.columns ?? 2;
        const cell = Math.max(0, (box.width - padding * 2 - (columns - 1) * gap) / columns);
        let y = box.y + padding;
        for (let start = 0; start < flow.length; start += columns) {
          const line = flow.slice(start, start + columns);
          line.forEach((node, index) => {
            node.width = constrain(node, 'width', node.sizing?.width === 'fill' || layout.align === 'stretch' ? cell : node.width);
            node.height = constrain(node, 'height', node.height);
            node.x = box.x + padding + index * (cell + gap); node.y = y;
          });
          y += Math.max(0, ...line.map(n => n.height)) + gap;
        }
      }
      children.filter(n => n.position === 'absolute').forEach(n => { n.x += box.x; n.y += box.y; });
    }
    for (const child of children) walk(child.id, child.layout, child, hidden || child.visible === false);
  };
  walk(undefined, page.layout, { x: 0, y: 0, width: page.width, height: page.height });
  const ordered: DesignNode[] = [];
  const order = (parentId?: string) => { for (const n of childrenOf(result, parentId)) { ordered.push(n); order(n.id); } };
  order(); result.nodes = ordered;
  return result;
}
