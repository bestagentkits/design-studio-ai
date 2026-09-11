import { assertPaintingTransition } from './painting-transition';
import { z } from 'zod';
import { boardSchema, boardElementSchema, creativeId } from './board-schema';
import { paintingSchema } from './painting-schema';
import { upgradeDocument } from './document-upgrade';
import type { DesignDocument } from './schema';

export const creativeOperationSchemas = [
  z.object({ op: z.literal('add-board'), board: boardSchema }),
  z.object({ op: z.literal('upsert-board-elements'), boardId: creativeId, elements: z.array(boardElementSchema).min(1).max(1000) }),
  z.object({ op: z.literal('remove-board-elements'), boardId: creativeId, elementIds: z.array(creativeId).min(1).max(1000) }),
  z.object({ op: z.literal('add-painting'), painting: paintingSchema }),
  z.object({ op: z.literal('replace-painting'), expectedGeneration: z.number().int().nonnegative(), painting: paintingSchema }),
] as const;
const creativeOperationSchema = z.discriminatedUnion('op', creativeOperationSchemas);
export type CreativeOperation = z.infer<typeof creativeOperationSchema>;
export function isCreativeOperation(action: { op: string }): action is CreativeOperation {
  return ['add-board', 'upsert-board-elements', 'remove-board-elements', 'add-painting', 'replace-painting'].includes(action.op);
}
export function applyCreativeOperation(document: DesignDocument, action: CreativeOperation): DesignDocument {
  const doc = upgradeDocument(document);
  if (action.op === 'add-board') {
    if (doc.boards.some(b => b.id === action.board.id)) throw new Error('Board already exists');
    doc.boards.push(structuredClone(action.board));
  } else if (action.op === 'add-painting') {
    if (doc.paintings.some(p => p.id === action.painting.id)) throw new Error('Painting already exists');
    if (action.painting.generation !== 0) throw new Error('New paintings start at generation 0');
    doc.paintings.push(structuredClone(action.painting));
  } else if (action.op === 'replace-painting') {
    const index = doc.paintings.findIndex(p => p.id === action.painting.id);
    if (index < 0) throw new Error('Unknown painting');
    if (doc.paintings[index].generation !== action.expectedGeneration) throw new Error('Painting changed. Reload before applying pixels or layer settings.');
    if (action.painting.generation !== action.expectedGeneration + 1) throw new Error('Painting generation must increase by one');
    assertPaintingTransition(doc.paintings[index], action.painting);
    doc.paintings[index] = structuredClone(action.painting);
  } else {
    const board = doc.boards.find(b => b.id === action.boardId);
    if (!board) throw new Error('Unknown board');
    if (action.op === 'upsert-board-elements') {
      if (new Set(action.elements.map(e => e.id)).size !== action.elements.length) throw new Error('Duplicate element in operation');
      for (const element of action.elements) {
        const index = board.elements.findIndex(e => e.id === element.id);
        if (index < 0) board.elements.push(structuredClone(element)); else {
          if (board.elements[index].locked && JSON.stringify(board.elements[index]) !== JSON.stringify({ ...element, locked: true })) throw new Error('Unlock the element before editing');
          board.elements[index] = structuredClone(element);
        }
      }
    } else {
      const removed = new Set(action.elementIds);
      if ([...removed].some(id => !board.elements.some(e => e.id === id))) throw new Error('Unknown board element');
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of board.elements) if (!removed.has(e.id) && ((e.parentId && removed.has(e.parentId)) || (e.type === 'connector' && [e.start, e.end].some(p => p.binding && removed.has(p.binding.elementId))))) { removed.add(e.id); grew = true; }
      }
      if (board.elements.some(e => removed.has(e.id) && e.locked)) throw new Error('Unlock affected elements before deleting');
      board.elements = board.elements.filter(e => !removed.has(e.id));
      board.mindMap = board.mindMap?.filter(e => !removed.has(e.elementId)).map(e => removed.has(e.parentId ?? '') ? { ...e, parentId: undefined } : e);
    }
  }
  return doc;
}
