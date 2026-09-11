import { boardElementSchema, type Board, type BoardElement } from './board-schema';
import type { DiagramFamily, DiagramNode } from './diagram-schema';
export type SemanticElement = BoardElement & { diagram?: DiagramNode };
export const diagramRoles: Record<DiagramFamily, DiagramNode['role'][]> = {
  flowchart: ['start', 'process', 'decision', 'end'], architecture: ['actor', 'service', 'database', 'boundary'],
  'user-flow': ['screen', 'decision', 'start', 'end'], 'mind-map': ['topic'],
};
export function diagramNode(id: string, family: DiagramFamily, role: DiagramNode['role'], label: string, x = 0, y = 0): SemanticElement {
  if (!diagramRoles[family].includes(role)) throw new Error('Role is not available for this diagram family');
  const element = boardElementSchema.parse({ id, name: label.slice(0, 200), type: role === 'boundary' ? 'frame' : 'shape', label,
    shape: role === 'decision' ? 'diamond' : ['start', 'end', 'actor'].includes(role) ? 'ellipse' : 'rectangle',
    x, y, width: role === 'boundary' ? 600 : 180, height: role === 'boundary' ? 360 : role === 'screen' ? 160 : 80,
    fill: '#eff6ff', stroke: '#1e40af', strokeWidth: 2 });
  return Object.assign(element, { diagram: { family, role, label, pinned: false, fontFamily: 'Arial', fontSize: 16,
    ports: [{ id: 'top', x: .5, y: 0 }, { id: 'right', x: 1, y: .5 }, { id: 'bottom', x: .5, y: 1 }, { id: 'left', x: 0, y: .5 }] } });
}
export function diagramEdge(id: string, source: string, target: string, label = ''): Extract<BoardElement, { type: 'connector' }> {
  return boardElementSchema.parse({ id, name: label || 'Connection', type: 'connector', x: 0, y: 0, width: 1, height: 1,
    fill: 'none', stroke: '#475569', strokeWidth: 2, start: { point: { x: 0, y: 0 }, binding: { elementId: source, anchor: { x: 1, y: .5 }, port: 'right' } },
    end: { point: { x: 0, y: 0 }, binding: { elementId: target, anchor: { x: 0, y: .5 }, port: 'left' } }, routing: 'elbow', bends: [], startArrow: 'none', endArrow: 'arrow', label }) as Extract<BoardElement, { type: 'connector' }>;
}
export function diagramTemplate(family: DiagramFamily, prefix: string): Pick<Board, 'elements' | 'mindMap'> {
  const roles: DiagramNode['role'][] = family === 'flowchart' ? ['start', 'process', 'decision', 'end', 'process'] : family === 'architecture' ? ['actor', 'service', 'database', 'service'] : family === 'user-flow' ? ['start', 'screen', 'decision', 'screen', 'end'] : ['topic', 'topic', 'topic', 'topic'];
  const labels = family === 'flowchart' ? ['Start', 'Review request', 'Approved?', 'Complete', 'Revise request'] : family === 'architecture' ? ['Customer', 'API service', 'Database', 'Worker'] : family === 'user-flow' ? ['Entry', 'Sign in', 'Account exists?', 'Create account', 'Dashboard'] : ['Main idea', 'Research', 'Design', 'Delivery'];
  const elements: BoardElement[] = roles.map((role, i) => diagramNode(`${prefix}_n${i}`, family, role, labels[i], 60 + i * 260, i === 4 ? 280 : 80));
  const pairs = family === 'flowchart' ? [[0, 1, ''], [1, 2, ''], [2, 3, 'Yes'], [2, 4, 'No'], [4, 1, 'Retry']] : family === 'architecture' ? [[0, 1, 'HTTPS'], [1, 2, 'SQL'], [1, 3, 'Queue'], [3, 2, 'Persist']] : family === 'user-flow' ? [[0, 1, 'Open'], [1, 2, 'Continue'], [2, 4, 'Yes'], [2, 3, 'No'], [3, 4, 'Submit']] : [[0, 1, ''], [0, 2, ''], [0, 3, '']];
  if (family === 'architecture') { const boundary = diagramNode(`${prefix}_boundary`, family, 'boundary', 'Application system', 280, 20); boundary.width = 860; boundary.height = 260; elements.slice(1).forEach(e => { e.parentId = boundary.id; }); elements.unshift(boundary); }
  pairs.forEach(([a, b, label], i) => elements.push(diagramEdge(`${prefix}_e${i}`, `${prefix}_n${a}`, `${prefix}_n${b}`, String(label))));
  return { elements, mindMap: family === 'mind-map' ? roles.map((_, i) => ({ elementId: `${prefix}_n${i}`, parentId: i ? `${prefix}_n0` : undefined, collapsed: false, pinned: false })) : undefined };
}
