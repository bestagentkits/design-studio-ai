import type { Board, BoardElement, BoardBounds } from './board-schema';
import type { DesignDocument } from './schema';
import { inkStrokeToSvg } from './ink-stroke';
import { transformedAnchor } from './board-geometry';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function boardElementVisible(board: Board, element: BoardElement): boolean {
  let current: BoardElement | undefined = element;
  const seen = new Set<string>();
  while (current) {
    if (!current.visible || seen.has(current.id)) return false;
    seen.add(current.id); current = board.elements.find(e => e.id === current?.parentId);
  }
  let node = board.mindMap?.find(n => n.elementId === element.id);
  while (node?.parentId) {
    if (seen.has(node.parentId)) return false;
    seen.add(node.parentId); node = board.mindMap?.find(n => n.elementId === node?.parentId);
    if (node?.collapsed) return false;
  }
  return true;
}
export function connectorPoints(board: Board, element: Extract<BoardElement, { type: 'connector' }>) {
  const endpoint = (p: typeof element.start) => {
    const target = p.binding && board.elements.find(e => e.id === p.binding!.elementId);
    return target && p.binding ? transformedAnchor(target, p.binding.anchor) : p.point;
  };
  const a = endpoint(element.start), b = endpoint(element.end);
  const bends = element.bends.length ? element.bends : element.routing === 'elbow' ? [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }] : [];
  return [a, ...bends, b];
}
export function boardElementSvg(board: Board, element: BoardElement, doc: DesignDocument): string {
  if (!boardElementVisible(board, element)) return '';
  const e = element;
  const style = 'stroke' in e ? `fill="${esc(e.fill)}" stroke="${esc(e.stroke)}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"` : '';
  let body = '';
  if (e.type === 'stroke') body = `<path d="${inkStrokeToSvg(e.points, e.strokeWidth)}" fill="${esc(e.stroke)}"/>`;
  else if (e.type === 'path') {
    const d = e.commands.map(c => c.op === 'Z' ? 'Z' : c.op === 'C' ? `C ${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}` : c.op === 'Q' ? `Q ${c.x1} ${c.y1} ${c.x} ${c.y}` : `${c.op} ${c.x} ${c.y}`).join(' ');
    body = `<path d="${d}" ${style}/>`;
  } else if (e.type === 'shape' || e.type === 'frame') {
    body = e.type === 'shape' && e.shape === 'ellipse' ? `<ellipse cx="${e.width / 2}" cy="${e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" ${style}/>`
      : e.type === 'shape' && ['diamond', 'triangle'].includes(e.shape) ? `<polygon points="${e.shape === 'diamond' ? `${e.width / 2},0 ${e.width},${e.height / 2} ${e.width / 2},${e.height} 0,${e.height / 2}` : `${e.width / 2},0 ${e.width},${e.height} 0,${e.height}`}" ${style}/>`
        : `<rect width="${e.width}" height="${e.height}" rx="${e.type === 'shape' ? e.radius : 0}" ${style}/>`;
    if (e.type === 'frame') body += `<text y="-10" font-family="Arial" font-size="16" fill="${esc(e.stroke)}">${esc(e.label)}</text>`;
  } else if (e.type === 'text') {
    body = `<text fill="${esc(e.stroke)}" font-family="${esc(e.fontFamily)}" font-size="${e.fontSize}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${e.text.split('\n').map((line, i) => `<tspan x="${e.align === 'center' ? e.width / 2 : e.align === 'right' ? e.width : 0}" y="${(i * 1.3 + 1) * e.fontSize}">${esc(line)}</tspan>`).join('')}</text>`;
  } else if (e.type === 'connector') {
    const points = connectorPoints(board, e), a = points[0], b = points.at(-1)!;
    const d = e.routing === 'curve' && !e.bends.length ? `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y} ${(a.x + b.x) / 2} ${b.y} ${b.x} ${b.y}` : points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
    body = `<path d="${d}" fill="none" stroke="${esc(e.stroke)}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const [head, point, neighbor] of [[e.startArrow, a, points[1]], [e.endArrow, b, points.at(-2)!]] as const) {
      if (head === 'dot') body += `<circle cx="${point.x}" cy="${point.y}" r="${e.strokeWidth * 2}" fill="${esc(e.stroke)}"/>`;
      if (head === 'arrow') {
        const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x), size = Math.max(10, e.strokeWidth * 4);
        body += `<path d="M ${point.x - size * Math.cos(angle - .5)} ${point.y - size * Math.sin(angle - .5)} L ${point.x} ${point.y} L ${point.x - size * Math.cos(angle + .5)} ${point.y - size * Math.sin(angle + .5)}" fill="none" stroke="${esc(e.stroke)}" stroke-width="${e.strokeWidth}"/>`;
      }
    }
    if (e.label) body += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 8}" text-anchor="middle" font-family="Arial" font-size="16" fill="${esc(e.stroke)}">${esc(e.label)}</text>`;
    return `<g data-board-element="${esc(e.id)}" opacity="${e.opacity}">${body}</g>`;
  } else if ('assetId' in e || e.type === 'painting') {
    if (e.type === 'painting') {
      const painting = doc.schemaVersion === 2 ? doc.paintings.find(p => p.id === e.paintingId) : undefined;
      if (!painting) throw new Error(`Media unavailable for ${e.name}. Save a current painting composite or import its media before rendering.`);
      const assetId = painting.composite?.assetId, url = doc.assets.find(a => a.id === assetId)?.url;
      if (!url) {
        if (painting.layers.some(layer => layer.tiles.length || layer.mask?.tiles.length)) throw new Error(`Media unavailable for ${e.name}. Save a current painting composite or import its media before rendering.`);
      } else body = `<image href="${esc(url)}" width="${e.width}" height="${e.height}" preserveAspectRatio="none"/>`;
    } else {
      const assetId = e.type === 'gif' ? e.posterAssetId : e.assetId;
      const url = doc.assets.find(a => a.id === assetId)?.url;
      if (!url) throw new Error(`Media unavailable for ${e.name}. Save a current painting composite or import its media before rendering.`);
      body = `<image href="${esc(url)}" width="${e.width}" height="${e.height}" preserveAspectRatio="none"/>`;
    }
  }
  return `<g data-board-element="${esc(e.id)}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})" opacity="${e.opacity}">${body}</g>`;
}
export function boardSvg(board: Board, doc: DesignDocument, crop: BoardBounds, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none" overflow="hidden"><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" fill="${esc(board.background)}"/>${board.elements.map(e => boardElementSvg(board, e, doc)).join('')}</svg>`;
}
