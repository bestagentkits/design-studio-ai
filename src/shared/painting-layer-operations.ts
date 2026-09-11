import { z } from 'zod';
import { creativeId } from './board-schema';
import { paintingSchema, paintLayerSchema, type Painting } from './painting-schema';
import { assertPaintingTransition } from './painting-transition';
import { upgradeDocument } from './document-upgrade';
import type { DesignDocument } from './schema';
const base = { paintingId: creativeId, expectedGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) };
const layerChanges = paintLayerSchema.pick({ name: true, visible: true, locked: true, opacity: true, blend: true, alphaLock: true, clipping: true }).partial().extend({ groupId: creativeId.nullable().optional(), maskEnabled: z.boolean().optional() });
const groupChanges = z.object({ name: z.string().max(200), visible: z.boolean(), locked: z.boolean(), opacity: z.number().min(0).max(1) }).partial();
export const paintingLayerOperationSchemas = [
  z.object({ op: z.literal('painting-layer-create'), ...base, layerId: creativeId, name: z.string().max(200).default('Layer'), groupId: creativeId.optional() }),
  z.object({ op: z.literal('painting-layer-update'), ...base, layerId: creativeId, changes: layerChanges }),
  z.object({ op: z.literal('painting-layer-remove'), ...base, layerId: creativeId }),
  z.object({ op: z.literal('painting-layer-reorder'), ...base, layerId: creativeId, index: z.number().int().min(0).max(23) }),
  z.object({ op: z.literal('painting-group-create'), ...base, groupId: creativeId, name: z.string().max(200).default('Group') }),
  z.object({ op: z.literal('painting-group-update'), ...base, groupId: creativeId, changes: groupChanges }),
  z.object({ op: z.literal('painting-group-remove'), ...base, groupId: creativeId }),
  z.object({ op: z.literal('painting-group-reorder'), ...base, groupId: creativeId, index: z.number().int().min(0).max(23) }),
] as const;
export const paintingLayerOperationSchema = z.discriminatedUnion('op', paintingLayerOperationSchemas);
export type PaintingLayerOperation = z.infer<typeof paintingLayerOperationSchema>;
export function isPaintingLayerOperation(action: { op: string }): action is PaintingLayerOperation { return paintingLayerOperationSchemas.some(schema => schema.shape.op.value === action.op); }
export function applyPaintingLayerOperation(document: DesignDocument, input: PaintingLayerOperation): DesignDocument {
  const action = paintingLayerOperationSchema.parse(input), doc = upgradeDocument(document), painting = doc.paintings.find(p => p.id === action.paintingId);
  if (!painting) throw new Error('Unknown painting');
  if (painting.generation !== action.expectedGeneration) throw new Error('Painting generation conflict');
  const before = structuredClone(painting);
  const layer = (id: string) => { const value = painting.layers.find(l => l.id === id); if (!value) throw new Error('Unknown painting layer'); return value; };
  const group = (id: string) => { const value = painting.groups.find(g => g.id === id); if (!value) throw new Error('Unknown painting group'); return value; };
  const editableGroup = (id?: string) => { if (id && group(id).locked) throw new Error('Unlock the painting group before editing its layers'); };
  if (action.op === 'painting-layer-create') {
    if (painting.layers.some(l => l.id === action.layerId)) throw new Error('Painting layer identifier already exists');
    editableGroup(action.groupId);
    painting.layers.push({ id: action.layerId, name: action.name, groupId: action.groupId, visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false, clipping: false, tiles: [] });
  } else if (action.op === 'painting-group-create') {
    if (painting.groups.some(g => g.id === action.groupId)) throw new Error('Painting group identifier already exists');
    painting.groups.push({ id: action.groupId, name: action.name, visible: true, locked: false, opacity: 1 });
  } else if ('layerId' in action) {
    const current = layer(action.layerId);
    if (action.op === 'painting-layer-update') {
      const { groupId, maskEnabled, ...changes } = action.changes;
      if (groupId !== undefined) { editableGroup(current.groupId); editableGroup(groupId ?? undefined); if (current.locked) throw new Error('Unlock the layer before moving it to another group'); current.groupId = groupId ?? undefined; }
      if (maskEnabled !== undefined) { editableGroup(current.groupId); if (current.locked) throw new Error('Unlock the layer before changing its mask'); if (!current.mask) throw new Error('Create a mask before enabling it'); current.mask.enabled = maskEnabled; }
      Object.assign(current, changes);
    } else {
      if (current.locked) throw new Error('Unlock the layer before removing or reordering it'); editableGroup(current.groupId);
      const index = painting.layers.indexOf(current);
      if (action.op === 'painting-layer-remove') { if (painting.layers.length === 1) throw new Error('Keep at least one painting layer'); painting.layers.splice(index, 1); }
      else { if (action.index >= painting.layers.length) throw new Error('Painting layer index is out of range'); painting.layers.splice(index, 1); painting.layers.splice(action.index, 0, current); }
      painting.layers[0].clipping = false;
    }
  } else {
    const current = group(action.groupId);
    if (action.op === 'painting-group-update') Object.assign(current, action.changes);
    else {
      if (current.locked || painting.layers.some(l => l.groupId === current.id && l.locked)) throw new Error('Unlock the group and its layers before removing or reordering it');
      const index = painting.groups.indexOf(current);
      if (action.op === 'painting-group-remove') { painting.groups.splice(index, 1); painting.layers.forEach(l => { if (l.groupId === current.id) delete l.groupId; }); }
      else {
        reorderPaintingGroup(painting, current.id, action.index);
      }
    }
  }
  if (painting.layers[0].clipping) throw new Error('The bottom painting layer cannot be clipped');
  painting.generation++; delete painting.composite;
  paintingSchema.parse(painting); assertPaintingTransition(before, painting);
  return doc;
}

export function reorderPaintingGroup(painting: Painting, id: string, target: number) {
  const index = painting.groups.findIndex(g => g.id === id), current = painting.groups[index];
  if (!current) throw new Error('Unknown painting group');
  if (!Number.isInteger(target) || target < 0 || target >= painting.groups.length) throw new Error('Painting group index is out of range');
  if (current.locked || painting.layers.some(l => l.groupId === id && l.locked)) throw new Error('Unlock the group and its layers before reordering');
  painting.groups.splice(index, 1); painting.groups.splice(target, 0, current);
  const members = painting.layers.filter(l => l.groupId === id); painting.layers = painting.layers.filter(l => l.groupId !== id);
  const following = new Set(painting.groups.slice(target + 1).map(g => g.id));
  const insertion = painting.layers.findIndex(l => l.groupId && following.has(l.groupId));
  painting.layers.splice(insertion < 0 ? painting.layers.length : insertion, 0, ...members); painting.layers[0].clipping = false;
}
