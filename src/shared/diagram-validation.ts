import type { Board } from './board-schema';
import { diagramRoles, type SemanticElement } from './diagram-presets';
import { diagramEndpoint } from './diagram-routing';
export function diagramValidationErrors(board: Board): string[] {
  const errors: string[] = [], ids = new Set(board.elements.map(e => e.id));
  for (const e of board.elements as SemanticElement[]) {
    if (e.diagram && !diagramRoles[e.diagram.family].includes(e.diagram.role)) errors.push('Role is not available for this diagram family');
    if (e.diagram && new Set(e.diagram.ports.map(p => p.id)).size !== e.diagram.ports.length) errors.push('Duplicate diagram port');
    if (e.type === 'connector') for (const endpoint of [e.start, e.end]) { try { diagramEndpoint(board, endpoint); } catch (error) { errors.push((error as Error).message); } }
  }
  const nodes = new Map((board.mindMap ?? []).map(n => [n.elementId, n]));
  if (nodes.size !== board.mindMap?.length && board.mindMap) errors.push('Duplicate mind-map node');
  for (const node of nodes.values()) {
    if (!ids.has(node.elementId)) errors.push('Mind-map element does not exist');
    const seen = new Set([node.elementId]); let parent = node.parentId;
    while (parent) { if (!nodes.has(parent)) { errors.push('Mind-map parent does not exist'); break; } if (seen.has(parent)) { errors.push('Mind-map parent cycle'); break; } seen.add(parent); parent = nodes.get(parent)?.parentId; }
  }
  return errors;
}
