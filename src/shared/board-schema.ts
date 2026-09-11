import { z } from 'zod';

export const creativeId = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const worldCoordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const positive = z.number().finite().positive().max(20000);
export const boardPointSchema = z.object({ x: worldCoordinate, y: worldCoordinate });
export const boardBoundsSchema = boardPointSchema.extend({ width: positive, height: positive });
export const creativeColor = z.string().regex(/^(#[\da-fA-F]{3,8}|transparent|none)$/);
const base = z.object({
  id: creativeId, name: z.string().max(200), x: worldCoordinate, y: worldCoordinate,
  width: positive, height: positive, rotation: z.number().finite().min(-36000).max(36000).default(0),
  opacity: z.number().min(0).max(1).default(1), visible: z.boolean().default(true), locked: z.boolean().default(false),
  parentId: creativeId.optional(),
});
const styled = base.extend({ stroke: creativeColor, fill: creativeColor, strokeWidth: z.number().min(.1).max(256), roughness: z.number().min(0).max(3).default(0), seed: z.number().int().min(0).max(0xffffffff).default(1) });
export const boardEndpointSchema = z.object({
  point: boardPointSchema,
  binding: z.object({ elementId: creativeId, anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }), port: z.string().max(80).optional() }).optional(),
});
const pathCommand = z.discriminatedUnion('op', [
  z.object({ op: z.literal('M'), x: worldCoordinate, y: worldCoordinate }),
  z.object({ op: z.literal('L'), x: worldCoordinate, y: worldCoordinate }),
  z.object({ op: z.literal('Q'), x1: worldCoordinate, y1: worldCoordinate, x: worldCoordinate, y: worldCoordinate }),
  z.object({ op: z.literal('C'), x1: worldCoordinate, y1: worldCoordinate, x2: worldCoordinate, y2: worldCoordinate, x: worldCoordinate, y: worldCoordinate }),
  z.object({ op: z.literal('Z') }),
]);
export const boardElementSchema = z.discriminatedUnion('type', [
  styled.extend({ type: z.literal('stroke'), algorithm: z.literal('perfect-freehand-1.2.3'), points: z.array(boardPointSchema.extend({ pressure: z.number().min(0).max(1) })).min(1).max(4096) }),
  styled.extend({ type: z.literal('path'), commands: z.array(pathCommand).min(1).max(4096) }),
  styled.extend({ type: z.literal('shape'), shape: z.enum(['rectangle', 'ellipse', 'diamond', 'triangle']), radius: z.number().min(0).max(10000).default(12) }),
  styled.extend({ type: z.literal('text'), text: z.string().max(20000), fontFamily: z.string().max(200), fontSize: z.number().min(1).max(1000), align: z.enum(['left', 'center', 'right']).default('left') }),
  base.extend({ type: z.literal('group') }),
  styled.extend({ type: z.literal('frame'), label: z.string().max(200) }),
  styled.extend({ type: z.literal('connector'), start: boardEndpointSchema, end: boardEndpointSchema, routing: z.enum(['straight', 'elbow', 'curve']), bends: z.array(boardPointSchema).max(128), startArrow: z.enum(['none', 'arrow', 'dot']), endArrow: z.enum(['none', 'arrow', 'dot']), label: z.string().max(2000).default('') }),
  base.extend({ type: z.literal('image'), assetId: creativeId }),
  base.extend({ type: z.literal('sticker'), assetId: creativeId, attribution: z.string().max(2000) }),
  base.extend({ type: z.literal('emoji'), assetId: creativeId, unicode: z.string().min(1).max(64) }),
  base.extend({ type: z.literal('gif'), assetId: creativeId, posterAssetId: creativeId, posterTime: z.number().min(0).max(600000), playing: z.boolean(), loop: z.boolean() }),
  base.extend({ type: z.literal('painting'), paintingId: creativeId }),
]);
export const boardSchema = z.object({
  id: creativeId, name: z.string().max(200), elements: z.array(boardElementSchema).max(5000),
  background: creativeColor.default('#ffffff'),
  mindMap: z.array(z.object({ elementId: creativeId, parentId: creativeId.optional(), collapsed: z.boolean().default(false), pinned: z.boolean().default(false) })).max(5000).optional(),
});
export type Board = z.infer<typeof boardSchema>;
export type BoardElement = z.infer<typeof boardElementSchema>;
export type BoardBounds = z.infer<typeof boardBoundsSchema>;
