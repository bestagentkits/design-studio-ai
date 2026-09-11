import { sceneCommandSchema } from './scene-authoring-schema';
import { applySceneCommand } from './scene-authoring';
import { paintingLayerOperationSchemas, isPaintingLayerOperation, applyPaintingLayerOperation } from './painting-layer-operations';
import { diagramOperationSchemas, isDiagramOperation, applyDiagramOperation } from './diagram-operations';
import { boardEditingSchemas, isBoardEditingOperation, applyBoardEditingOperation } from './board-editing';
import { duplicateCreativeEmbeds } from './creative-duplication';
import { creativeOperationSchemas, isCreativeOperation, applyCreativeOperation } from './board-operations';
import {characterEvolutionErrors} from './character-validation';
import { z } from 'zod';
import { characterOperationSchemas, characterOperationSchema, applyCharacterOperation } from './character-operations';
import { timelineSchema, trackSchema, keyframeSchema } from './design-capabilities';
import { documentSchema, nodeSchema, pageSchema, themeSchema, uid, type DesignDocument, type DesignPage, type DesignNode } from './schema';
import { createBlock, themes } from './catalog';
import { resolveLayout, subtree } from './layout';

const measuredBoundsSchema = z.object({ id: z.string(), x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), width: z.number().finite().min(0).max(20000), height: z.number().finite().min(0).max(20000) });

export const operationSchema = z.discriminatedUnion('op', [
  ...creativeOperationSchemas,
  ...paintingLayerOperationSchemas,
  ...diagramOperationSchemas,
  ...boardEditingSchemas,
  ...characterOperationSchemas,
  z.object({ op: z.literal('scene-command'), pageId: z.string(), command: sceneCommandSchema }),
  z.object({ op: z.literal('add-node'), pageId: z.string(), node: nodeSchema }),
  z.object({ op: z.literal('update-node'), nodeId: z.string(), changes: nodeSchema.partial().omit({ id: true }) }),
  z.object({ op: z.literal('remove-node'), nodeId: z.string() }),
  z.object({ op: z.literal('duplicate-node'), nodeId: z.string(), duplicateId: z.string().optional(), offset: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).optional() }),
  z.object({ op: z.literal('add-page'), page: pageSchema }),
  z.object({ op: z.literal('remove-page'), pageId: z.string() }),
  z.object({ op: z.literal('set-theme'), theme: themeSchema }),
  z.object({ op: z.literal('apply-theme'), themeId: z.string() }),
  z.object({ op: z.literal('insert-block'), pageId: z.string(), blockId: z.string(), offset: z.number().optional() }),
  z.object({ op: z.literal('rename'), name: z.string().min(1).max(200) }),
  z.object({ op: z.literal('set-timeline'), timeline: timelineSchema }),
  z.object({ op: z.literal('upsert-track'), track: trackSchema }),
  z.object({ op: z.literal('remove-track'), trackId: z.string() }),
  z.object({ op: z.literal('upsert-keyframe'), trackId: z.string(), keyframe: keyframeSchema, previousTime: z.number().min(0).optional() }),
  z.object({ op: z.literal('remove-keyframe'), trackId: z.string(), time: z.number().min(0) }),
  z.object({ op: z.literal('reparent-node'), nodeId: z.string(), parentId: z.string().nullable(), index: z.number().int().min(0) }),
  z.object({ op: z.literal('group-nodes'), pageId: z.string(), nodeIds: z.array(z.string()).min(1).max(2000), groupId: z.string().optional(), name: z.string().max(200).optional(), bounds: z.array(measuredBoundsSchema).max(2001).optional() }),
  z.object({ op: z.literal('ungroup-node'), nodeId: z.string() }),
  z.object({ op: z.literal('update-page'), pageId: z.string(), changes: pageSchema.partial().omit({ id: true, nodes: true }) })
]);
export const operationsSchema = z.array(operationSchema).min(1).max(100);
export type DesignOperation = z.infer<typeof operationSchema>;
function freezeFillSizing(node: DesignNode) {
  if (node.sizing?.width === 'fill') node.sizing.width = 'fixed';
  if (node.sizing?.height === 'fill') node.sizing.height = 'fixed';
}
function offsetNodeKeyframes(doc: DesignDocument, nodeId: string, x: number, y: number) {
  for (const track of doc.timeline?.tracks.filter(t => t.nodeId === nodeId) ?? []) for (const key of track.keyframes) {
    if (typeof key.values.x === 'number') key.values.x += x;
    if (typeof key.values.y === 'number') key.values.y += y;
  }
}
function convertChildrenToAbsolute(doc: DesignDocument, page: DesignPage, parentId?: string) {
  const resolved = resolveLayout(page), parent = resolved.nodes.find(n => n.id === parentId);
  for (const node of page.nodes.filter(n => n.parentId === parentId)) {
    const box = resolved.nodes.find(n => n.id === node.id)!;
    offsetNodeKeyframes(doc, node.id, parent && !parent.layout ? -parent.x : 0, parent && !parent.layout ? -parent.y : 0);
    node.x = box.x - (parent?.x ?? 0); node.y = box.y - (parent?.y ?? 0); node.width = box.width; node.height = box.height; freezeFillSizing(node);
  }
}
export function mutateDocument(document: DesignDocument, input: unknown): DesignDocument {
  const operations = operationsSchema.parse(input);
  let doc = structuredClone(document);
  for (const action of operations) {
    if (isPaintingLayerOperation(action)) doc = applyPaintingLayerOperation(doc, action);
    else if (isDiagramOperation(action)) doc = applyDiagramOperation(doc, action);
    else if (isBoardEditingOperation(action)) doc = applyBoardEditingOperation(doc, action);
    else if (isCreativeOperation(action)) doc = applyCreativeOperation(doc, action);
    else if (action.op === 'bake-character' || action.op === 'upsert-character' || action.op === 'remove-character' || action.op === 'upsert-bone' || action.op === 'upsert-slot' || action.op === 'upsert-attachment' || action.op === 'upsert-skin' || action.op === 'upsert-clip' || action.op === 'upsert-constraint' || action.op === 'remove-character-item' || action.op === 'upsert-channel' || action.op === 'remove-channel' || action.op === 'upsert-motion-key' || action.op === 'remove-motion-key') { applyCharacterOperation(doc,characterOperationSchema.parse(action)); }
    else if (action.op === 'scene-command') applySceneCommand(doc, action.pageId, action.command);
    else if (action.op === 'rename') doc.name = action.name;
    else if (action.op === 'set-theme') doc.theme = action.theme;
    else if (action.op === 'apply-theme') { const theme = themes.find(t => t.id === action.themeId); if (!theme) throw new Error('Unknown theme'); doc.theme = structuredClone(theme); }
    else if (action.op === 'set-timeline') doc.timeline = action.timeline;
    else if (action.op === 'upsert-track' || action.op === 'remove-track' || action.op === 'upsert-keyframe' || action.op === 'remove-keyframe') {
      if (!doc.timeline) throw new Error('Create a timeline before editing tracks');
      if (action.op === 'upsert-track') {
        const index = doc.timeline.tracks.findIndex(t => t.id === action.track.id);
        if (index < 0) doc.timeline.tracks.push(action.track); else doc.timeline.tracks[index] = action.track;
      } else {
        const track = doc.timeline.tracks.find(t => t.id === action.trackId);
        if (!track) throw new Error('Unknown track');
        if (action.op === 'remove-track') doc.timeline.tracks = doc.timeline.tracks.filter(t => t !== track);
        else {
          if (track.locked) throw new Error('Unlock the track before editing keyframes');
          const oldTime = action.op === 'remove-keyframe' ? action.time : action.previousTime ?? action.keyframe.time;
          track.keyframes = track.keyframes.filter(f => f.time !== oldTime);
          if (action.op === 'upsert-keyframe') track.keyframes.push(action.keyframe);
          track.keyframes.sort((a, b) => a.time - b.time);
        }
      }
    }
    else if (action.op === 'update-page') { const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page'); if (action.changes.layout?.mode === 'absolute' && page.layout?.mode !== 'absolute') convertChildrenToAbsolute(doc, page); Object.assign(page, action.changes); }
    else if (action.op === 'group-nodes') {
      const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page');
      const ids = new Set(action.nodeIds), selected = page.nodes.filter(n => ids.has(n.id));
      if (selected.length !== ids.size || selected.some(n => n.parentId !== selected[0].parentId)) throw new Error('Group existing sibling nodes');
      const resolved = resolveLayout(page), measurements = new Map(action.bounds?.map(box => [box.id, box]));
      const parentId = selected[0].parentId;
      if (action.bounds && (measurements.size !== action.bounds.length || action.bounds.some(box => !ids.has(box.id) && box.id !== parentId) || selected.some(node => !measurements.has(node.id)) || (parentId && !measurements.has(parentId)))) throw new Error('Measured bounds must uniquely cover grouped members and their direct parent only');
      const boxes = resolved.nodes.filter(n => ids.has(n.id)).map(node => ({ ...node, ...measurements.get(node.id) }));
      const x = Math.min(...boxes.map(n => n.x)), y = Math.min(...boxes.map(n => n.y));
      const resolvedParent = resolved.nodes.find(n => n.id === parentId), parent = resolvedParent ? { ...resolvedParent, ...measurements.get(resolvedParent.id) } : undefined;
      const group = { id: action.groupId ?? uid(), name: action.name ?? 'Group', type: 'group' as const, parentId: selected[0].parentId, x: x - (parent?.layout ? parent.x : 0), y: y - (parent?.layout ? parent.y : 0), width: Math.max(...boxes.map(n => n.x + n.width)) - x, height: Math.max(...boxes.map(n => n.y + n.height)) - y, layout: { mode: 'absolute' as const } };
      for (const node of selected) { const box = boxes.find(b => b.id === node.id)!; offsetNodeKeyframes(doc, node.id, (parent?.layout ? parent.x : 0) - x, (parent?.layout ? parent.y : 0) - y); node.parentId = group.id; node.x = box.x - x; node.y = box.y - y; node.width = box.width; node.height = box.height; freezeFillSizing(node); }
      page.nodes.splice(page.nodes.indexOf(selected[0]), 0, group);
    }
    else if (action.op === 'ungroup-node') {
      const page = doc.pages.find(p => p.nodes.some(n => n.id === action.nodeId));
      const group = page?.nodes.find(n => n.id === action.nodeId); if (!page || group?.type !== 'group') throw new Error('Select a group to ungroup');
      if (doc.timeline?.tracks.some(t => t.nodeId === group.id) || group.rotation) throw new Error('Remove group animation/rotation before ungrouping');
      const resolved = resolveLayout(page), parent = resolved.nodes.find(n => n.id === group.parentId), groupBox = resolved.nodes.find(n => n.id === group.id)!;
      for (const node of page.nodes.filter(n => n.parentId === group.id)) { const box = resolved.nodes.find(n => n.id === node.id)!; offsetNodeKeyframes(doc, node.id, (group.layout ? groupBox.x : 0) - (parent?.layout ? parent.x : 0), (group.layout ? groupBox.y : 0) - (parent?.layout ? parent.y : 0)); node.parentId = group.parentId; node.x = box.x - (parent?.layout ? parent.x : 0); node.y = box.y - (parent?.layout ? parent.y : 0); node.width = box.width; node.height = box.height; freezeFillSizing(node); }
      page.nodes = page.nodes.filter(n => n.id !== group.id);
    }
    else if (action.op === 'reparent-node') {
      const page = doc.pages.find(p => p.nodes.some(n => n.id === action.nodeId)); if (!page) throw new Error('Unknown node');
      const node = page.nodes.find(n => n.id === action.nodeId)!;
      const resolved = resolveLayout(page), bounds = resolved.nodes.find(n => n.id === node.id)!, target = resolved.nodes.find(n => n.id === action.parentId);
      if (action.parentId && !page.nodes.some(n => n.id === action.parentId && ['frame', 'group', 'component'].includes(n.type))) throw new Error('Parent must be a container on the same page');
      const oldParent = resolved.nodes.find(n => n.id === node.parentId);
      offsetNodeKeyframes(doc, node.id, (oldParent?.layout ? oldParent.x : 0) - (target?.layout ? target.x : 0), (oldParent?.layout ? oldParent.y : 0) - (target?.layout ? target.y : 0));
      if (action.parentId) node.parentId = action.parentId; else delete node.parentId;
      node.x = bounds.x - (target?.layout ? target.x : 0); node.y = bounds.y - (target?.layout ? target.y : 0);
      page.nodes = page.nodes.filter(n => n.id !== node.id);
      const siblings = page.nodes.filter(n => n.parentId === node.parentId);
      const before = siblings[action.index]; const at = before ? page.nodes.indexOf(before) : page.nodes.length;
      page.nodes.splice(at, 0, node);
    }
    else if (action.op === 'duplicate-node') {
      const page = doc.pages.find(p => p.nodes.some(n => n.id === action.nodeId)); if (!page) throw new Error('Unknown node');
      const ids = subtree(page, action.nodeId), originals = page.nodes.filter(n => ids.has(n.id));
      const mapping = new Map(originals.map(n => [n.id, n.id === action.nodeId ? action.duplicateId ?? uid() : uid()]));
      const offset = action.offset ?? { x: 24, y: 24 }, originalBounds = resolveLayout(page).nodes.find(n => n.id === action.nodeId)!;
      const copies = originals.map(node => {
        const copy = structuredClone(node); copy.id = mapping.get(node.id)!;
        if (copy.parentId && mapping.has(copy.parentId)) copy.parentId = mapping.get(copy.parentId);
        if (node.id === action.nodeId) { copy.name = `${copy.name.slice(0, 195)} copy`; copy.x += offset.x; copy.y += offset.y; }
        for (const interaction of copy.interactions ?? []) if (interaction.action !== 'url') interaction.target = mapping.get(interaction.target) ?? interaction.target;
        return copy;
      });
      duplicateCreativeEmbeds(doc, copies);
      const last = Math.max(...originals.map(n => page.nodes.indexOf(n))); page.nodes.splice(last + 1, 0, ...copies);
      const copyBounds = resolveLayout(page).nodes.find(n => n.id === mapping.get(action.nodeId))!, delta = { x: copyBounds.x - originalBounds.x, y: copyBounds.y - originalBounds.y };
      const offsets = new Map<string, { x: number; y: number }>([[action.nodeId, offset]]);
      for (const original of originals.filter(n => n.id !== action.nodeId)) {
        const parent = originals.find(n => n.id === original.parentId);
        if (!parent?.layout) { const copy = copies.find(n => n.id === mapping.get(original.id))!; copy.x += delta.x; copy.y += delta.y; offsets.set(original.id, delta); }
      }
      if (doc.timeline) doc.timeline.tracks.push(...doc.timeline.tracks.filter(t => ids.has(t.nodeId)).map(track => {
        const copy = structuredClone(track); copy.id = uid(); copy.nodeId = mapping.get(track.nodeId)!;
        const shift = offsets.get(track.nodeId); if (shift) for (const key of copy.keyframes) for (const axis of ['x', 'y'] as const) if (typeof key.values[axis] === 'number') key.values[axis] += shift[axis];
        return copy;
      }));
    }
    else if (action.op === 'add-page') doc.pages.push(action.page);
    else if (action.op === 'remove-page') { const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page'); doc.pages = doc.pages.filter(p => p.id !== action.pageId); const removed = new Set(page.nodes.map(n => n.id)); if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.filter(t => !removed.has(t.nodeId)); }
    else if (action.op === 'add-node' || action.op === 'insert-block') {
      const page = doc.pages.find(p => p.id === action.pageId); if (!page) throw new Error('Unknown page');
      page.nodes.push(...(action.op === 'add-node' ? [action.node] : createBlock(action.blockId, action.offset ?? 0)));
    } else {
      const page = doc.pages.find(p => p.nodes.some(n => n.id === action.nodeId)); if (!page) throw new Error('Unknown node');
      if (action.op === 'update-node') {
        const node = page.nodes.find(n => n.id === action.nodeId)!;
        if (action.changes.layout?.mode === 'absolute' && node.layout?.mode !== 'absolute') convertChildrenToAbsolute(doc, page, node.id);
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
  const evolution=characterEvolutionErrors(document.characters??[],doc.characters??[]);if(evolution.length)throw new Error(evolution.join('; '));
  doc.metadata.updatedAt = new Date().toISOString();
  return documentSchema.parse(doc);
}
export function duplicateDocument(doc: DesignDocument, name = `${doc.name} copy`): DesignDocument {
  const copy = structuredClone(doc); const mapping = new Map<string, string>();
  for (const page of copy.pages) { mapping.set(page.id, uid()); for (const node of page.nodes) mapping.set(node.id, uid()); }
  for (const page of copy.pages) { page.id = mapping.get(page.id)!; for (const node of page.nodes) { node.id = mapping.get(node.id)!; if (node.parentId) node.parentId = mapping.get(node.parentId); for (const action of node.interactions ?? []) if (action.action !== 'url') action.target = mapping.get(action.target) ?? action.target; } }
  if (copy.timeline) for (const track of copy.timeline.tracks) { track.id = uid(); track.nodeId = mapping.get(track.nodeId)!; }
  copy.id = uid(); copy.name = name; copy.metadata = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return documentSchema.parse(copy);
}
