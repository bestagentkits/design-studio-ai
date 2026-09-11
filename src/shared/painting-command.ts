import { z } from 'zod';
import { creativeId } from './board-schema';
const point = z.object({ x: z.number().finite().min(0).max(4095), y: z.number().finite().min(0).max(4095), pressure: z.number().min(0).max(1).default(.5), tiltX: z.number().min(-90).max(90).optional(), tiltY: z.number().min(-90).max(90).optional() });
const selection = z.object({ kind: z.enum(['rectangle', 'lasso']), points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(2).max(2048), feather: z.number().min(0).max(128) });
export const paintingCommandSchema = z.object({
  expectedRevision: z.number().int().positive(), expectedGeneration: z.number().int().nonnegative(), expectedBriefRevision: z.number().int().nonnegative().optional(), operationId: creativeId,
  paintingId: creativeId, layerId: creativeId, selection: selection.optional(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('stroke'), preset: z.enum(['ink', 'bristle', 'dry', 'wash', 'smudge', 'erase']).default('bristle'), size: z.number().min(1).max(256), flow: z.number().min(0).max(1).default(.8), color: z.string().regex(/^#[a-fA-F0-9]{6}$/), seed: z.number().int().min(0).max(0xffffffff).default(124), tilt: z.number().min(0).max(1).default(0), points: z.array(point).min(1).max(10000) }),
    z.object({ type: z.literal('fill'), x: z.number().int().min(0).max(4095), y: z.number().int().min(0).max(4095), color: z.tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255)]), tolerance: z.number().min(0).max(255).default(0), contiguous: z.boolean().default(true), sampleVisible: z.boolean().default(false), erase: z.boolean().default(false) }),
  ]),
});
export type PaintingCommand = z.infer<typeof paintingCommandSchema>;
