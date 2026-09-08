import type { DesignNode } from './schema';
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'move';
export function transformNode(node: DesignNode, dx: number, dy: number, handle: Handle, ratio = false): Partial<DesignNode> {
  if (handle === 'move') return { x: node.x + dx, y: node.y + dy };
  if (handle === 'rotate') return { rotation: (node.rotation ?? 0) + dx };
  const angle = (node.rotation ?? 0) * Math.PI / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  let width = Math.max(8, node.width + (handle.includes('e') ? localX : handle.includes('w') ? -localX : 0));
  let height = Math.max(8, node.height + (handle.includes('s') ? localY : handle.includes('n') ? -localY : 0));
  if (ratio && node.width && node.height) { if (Math.abs(width - node.width) > Math.abs(height - node.height)) height = width * node.height / node.width; else width = height * node.width / node.height; }
  const [px, py] = node.pivot ?? [.5, .5];
  const dw = width - node.width, dh = height - node.height;
  const lx = handle.includes('w') ? -dw : 0, ly = handle.includes('n') ? -dh : 0;
  const shiftX = lx + dw * px, shiftY = ly + dh * py;
  return { width, height, x: node.x + shiftX * Math.cos(angle) - shiftY * Math.sin(angle) - dw * px, y: node.y + shiftX * Math.sin(angle) + shiftY * Math.cos(angle) - dh * py };
}
