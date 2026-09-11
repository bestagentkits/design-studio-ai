import { transformedAnchor } from './board-geometry';
import { diagramEndpoint } from './diagram-routing';
import { z } from 'zod';
import { boardElementSchema, creativeId, type Board, type BoardElement } from './board-schema';
import type { DesignDocument } from './schema';
import { upgradeDocument } from './document-upgrade';

const selection = { boardId: creativeId, elementIds: z.array(creativeId).min(1).max(1000) };
export const boardEditingSchemas = [
  z.object({ op: z.literal('transform-board-elements'), ...selection, dx: z.number().finite().default(0), dy: z.number().finite().default(0), scaleX: z.number().positive().max(100).default(1), scaleY: z.number().positive().max(100).default(1), rotation: z.number().finite().default(0), flipX: z.boolean().default(false), flipY: z.boolean().default(false) }),
  z.object({ op: z.literal('group-board-elements'), ...selection, groupId: creativeId, frame: z.boolean().default(false) }),
  z.object({ op: z.literal('ungroup-board-elements'), ...selection }),
  z.object({ op: z.literal('reorder-board-elements'), ...selection, direction: z.enum(['front', 'back', 'forward', 'backward']) }),
  z.object({ op: z.literal('align-board-elements'), ...selection, alignment: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom', 'horizontal', 'vertical']) }),
] as const;
export const boardEditingSchema = z.discriminatedUnion('op', boardEditingSchemas);
export type BoardEditingOperation = z.infer<typeof boardEditingSchema>;
export const isBoardEditingOperation = (a: { op: string }): a is BoardEditingOperation => boardEditingSchemas.some(s => s.shape.op.value === a.op);
export function boardElementLocked(board: Board, element: BoardElement): boolean {
  const seen = new Set<string>(); let current: BoardElement | undefined = element;
  while (current) { if (current.locked || seen.has(current.id)) return true; seen.add(current.id); current = board.elements.find(e => e.id === current?.parentId); }
  return false;
}
export function boardDescendants(board: Board, ids: string[]) {
  const result = new Set(ids); let changed = true;
  while (changed) { changed = false; for (const e of board.elements) if (e.parentId && result.has(e.parentId) && !result.has(e.id)) { result.add(e.id); changed = true; } }
  return board.elements.filter(e => result.has(e.id));
}
export function selectionBounds(elements: BoardElement[]) {
  if (!elements.length) throw new Error('Select at least one element');
  const corners = elements.flatMap(e => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }].map(p => transformedAnchor(e, p)));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, width: Math.max(1, ...corners.map(p => p.x - x)), height: Math.max(1, ...corners.map(p => p.y - y)) };
}
function transform(board: Board, elements: BoardElement[], a: { dx: number; dy: number; scaleX: number; scaleY: number; rotation: number; flipX: boolean; flipY: boolean }) {
  const b = selectionBounds(elements), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const angle = a.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const world = (p: { x: number; y: number }) => { const x = (p.x - cx) * a.scaleX * (a.flipX ? -1 : 1), y = (p.y - cy) * a.scaleY * (a.flipY ? -1 : 1); return { x: cx + x * cos - y * sin + a.dx, y: cy + x * sin + y * cos + a.dy }; };
  if (a.scaleX !== a.scaleY && elements.some(e => e.type !== 'connector' && e.rotation % 180 !== 0)) throw new Error('Use uniform scaling for rotated elements; this board does not represent shear');
  const endpointPositions = new Map(elements.filter(e => e.type === 'connector').flatMap(e => e.type === 'connector' ? [e.start, e.end].map(p => [p, diagramEndpoint(board, p)] as const) : []));
  for (const e of elements) {
    if (e.type === 'connector') {
      for (const p of [e.start, e.end]) p.point = world(endpointPositions.get(p)!);
      e.bends = e.bends.map(world); continue;
    }
    const center = world({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
    e.width *= a.scaleX; e.height *= a.scaleY; e.x = center.x - e.width / 2; e.y = center.y - e.height / 2;
    e.rotation = (a.flipX !== a.flipY ? -e.rotation : e.rotation) + a.rotation; if (a.flipX) e.flipX = !e.flipX; if (a.flipY) e.flipY = !e.flipY;
    if (e.type === 'stroke') e.points = e.points.map(p => ({ ...p, x: p.x * a.scaleX, y: p.y * a.scaleY }));
    if (e.type === 'path') for (const command of e.commands) for (const key of ['x', 'x1', 'x2', 'y', 'y1', 'y2'] as const) if (key in command) (command as unknown as Record<string, number>)[key] *= key[0] === 'x' ? a.scaleX : a.scaleY;
    if (e.type === 'text') e.fontSize *= Math.min(a.scaleX, a.scaleY);
  }
}
export function duplicateBoardSelection(board: Board, ids: string[], nextId: () => string = () => crypto.randomUUID()) {
  const chosen = boardDescendants(board, ids), mapping = new Map(chosen.map(e => [e.id, nextId()]));
  return chosen.map(source => {
    const e = structuredClone(source); e.id = mapping.get(e.id)!; e.parentId = e.parentId ? mapping.get(e.parentId) : undefined; e.locked = false;
    if (e.type === 'connector' && source.type === 'connector') { e.start.point = diagramEndpoint(board, source.start); e.end.point = diagramEndpoint(board, source.end); for (const p of [e.start, e.end]) { if (p.binding && mapping.has(p.binding.elementId)) p.binding.elementId = mapping.get(p.binding.elementId)!; else p.binding = undefined; p.point.x += 24; p.point.y += 24; } e.bends = e.bends.map(p => ({ x: p.x + 24, y: p.y + 24 })); }
    else { e.x += 24; e.y += 24; }
    return e;
  });
}
export function applyBoardEditingOperation(document: DesignDocument, action: BoardEditingOperation): DesignDocument {
  const doc = upgradeDocument(document), board = doc.boards.find(b => b.id === action.boardId);
  if (!board) throw new Error('Unknown board');
  if (new Set(action.elementIds).size !== action.elementIds.length || action.elementIds.some(id => !board.elements.some(e => e.id === id))) throw new Error('Invalid board selection');
  const selected = boardDescendants(board, action.elementIds), ids = new Set(selected.map(e => e.id));
  if (selected.some(e => boardElementLocked(board, e))) throw new Error('Unlock the selection and its parents before editing');
  if (action.op === 'transform-board-elements') transform(board, selected, action);
  else if (action.op === 'group-board-elements') {
    if (board.elements.some(e => e.id === action.groupId)) throw new Error('Group already exists');
    const roots = selected.filter(e => !ids.has(e.parentId ?? ''));
    const b = selectionBounds(selected), parent = roots[0]?.parentId;
    if (selected.some(e => !ids.has(e.parentId ?? '') && e.parentId !== parent)) throw new Error('Group elements in the same parent');
    const group = boardElementSchema.parse({ id: action.groupId, name: action.frame ? 'Frame' : 'Group', type: action.frame ? 'frame' : 'group', ...b, parentId: parent, stroke: '#728077', fill: 'none', strokeWidth: 1, label: 'Frame' });
    for (const e of selected) if (!ids.has(e.parentId ?? '')) e.parentId = group.id;
    board.elements.splice(board.elements.findIndex(e => ids.has(e.id)), 0, group);
  } else if (action.op === 'ungroup-board-elements') {
    const groups = board.elements.filter(e => action.elementIds.includes(e.id) && ['group', 'frame'].includes(e.type));
    const removed = new Set(groups.map(e => e.id));
    for (const e of board.elements) {
      while (e.parentId && removed.has(e.parentId)) e.parentId = groups.find(g => g.id === e.parentId)?.parentId;
      if (e.type === 'connector') for (const p of [e.start, e.end]) if (p.binding && removed.has(p.binding.elementId)) { p.point = diagramEndpoint(board, p); p.binding = undefined; }
    }
    board.elements = board.elements.filter(e => !removed.has(e.id));
    board.mindMap = board.mindMap?.filter(n => !removed.has(n.elementId)).map(n => removed.has(n.parentId ?? '') ? { ...n, parentId: undefined } : n);
    for (const e of board.elements) if (e.type === 'connector') for (const p of [e.start, e.end]) if (p.binding && removed.has(p.binding.elementId)) p.binding = undefined;
  } else if (action.op === 'reorder-board-elements') {
    if (action.direction === 'front') board.elements = [...board.elements.filter(e => !ids.has(e.id)), ...selected];
    else if (action.direction === 'back') board.elements = [...selected, ...board.elements.filter(e => !ids.has(e.id))];
    else { const forward = action.direction === 'forward', list = board.elements; for (let i = forward ? list.length - 2 : 1; forward ? i >= 0 : i < list.length; i += forward ? -1 : 1) { const j = i + (forward ? 1 : -1); if (ids.has(list[i].id) && !ids.has(list[j].id)) [list[i], list[j]] = [list[j], list[i]]; } }
  } else {
    const roots = selected.filter(e => !ids.has(e.parentId ?? '') && e.type !== 'connector'); if (!roots.length) throw new Error('Select shapes or groups to align'); const b = selectionBounds(roots);
    const horizontal = action.alignment === 'horizontal', vertical = action.alignment === 'vertical';
    const ordered = roots.toSorted((a, c) => horizontal ? a.x - c.x : a.y - c.y);
    for (const e of roots) {
      let dx = 0, dy = 0;
      if (action.alignment === 'left') dx = b.x - e.x;
      if (action.alignment === 'center') dx = b.x + (b.width - e.width) / 2 - e.x;
      if (action.alignment === 'right') dx = b.x + b.width - e.width - e.x;
      if (action.alignment === 'top') dy = b.y - e.y;
      if (action.alignment === 'middle') dy = b.y + (b.height - e.height) / 2 - e.y;
      if (action.alignment === 'bottom') dy = b.y + b.height - e.height - e.y;
      if (roots.length > 2 && horizontal) { const gap = (b.width - roots.reduce((sum, n) => sum + n.width, 0)) / (roots.length - 1), index = ordered.indexOf(e); dx = b.x + ordered.slice(0, index).reduce((sum, n) => sum + n.width, 0) + index * gap - e.x; }
      if (roots.length > 2 && vertical) { const gap = (b.height - roots.reduce((sum, n) => sum + n.height, 0)) / (roots.length - 1), index = ordered.indexOf(e); dy = b.y + ordered.slice(0, index).reduce((sum, n) => sum + n.height, 0) + index * gap - e.y; }
      transform(board, boardDescendants(board, [e.id]), { dx, dy, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false });
    }
  }
  return doc;
}
