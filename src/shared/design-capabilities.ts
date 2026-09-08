import { z } from 'zod';

const number = z.number().finite();
const length = number.min(0).max(20000);
export const layoutSchema = z.object({
  mode: z.enum(['absolute', 'flex', 'grid']), direction: z.enum(['row', 'column']).optional(),
  gap: length.optional(), padding: length.optional(), columns: z.number().int().min(1).max(24).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'space-between']).optional(), wrap: z.boolean().optional(),
});
export const sizingSchema = z.object({
  width: z.enum(['fixed', 'hug', 'fill']).optional(), height: z.enum(['fixed', 'hug', 'fill']).optional(),
  minWidth: length.optional(), maxWidth: length.optional(), minHeight: length.optional(), maxHeight: length.optional(),
});
export const componentNames = ['Button', 'Checkbox', 'Input', 'InputNumber', 'Slider', 'Image', 'Avatar', 'List', 'Statistics', 'Chart', 'Table', 'Select', 'Switch', 'Textarea', 'Card', 'Badge', 'Progress', 'Tabs', 'Dialog', 'Radio'] as const;
export const componentSchema = z.object({
  name: z.enum(componentNames), system: z.enum(['shadcn', 'antd']).default('shadcn'),
  variant: z.string().max(80).optional(), props: z.record(z.string().max(80), z.union([z.string().max(10000), number, z.boolean(), z.array(z.string().max(2000)).max(1000)])).optional(),
});
export const interactionSchema = z.object({ trigger: z.enum(['click', 'hover']), action: z.enum(['navigate', 'toggle', 'url']), target: z.string().max(2000) });
export const easingSchema = z.union([
  z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'spring', 'step']),
  z.tuple([number.min(0).max(1), number.min(-5).max(5), number.min(0).max(1), number.min(-5).max(5)]),
]);
export const keyframeSchema = z.object({ time: number.min(0).max(3600), values: z.record(z.string().max(80), z.union([z.string().max(2000), number])), easing: easingSchema.optional() });
export const trackSchema = z.object({ id: z.string().min(1).max(120), nodeId: z.string().min(1).max(120), keyframes: z.array(keyframeSchema).max(2000), muted: z.boolean().optional(), locked: z.boolean().optional() });
export const timelineSchema = z.object({ duration: number.min(.1).max(3600), fps: number.min(1).max(60), tracks: z.array(trackSchema).max(2000) });
export const vectorSchema = z.tuple([number.min(-100000).max(100000), number.min(-100000).max(100000), number.min(-100000).max(100000)]);
export const meshSchema = z.object({
  positions: z.array(number.min(-100000).max(100000)).min(9).max(900000),
  indices: z.array(z.number().int().min(0).max(299999)).min(3).max(1800000),
  uv: z.array(number.min(-100).max(100)).max(600000).optional(),
  skinIndices: z.array(z.number().int().min(0).max(255)).max(1200000).optional(),
  skinWeights: z.array(number.min(0).max(1)).max(1200000).optional(),
}).superRefine((mesh, ctx) => {
  const count = mesh.positions.length / 3;
  if (!Number.isInteger(count) || mesh.indices.length % 3 || mesh.indices.some(i => i >= count)) ctx.addIssue({ code: 'custom', message: 'Mesh triangles must reference existing vertices' });
  if (mesh.uv && mesh.uv.length !== count * 2) ctx.addIssue({ code: 'custom', message: 'UV requires two coordinates per vertex' });
  if (!!mesh.skinIndices !== !!mesh.skinWeights || (mesh.skinIndices && (mesh.skinIndices.length !== count * 4 || mesh.skinWeights!.length !== count * 4))) ctx.addIssue({ code: 'custom', message: 'Skinning requires four indices and weights per vertex' });
});
export const sceneObjectSchema = z.object({
  position: vectorSchema.optional(), rotation: vectorSchema.optional(), scale: vectorSchema.optional(),
  mesh: meshSchema.optional(),
  material: z.object({ color: z.string().max(80).optional(), metalness: number.min(0).max(1).optional(), roughness: number.min(0).max(1).optional(), wireframe: z.boolean().optional(), doubleSided: z.boolean().optional(), textureAssetId: z.string().max(120).optional() }).optional(),
  bones: z.array(z.object({ name: z.string().max(120), parent: z.number().int().min(-1).max(255), position: vectorSchema, rotation: vectorSchema.optional() })).max(256).optional(),
});
export const sceneSchema = z.object({ camera: z.object({ position: vectorSchema, target: vectorSchema, fov: number.min(10).max(120) }), ambient: number.min(0).max(10), light: z.object({ position: vectorSchema, intensity: number.min(0).max(20), color: z.string().max(80) }) });
export type Layout = z.infer<typeof layoutSchema>;
export type MeshData = z.infer<typeof meshSchema>;
