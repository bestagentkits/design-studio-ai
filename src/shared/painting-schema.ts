import { z } from 'zod';
import { creativeId } from './board-schema';

const generation = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const paintTileSchema = z.object({
  x: z.number().int().min(0).max(7), y: z.number().int().min(0).max(7),
  assetId: creativeId, generation, hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const paintLayerSchema = z.object({
  id: creativeId, name: z.string().max(200), visible: z.boolean(), locked: z.boolean(),
  opacity: z.number().min(0).max(1), blend: z.enum(['normal', 'multiply', 'screen', 'overlay']),
  alphaLock: z.boolean().default(false), clipping: z.boolean().default(false),
  groupId: creativeId.optional(), tiles: z.array(paintTileSchema).max(64),
  mask: z.object({ enabled: z.boolean(), tiles: z.array(paintTileSchema).max(64) }).optional(),
});
export const paintingSchema = z.object({
  id: creativeId, name: z.string().max(200), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  generation, colorSpace: z.literal('srgb'), algorithm: z.literal('cpu-srgb-grain-v1'), tileSize: z.literal(512),
  layers: z.array(paintLayerSchema).min(1).max(24),
  groups: z.array(z.object({ id: creativeId, locked: z.boolean().optional(), name: z.string().max(200), visible: z.boolean(), opacity: z.number().min(0).max(1) })).max(24).default([]),
  composite: z.object({ assetId: creativeId, generation, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
});
export type Painting = z.infer<typeof paintingSchema>;
export type PaintLayer = z.infer<typeof paintLayerSchema>;
