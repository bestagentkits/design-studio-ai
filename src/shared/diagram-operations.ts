import { diagramValidationErrors } from './diagram-validation';
export { diagramValidationErrors } from './diagram-validation';
import { boardElementLocked } from './board-editing';
import { z } from 'zod';
import { boardEndpointSchema, boardPointSchema, creativeId, type Board } from './board-schema';
import { diagramFamilySchema, diagramNodeSchema, diagramRoleSchema } from './diagram-schema';
import { diagramEdge, diagramNode, diagramTemplate, diagramRoles, type SemanticElement } from './diagram-presets';
import { diagramEndpoint } from './diagram-routing';
import { layoutDiagram } from './diagram-layout';
import type { DesignDocument } from './schema';
import { upgradeDocument } from './document-upgrade';
export const diagramOperationSchemas = [
  z.object({ op: z.literal('diagram-template'), boardId: creativeId, family: diagramFamilySchema, prefix: creativeId }),
  z.object({ op: z.literal('diagram-node'), boardId: creativeId, id: creativeId, family: diagramFamilySchema, role: diagramRoleSchema, label: z.string().max(2000), x: boardPointSchema.shape.x.default(0), y: boardPointSchema.shape.y.default(0) }),
  z.object({ op: z.literal('diagram-update'), boardId: creativeId, elementId: creativeId, changes: diagramNodeSchema.partial() }),
  z.object({ op: z.literal('diagram-connect'), boardId: creativeId, id: creativeId, sourceId: creativeId, targetId: creativeId, label: z.string().max(2000).default('') }),
  z.object({ op: z.literal('diagram-reconnect'), boardId: creativeId, edgeId: creativeId, endpoint: z.enum(['start', 'end']), value: boardEndpointSchema }),
  z.object({ op: z.literal('diagram-detach'), boardId: creativeId, edgeId: creativeId, endpoint: z.enum(['start', 'end']) }),
  z.object({ op: z.literal('diagram-edge'), boardId: creativeId, edgeId: creativeId, label: z.string().max(2000).optional(), routing: z.enum(['straight', 'elbow', 'curve']).optional(), bends: z.array(boardPointSchema).max(128).optional(), startArrow: z.enum(['none', 'arrow', 'dot']).optional(), endArrow: z.enum(['none', 'arrow', 'dot']).optional(), labelFontFamily: z.string().max(200).optional(), labelFontSize: z.number().min(8).max(128).optional(), labelPosition: z.number().min(0).max(1).optional() }),
  z.object({ op: z.literal('diagram-layout'), boardId: creativeId, mode: z.enum(['layered', 'tree', 'radial']), selectedIds: z.array(creativeId).max(1000).optional() }),
  z.object({ op: z.literal('mind-map-insert'), boardId: creativeId, relativeId: creativeId, relation: z.enum(['child', 'sibling']), id: creativeId, label: z.string().max(2000) }),
  z.object({ op: z.literal('mind-map-state'), boardId: creativeId, elementId: creativeId, parentId: creativeId.nullable().optional(), collapsed: z.boolean().optional(), pinned: z.boolean().optional() }),
] as const;
export const diagramOperationSchema = z.discriminatedUnion('op', diagramOperationSchemas);
export type DiagramOperation = z.infer<typeof diagramOperationSchema>;
export function isDiagramOperation(action: { op: string }): action is DiagramOperation { return diagramOperationSchemas.some(s => s.shape.op.value === action.op); }
export function applyDiagramOperation(document: DesignDocument, input: DiagramOperation): DesignDocument {
  const action = diagramOperationSchema.parse(input), doc = upgradeDocument(document), board = doc.boards.find(b => b.id === action.boardId);
  if (!board) throw new Error('Unknown board');
  const editable = (id: string) => { const node = board.elements.find(e => e.id === id); if (!node) throw new Error('Unknown diagram element'); if (boardElementLocked(board, node)) throw new Error('Unlock the element before editing'); return node; };
  const add = (elements: Board['elements']) => { if (elements.some(e => board.elements.some(n => n.id === e.id))) throw new Error('Diagram identifier already exists'); board.elements.push(...elements); };
  if (action.op === 'diagram-template') { const template = diagramTemplate(action.family, action.prefix);
    // Place a new diagram below existing artwork so its ports are never buried under earlier nodes.
    const bottom = Math.max(0, ...board.elements.filter(e => e.type !== 'connector').map(e => e.y + e.height));
    if (board.elements.length) for (const element of template.elements) { element.y += bottom + 80; if (element.type === 'connector') { element.start.point.y += bottom + 80; element.end.point.y += bottom + 80; element.bends.forEach(p => { p.y += bottom + 80; }); } }
    add(template.elements); if (template.mindMap) board.mindMap = [...board.mindMap ?? [], ...template.mindMap]; }
  else if (action.op === 'diagram-node') { add([diagramNode(action.id, action.family, action.role, action.label, action.x, action.y)]); if (action.family === 'mind-map') board.mindMap = [...board.mindMap ?? [], { elementId: action.id, collapsed: false, pinned: false }]; }
  else if (action.op === 'diagram-connect') { editable(action.sourceId); editable(action.targetId); add([diagramEdge(action.id, action.sourceId, action.targetId, action.label)]); }
  else if (action.op === 'diagram-layout') { const result = layoutDiagram(board, action.mode, action.selectedIds); board.elements = result.elements; }
  else if (action.op === 'diagram-update') { const node = editable(action.elementId) as SemanticElement; if (!node.diagram) throw new Error('Select a semantic diagram node'); node.diagram = diagramNodeSchema.parse({ ...node.diagram, ...action.changes }); if (action.changes.label !== undefined) node.name = action.changes.label.slice(0, 200); }
  else if (action.op === 'mind-map-insert') {
    const relative = editable(action.relativeId), semantic = board.mindMap?.find(n => n.elementId === relative.id);
    if (!semantic) throw new Error('Select a mind-map topic');
    const parentId = action.relation === 'child' ? relative.id : semantic.parentId;
    add([diagramNode(action.id, 'mind-map', 'topic', action.label, relative.x + (action.relation === 'child' ? 260 : 0), relative.y + 140)]);
    board.mindMap!.push({ elementId: action.id, parentId, collapsed: false, pinned: false });
    if (parentId) { editable(parentId); add([diagramEdge(`${action.id}_edge`, parentId, action.id)]); const parent = board.mindMap!.find(n => n.elementId === parentId)!; parent.collapsed = false; }
  } else if (action.op === 'mind-map-state') {
    editable(action.elementId); const node = board.mindMap?.find(n => n.elementId === action.elementId); if (!node) throw new Error('Select a mind-map topic');
    if (action.parentId !== undefined) {
      if (action.parentId) editable(action.parentId);
      const edge = board.elements.find(e => e.type === 'connector' && e.start.binding?.elementId === node.parentId && e.end.binding?.elementId === node.elementId);
      if (edge) editable(edge.id);
      board.elements = board.elements.filter(e => e !== edge);
      node.parentId = action.parentId ?? undefined;
      if (node.parentId) add([diagramEdge(edge?.id ?? `${node.elementId}_parent`, node.parentId, node.elementId)]);
    }
    if (action.collapsed !== undefined) node.collapsed = action.collapsed;
    if (action.pinned !== undefined) node.pinned = action.pinned;
  } else {
    const edge = editable(action.edgeId); if (edge.type !== 'connector') throw new Error('Select a connector');
    if (action.op === 'diagram-reconnect') { diagramEndpoint(board, action.value); edge[action.endpoint] = action.value; }
    else if (action.op === 'diagram-detach') edge[action.endpoint] = { point: diagramEndpoint(board, edge[action.endpoint]) };
    else { const { op: _op, boardId: _board, edgeId: _edge, ...changes } = action; Object.assign(edge, changes); }
  }
  const errors = diagramValidationErrors(board); if (errors.length) throw new Error(errors.join('; '));
  return doc;
}
