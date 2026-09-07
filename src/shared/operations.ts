import { z } from 'zod';
import { documentSchema, nodeSchema, pageSchema, themeSchema, uid, type DesignDocument } from './schema';
import { createBlock, themes } from './catalog';

export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add-node'), pageId: z.string(), node: nodeSchema }),
  z.object({ op: z.literal('update-node'), nodeId: z.string(), changes: nodeSchema.partial().omit({ id: true }) }),
  z.object({ op: z.literal('remove-node'), nodeId: z.string() }),
  z.object({ op: z.literal('add-page'), page: pageSchema }),
  z.object({ op: z.literal('remove-page'), pageId: z.string() }),
  z.object({ op: z.literal('set-theme'), theme: themeSchema }),
  z.object({ op: z.literal('apply-theme'), themeId: z.string() }),
  z.object({ op: z.literal('insert-block'), pageId: z.string(), blockId: z.string(), offset: z.number().optional() }),
  z.object({ op: z.literal('rename'), name: z.string().min(1).max(200) }),
  z.object({ op: z.literal('set-timeline'), timeline: z.object({ duration: z.number(), fps: z.number(), tracks: z.array(z.object({ id: z.string(), nodeId: z.string(), keyframes: z.array(z.object({ time: z.number(), values: z.record(z.string(), z.union([z.string(), z.number()])) })) })) }) })
]);
export const operationsSchema = z.array(operationSchema).min(1).max(100);
export type DesignOperation = z.infer<typeof operationSchema>;
export function mutateDocument(document: DesignDocument, input: unknown): DesignDocument {
  const operations = operationsSchema.parse(input);
  const doc = structuredClone(document);
  for (const action of operations) {
    if (action.op === 'rename') doc.name = action.name;
    else if (action.op === 'set-theme') doc.theme = action.theme;
    else if (action.op === 'apply-theme') { const theme = themes.find(t => t.id === action.themeId); if (!theme) throw new Error('Unknown theme'); doc.theme = structuredClone(theme); }
    else if (action.op === 'set-timeline') doc.timeline = action.timeline;
    else if (action.op === 'add-page') doc.pages.push(action.page);
    else if (action.op === 'remove-page') { const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page'); doc.pages = doc.pages.filter(p => p.id !== action.pageId); const removed = new Set(page.nodes.map(n => n.id)); if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.filter(t => !removed.has(t.nodeId)); }
    else if (action.op === 'add-node' || action.op === 'insert-block') {
      const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page');
      page.nodes.push(...(action.op === 'add-node' ? [action.node] : createBlock(action.blockId, action.offset ?? 0)));
    } else {
      const page = doc.pages.find(p => p.nodes.some(n => n.id === action.nodeId)); if (!page) throw new Error('Unknown node');
      if (action.op === 'update-node') {
        const node = page.nodes.find(n => n.id === action.nodeId)!;
        const style = action.changes.style ? { ...node.style, ...action.changes.style } : node.style;
        Object.assign(node, action.changes, { style });
      } else {
        const removed = new Set([action.nodeId]);
        let grew = true;
        while (grew) { grew = false; for (const node of page.nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); grew = true; } }
        page.nodes = page.nodes.filter(n => !removed.has(n.id));
        if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.filter(t => !removed.has(t.nodeId));
      }
    }
  }
  doc.metadata.updatedAt = new Date().toISOString();
  return documentSchema.parse(doc);
}
export function duplicateDocument(doc: DesignDocument, name = `${doc.name} copy`): DesignDocument {
  const copy = structuredClone(doc); const mapping = new Map<string, string>();
  for (const page of copy.pages) { page.id = uid(); for (const node of page.nodes) mapping.set(node.id, uid()); }
  for (const page of copy.pages) for (const node of page.nodes) { node.id = mapping.get(node.id)!; if (node.parentId) node.parentId = mapping.get(node.parentId); }
  if (copy.timeline) for (const track of copy.timeline.tracks) { track.id = uid(); track.nodeId = mapping.get(track.nodeId)!; }
  copy.id = uid(); copy.name = name; copy.metadata = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return documentSchema.parse(copy);
}
