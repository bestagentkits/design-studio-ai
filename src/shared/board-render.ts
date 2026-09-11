import { boardSketchOutline } from './board-sketch';
import { diagramConnectorPoints, diagramLabelPoint, diagramEndpoint, DiagramRoutingError } from './diagram-routing';
import { diagramHiddenIds } from './diagram-layout';
import { diagramNodeSvg } from './diagram-render';
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
  return diagramConnectorPoints(board, element);
}
export function boardElementSvg(board: Board, element: BoardElement, doc: DesignDocument): string {
  if (!boardElementVisible(board, element) || diagramHiddenIds(board).has(element.id)) return '';
  const e = element;
  let opacity = e.opacity; const frames: BoardElement[] = []; let parent = board.elements.find(p => p.id === e.parentId);
  while (parent) { opacity *= parent.opacity; if (parent.type === 'frame') frames.push(parent); parent = board.elements.find(p => p.id === parent!.parentId); }
  const wrap = (svg: string) => frames.reduce((out, frame) => `<defs><clipPath id="clip-${board.id}-${e.id}-${frame.id}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" transform="rotate(${frame.rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})"/></clipPath></defs><g clip-path="url(#clip-${board.id}-${e.id}-${frame.id})">${out}</g>`, svg);
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
    let points: ReturnType<typeof connectorPoints>, routeWarning = '';
    try { points = connectorPoints(board, e); } catch (error) {
      if (!(error instanceof DiagramRoutingError)) throw error;
      // Overlapping obstacles can make routing impossible. Keep the actual connection visible and mark it for repair.
      points = [diagramEndpoint(board, e.start), diagramEndpoint(board, e.end)]; routeWarning = error.message;
    }
    const a = points[0], b = points.at(-1)!;
    const d = e.routing === 'curve' && points.length === 2 ? `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y} ${(a.x + b.x) / 2} ${b.y} ${b.x} ${b.y}` : points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
    body = `${routeWarning ? `<title>${esc(routeWarning)}</title>` : ''}<path ${routeWarning ? 'data-route-warning="true" stroke-dasharray="6 4"' : ''} d="${d}" fill="none" stroke="${esc(e.stroke)}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const [head, point, neighbor] of [[e.startArrow, a, points[1]], [e.endArrow, b, points.at(-2)!]] as const) {
      if (head === 'dot') body += `<circle cx="${point.x}" cy="${point.y}" r="${e.strokeWidth * 2}" fill="${esc(e.stroke)}"/>`;
      if (head === 'arrow') {
        const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x), size = Math.max(10, e.strokeWidth * 4);
        body += `<path d="M ${point.x - size * Math.cos(angle - .5)} ${point.y - size * Math.sin(angle - .5)} L ${point.x} ${point.y} L ${point.x - size * Math.cos(angle + .5)} ${point.y - size * Math.sin(angle + .5)}" fill="none" stroke="${esc(e.stroke)}" stroke-width="${e.strokeWidth}"/>`;
      }
    }
    const labelPoint = diagramLabelPoint(points, e.labelPosition);
    if (e.label) body += `<text x="${labelPoint.x}" y="${labelPoint.y - 8}" text-anchor="middle" font-family="${esc(e.labelFontFamily)}" font-size="${e.labelFontSize}" fill="${esc(e.stroke)}">${esc(e.label)}</text>`;
    return wrap(`<g data-board-element="${esc(e.id)}" opacity="${opacity}">${body}</g>`);
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
  body += boardSketchOutline(e);
  body += diagramNodeSvg(e, doc);
  return wrap(`<g data-board-element="${esc(e.id)}" transform="translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2}) translate(${e.flipX ? e.width : 0} ${e.flipY ? e.height : 0}) scale(${e.flipX ? -1 : 1} ${e.flipY ? -1 : 1})" opacity="${opacity}">${body}</g>`);
}
export function boardSvg(board: Board, doc: DesignDocument, crop: BoardBounds, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none" overflow="hidden"><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" fill="${esc(board.background)}"/>${board.elements.map(e => boardElementSvg(board, e, doc)).join('')}</svg>`;
}
