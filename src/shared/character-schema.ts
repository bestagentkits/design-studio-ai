import { z } from 'zod';
import { easingSchema } from './design-capabilities';

export const characterId = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(1).max(120);
const number = z.number().finite().min(-100000).max(100000);
export const pointSchema = z.tuple([number, number]);
export const poseSchema = z.object({ x: number.default(0), y: number.default(0), rotation: number.default(0), scaleX: number.min(-100).max(100).default(1), scaleY: number.min(-100).max(100).default(1) });
export const boneSchema = poseSchema.extend({ id: characterId, name: z.string().max(200), parentId: characterId.optional(), length: number.min(0).default(50) });
const influenceSchema = z.object({ boneId: characterId, weight: z.number().finite().min(0).max(1) });
export const characterMeshSchema = z.object({
  version: z.number().int().positive(), vertices: z.array(pointSchema).min(3).max(5000),
  uv: z.array(pointSchema).min(3).max(5000), triangles: z.array(z.number().int().min(0).max(4999)).min(3).max(30000),
  weights: z.array(z.array(influenceSchema).min(1).max(4)).max(5000).optional(),
});
export const attachmentSchema = z.object({
  id: characterId, name: z.string().max(200), slotId: characterId,
  kind: z.enum(['region', 'mesh', 'sequence', 'clipping', 'bounds']), assetId: characterId.optional(),
  x: number.default(0), y: number.default(0), width: number.min(.01).max(20000), height: number.min(.01).max(20000),
  rotation: number.default(0), pivot: pointSchema.default([0, 0]), mesh: characterMeshSchema.optional(),
  sourceMeshId: characterId.optional(), points: z.array(pointSchema).min(3).max(256).optional(),
  clipEndSlotId: characterId.optional(), inverse: z.boolean().optional(), frames: z.array(characterId).min(1).max(600).optional(),
  fps: z.number().min(1).max(60).optional(),
});
export const slotSchema = z.object({ id: characterId, name: z.string().max(200), boneId: characterId, attachmentId: characterId.optional(), opacity: z.number().min(0).max(1).default(1), blend: z.enum(['normal', 'multiply', 'screen', 'add']).default('normal') });
export const skinSchema = z.object({ id: characterId, name: z.string().max(200), attachments: z.record(characterId, characterId) });
export const motionValueSchema = z.union([number, z.string().max(120), z.array(number).max(10000)]);
export const motionKeySchema = z.object({ id: characterId, time: z.number().finite().min(0).max(3600), value: motionValueSchema, easing: easingSchema.optional() });
export const motionChannelSchema = z.object({
  id: characterId, target: z.enum(['bone', 'slot', 'attachment', 'constraint']), targetId: characterId,
  property: z.enum(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'attachment', 'order', 'deform', 'mix', 'targetX', 'targetY', 'position', 'value']),
  meshVersion: z.number().int().positive().optional(), keys: z.array(motionKeySchema).max(2000), muted: z.boolean().optional(), locked: z.boolean().optional(),
});
export const motionClipSchema = z.object({ bakedFrom:z.object({clipId:characterId,fps:z.number().int().min(1).max(60)}).optional(), id: characterId, name: z.string().max(200), duration: z.number().finite().min(.01).max(3600), loop: z.boolean().default(false), channels: z.array(motionChannelSchema).max(1000), events: z.array(z.object({ id: characterId, time: z.number().min(0).max(3600), name: z.string().min(1).max(120) })).max(1000).default([]) });
export const constraintSchema = z.object({
  id: characterId, name: z.string().max(200), type: z.enum(['ik', 'transform', 'path', 'physics', 'slider']),
  bones: z.array(characterId).min(1).max(256), targetBoneId: characterId.optional(), target: pointSchema.default([0, 0]),
  mix: z.number().min(0).max(1).default(1), bend: z.enum(['positive', 'negative']).default('positive'), stretch: z.boolean().default(false),
  offset: poseSchema.optional(), space: z.enum(['local', 'world']).default('world'),
  sourceProperty: z.enum(['x', 'y', 'rotation', 'scaleX', 'scaleY']).default('rotation'),
  destinationProperty: z.enum(['x', 'y', 'rotation', 'scaleX', 'scaleY']).default('rotation'),
  factor: number.default(1), min: number.optional(), max: number.optional(),
  path: z.array(pointSchema).min(4).max(256).optional(), position: z.number().min(0).max(1).default(0), spacing: z.number().min(0).max(1).default(.1),
  stiffness: z.number().min(0).max(1000).default(30), damping: z.number().min(0).max(100).default(8), mass: z.number().min(.01).max(100).default(1),
  gravity: number.default(0), wind: number.default(0), clipId: characterId.optional(), value: z.number().min(0).max(1).default(0),
});
export const characterSchema = z.object({
  id: characterId, name: z.string().min(1).max(200), width: number.min(1).max(20000), height: number.min(1).max(20000),
  bones: z.array(boneSchema).min(1).max(256), slots: z.array(slotSchema).max(256), attachments: z.array(attachmentSchema).max(512),
  skins: z.array(skinSchema).max(64), clips: z.array(motionClipSchema).max(128), constraints: z.array(constraintSchema).max(128).default([]),
});
export const placementSchema = z.object({
  id: characterId, clipId: characterId, start: z.number().min(0).max(3600), end: z.number().min(0).max(3600),
  sourceStart: z.number().min(0).max(3600).default(0), speed: z.number().min(.01).max(10).default(1), loop: z.boolean().default(false),
  weight: z.number().min(0).max(1).default(1), blend: z.enum(['override', 'additive']).default('override'), mask: z.array(characterId).max(256).optional(),
  fadeIn: z.number().min(0).max(3600).default(0), fadeOut: z.number().min(0).max(3600).default(0),
});
export const characterInstanceSchema = z.object({ characterId, skinId: characterId.optional(), clipId: characterId.optional(),
  controls: z.record(characterId, z.number().min(0).max(1)).optional(), placements: z.array(placementSchema).max(256).default([]),
  interactions: z.array(z.object({ trigger: z.enum(['click', 'hover']), clipId: characterId })).max(16).default([]),
});
export type Character = z.infer<typeof characterSchema>;
export type Bone = z.infer<typeof boneSchema>;
export type BonePose = z.infer<typeof poseSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type CharacterMesh = z.infer<typeof characterMeshSchema>;
export type MotionClip = z.infer<typeof motionClipSchema>;
export type MotionChannel = z.infer<typeof motionChannelSchema>;
export type MotionKey = z.infer<typeof motionKeySchema>;
export type Constraint = z.infer<typeof constraintSchema>;
export type CharacterInstance = z.infer<typeof characterInstanceSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Point = [number, number];
