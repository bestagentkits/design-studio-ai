import type { Board, BoardElement } from './board-schema';
import { transformedAnchor, type BoardPoint } from './board-geometry';
import type { SemanticElement } from './diagram-presets';
export class DiagramRoutingError extends Error {}
type Connector = Extract<BoardElement, { type: 'connector' }>;
type Box = { x: number; y: number; width: number; height: number };
export function diagramEndpoint(board: Board, endpoint: Connector['start']): BoardPoint {
  if (!endpoint.binding) return endpoint.point;
  const target = board.elements.find(e => e.id === endpoint.binding!.elementId) as SemanticElement | undefined;
  if (!target) throw new Error('Connector target does not exist');
  const port = endpoint.binding.port && target.diagram?.ports.find(p => p.id === endpoint.binding!.port);
  if (endpoint.binding.port && target.diagram && !port) throw new Error('Connector port does not exist');
  return transformedAnchor(target, port || endpoint.binding.anchor);
}
/** Bind pointer-created edges to the nearest transformed side or declared semantic port. */
export function nearestDiagramBinding(element: BoardElement, point: BoardPoint): NonNullable<Connector['start']['binding']> {
  const ports = element.diagram?.ports.length ? element.diagram.ports : [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }];
  const port = ports.reduce((best, next) => { const a=transformedAnchor(element,best),b=transformedAnchor(element,next);return Math.hypot(b.x-point.x,b.y-point.y)<Math.hypot(a.x-point.x,a.y-point.y)?next:best; });
  return { elementId: element.id, anchor: { x: port.x, y: port.y }, ...('id' in port ? { port: port.id } : {}) };
}
function blocked(a: BoardPoint, b: BoardPoint, boxes: Box[]): boolean {
  return boxes.some(r => a.x === b.x ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height :
    a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width);
}
/** Bounded rectilinear visibility graph. Exhaustion reports a capability error, never a crossing fallback. */
export function orthogonalRoute(a: BoardPoint, b: BoardPoint, boxes: Box[]): BoardPoint[] {
  const clear = (route: BoardPoint[]) => route.slice(1).every((p,i) => !blocked(route[i],p,boxes));
  const simple = [a.x === b.x || a.y === b.y ? [a,b] : [], [a,{x:b.x,y:a.y},b], [a,{x:a.x,y:b.y},b]].filter(p=>p.length);
  for (const route of simple) if (clear(route)) return route.filter((p,i)=>!i || p.x!==route[i-1].x || p.y!==route[i-1].y);
  if (boxes.length > 100) {
    const left=Math.min(a.x,b.x)-128,right=Math.max(a.x,b.x)+128,top=Math.min(a.y,b.y)-128,bottom=Math.max(a.y,b.y)+128;
    const local=boxes.filter(r=>r.x<right && r.x+r.width>left && r.y<bottom && r.y+r.height>top);
    if(local.length<=100) { try { const route=orthogonalRoute(a,b,local); if(clear(route)) return route; } catch { /* Try perimeter routes against every obstacle. */ } }
    const minX=Math.min(a.x,b.x,...boxes.map(r=>r.x))-24,maxX=Math.max(a.x,b.x,...boxes.map(r=>r.x+r.width))+24,minY=Math.min(a.y,b.y,...boxes.map(r=>r.y))-24,maxY=Math.max(a.y,b.y,...boxes.map(r=>r.y+r.height))+24;
    const perimeter=[... [minX,maxX].map(x=>[a,{x,y:a.y},{x,y:b.y},b]),...[minY,maxY].map(y=>[a,{x:a.x,y},{x:b.x,y},b])];
    // Opposite-facing ports may need to leave on opposite sides of the obstacle field.
    for (const x of [minX,maxX]) for (const y of [minY,maxY]) {
      const oppositeX=x===minX?maxX:minX, oppositeY=y===minY?maxY:minY;
      perimeter.push([a,{x,y:a.y},{x,y},{x:oppositeX,y},{x:oppositeX,y:b.y},b]);
      perimeter.push([a,{x:a.x,y},{x,y},{x,y:oppositeY},{x:b.x,y:oppositeY},b]);
    }
    for(const route of perimeter) if(clear(route)) return route;
    throw new DiagramRoutingError('No bounded obstacle-free route; add bends or separate overlapping elements');
  }
  const xs = [...new Set([a.x, b.x, ...boxes.flatMap(r => [r.x, r.x + r.width])])].sort((x, y) => x - y);
  const ys = [...new Set([a.y, b.y, ...boxes.flatMap(r => [r.y, r.y + r.height])])].sort((x, y) => x - y);
  const start = ys.indexOf(a.y) * xs.length + xs.indexOf(a.x), end = ys.indexOf(b.y) * xs.length + xs.indexOf(b.x);
  const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const distance = new Map<number, number>([[start, 0]]), previous = new Map<number, number>(), queue = new Set([start]);
  let visits = 0;
  while (queue.size) {
    if (++visits > 50000) throw new DiagramRoutingError('Routing budget exceeded; narrow the diagram region');
    let current = -1, best = Infinity;
    for (const id of queue) { const p = point(id), score = distance.get(id)! + Math.abs(p.x - b.x) + Math.abs(p.y - b.y); if (score < best) { best = score; current = id; } }
    queue.delete(current);
    if (current === end) { const route = [point(end)]; while (previous.has(current)) { current = previous.get(current)!; route.unshift(point(current)); } return route.filter((p, i) => !i || i === route.length - 1 || !((route[i - 1].x === p.x && p.x === route[i + 1].x) || (route[i - 1].y === p.y && p.y === route[i + 1].y))); }
    const col = current % xs.length, row = Math.floor(current / xs.length), next = [col ? current - 1 : -1, col + 1 < xs.length ? current + 1 : -1, row ? current - xs.length : -1, row + 1 < ys.length ? current + xs.length : -1];
    for (const id of next) {
      if (id < 0) continue;
      const p = point(current), q = point(id); if (blocked(p, q, boxes)) continue;
      const score = distance.get(current)! + Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (score >= (distance.get(id) ?? Infinity)) continue;
      distance.set(id, score); previous.set(id, current); queue.add(id);
    }
  }
  throw new DiagramRoutingError('No obstacle-free route; move overlapping elements or add manual bends');
}
export function diagramConnectorPoints(board: Board, edge: Connector): BoardPoint[] {
  const a = diagramEndpoint(board, edge.start), b = diagramEndpoint(board, edge.end);
  if (edge.bends.length) return [a, ...edge.bends, b];
  if (edge.start.binding && edge.start.binding.elementId === edge.end.binding?.elementId) {
    const node = board.elements.find(e => e.id === edge.start.binding!.elementId)!;
    return [a, { x: node.x + node.width + 40, y: a.y }, { x: node.x + node.width + 40, y: node.y - 40 }, { x: node.x - 40, y: node.y - 40 }, { x: node.x - 40, y: b.y }, b];
  }
  if (edge.routing !== 'elbow') return [a, b];
  const bound = new Set([edge.start.binding?.elementId, edge.end.binding?.elementId]);
  const boxes = board.elements.filter(e => e.visible && !bound.has(e.id) && !['connector', 'group', 'frame'].includes(e.type)).map(e => {
    const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }].map(p => transformedAnchor(e, p));
    const x = Math.min(...corners.map(p => p.x)) - 12, y = Math.min(...corners.map(p => p.y)) - 12;
    return { x, y, width: Math.max(...corners.map(p => p.x)) + 12 - x, height: Math.max(...corners.map(p => p.y)) + 12 - y };
  });
  return orthogonalRoute(a, b, boxes);
}
export function diagramLabelPoint(points: BoardPoint[], fraction = .5): BoardPoint {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) { if (remaining <= lengths[i]) { const t = lengths[i] ? remaining / lengths[i] : 0; return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t }; } remaining -= lengths[i]; }
  return points.at(-1)!;
}
