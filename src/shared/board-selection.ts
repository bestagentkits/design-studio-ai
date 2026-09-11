import type { Board } from './board-schema';
import { boardDescendants, duplicateBoardSelection } from './board-editing';
import { diagramEndpoint } from './diagram-routing';
/** Capture resolved endpoints before dropping references outside the clipboard. */
export function captureBoardSelection(board: Board, ids: string[]): Board {
  const elements = structuredClone(boardDescendants(board, ids)), chosen = new Set(elements.map(e => e.id));
  for (const e of elements) {
    if (e.parentId && !chosen.has(e.parentId)) e.parentId = undefined;
    if (e.type === 'connector') for (const endpoint of [e.start, e.end]) {
      endpoint.point = diagramEndpoint(board, endpoint);
      if (endpoint.binding && !chosen.has(endpoint.binding.elementId)) endpoint.binding = undefined;
    }
  }
  return { ...board, elements, mindMap: board.mindMap?.filter(n => chosen.has(n.elementId)).map(n => ({ ...n, parentId: n.parentId && chosen.has(n.parentId) ? n.parentId : undefined })) };
}
export function duplicateBoardSelectionBundle(board: Board, ids: string[], nextId: () => string = () => crypto.randomUUID()): Pick<Board, 'elements' | 'mindMap'> {
  const captured = captureBoardSelection(board, ids), mapping = new Map(captured.elements.map(e => [e.id, nextId()]));
  let index = 0; const values = [...mapping.values()];
  return { elements: duplicateBoardSelection(captured, captured.elements.map(e => e.id), () => values[index++]), mindMap: captured.mindMap?.map(n => ({ ...n, elementId: mapping.get(n.elementId)!, parentId: n.parentId ? mapping.get(n.parentId) : undefined })) };
}
