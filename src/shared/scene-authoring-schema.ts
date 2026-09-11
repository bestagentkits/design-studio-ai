import { z } from 'zod';
import { vectorSchema } from './design-capabilities';
const id = z.string().min(1).max(120);
const finite = z.number().finite();
export const sceneCommandSchema = z.discriminatedUnion('action', [
  z.object({action:z.literal('checkpoint'),nodeId:id,outputId:id}),
  z.object({action:z.literal('restore-mesh'),nodeId:id,sourceId:id}),
  z.object({action:z.literal('insert-loop'),nodeId:id,axis:z.enum(['x','y','z']),offset:finite}),
  z.object({action:z.literal('clear-paint'),nodeId:id,layerId:id.optional()}),
  z.object({action:z.literal('joint'),nodeId:id,bone:id,mode:z.enum(['rest','pose']),value:vectorSchema}),
  z.object({action:z.literal('texture-layer'),nodeId:id,id:id,name:z.string().min(1).max(80),map:z.enum(['color','normal','roughness']),opacity:finite.min(0).max(1).default(1),visible:z.boolean().default(true),resolution:z.union([z.literal(256),z.literal(512),z.literal(1024),z.literal(2048)]).default(512)}),
  z.object({action:z.literal('contact'),nodeId:id,id:id,endBone:id,target:vectorSchema,pole:vectorSchema,start:finite.min(0).max(3600),end:finite.min(0).max(3600),maxAngle:finite.min(1).max(180).default(120),groundHeight:finite.optional(),enabled:z.boolean().default(true)}),
  z.object({action:z.literal('weight-brush'),nodeId:id,bone:id,center:vectorSchema,radius:finite.positive().max(1000),strength:finite.min(0).max(1).default(.2),mode:z.enum(['add','subtract','smooth']),mirrorBone:id.optional(),lockedBones:z.array(id).max(256).default([]),lockedVertices:z.array(z.number().int().min(0)).max(300000).default([])}),
  z.object({action:z.literal('sculpt'),nodeId:id,center:vectorSchema,radius:finite.positive().max(1000),strength:finite.min(0).max(1).default(.2),mode:z.enum(['smooth','inflate','move']),delta:vectorSchema.default([0,0,0])}),
  z.object({action:z.literal('split-edges'),nodeId:id,edges:z.array(z.tuple([z.number().int().min(0),z.number().int().min(0)])).min(1).max(1000)}),
  z.object({ action:z.literal('edit-clip'),nodeId:id,name:id,speed:finite.min(.1).max(4).default(1),amplitude:finite.min(0).max(2).default(1),repeat:z.number().int().min(1).max(20).default(1),blend:finite.min(0).max(5).default(0) }),
  z.object({ action:z.literal('rest-pose'),nodeId:id }),
  z.object({ action: z.literal('share-rig'), nodeId: id }),
  z.object({ action: z.literal('convert'), nodeId: id }),
  z.object({ action: z.literal('remesh'), nodeIds: z.array(id).min(1).max(64), outputId: id, resolution: z.number().int().min(12).max(48).default(28), symmetry: z.boolean().default(false), blend: finite.min(.001).max(2).default(.12) }),
  z.object({ action: z.literal('loft'), outputId: id, rings: z.array(z.object({ center: vectorSchema, radius: finite.min(.001).max(1000) })).min(2).max(64), segments: z.number().int().min(6).max(48).default(16), color: z.string().max(80).default('#D89B55') }),
  z.object({ action: z.literal('relax'), nodeId: id, iterations: z.number().int().min(1).max(20).default(3), strength: finite.min(0).max(.5).default(.2) }),
  z.object({ action: z.literal('rig-quadruped'), nodeId: id, landmarks: z.object({ hips: vectorSchema, chest: vectorSchema, head: vectorSchema, frontLeft: vectorSchema, frontRight: vectorSchema, backLeft: vectorSchema, backRight: vectorSchema, tail: vectorSchema }).optional() }),
  z.object({ action: z.literal('attach'), nodeId: id, rigNodeId: id, bone: id }),
  z.object({ action: z.literal('bind'), nodeId: id, rigidBone: id.optional(), smooth: z.number().int().min(0).max(10).default(2) }),
  z.object({ action: z.literal('weights'), nodeId: id, mode: z.enum(['normalize', 'smooth', 'mirror']), iterations: z.number().int().min(1).max(10).default(2) }),
  z.object({ action: z.literal('pose'), nodeId: id, bone: id, rotation: vectorSchema }),
  z.object({ action: z.literal('ik'), nodeId: id, endBone: id, target: vectorSchema, chainLength: z.number().int().min(1).max(4).default(2), maxAngle: finite.min(1).max(180).default(120) }),
  z.object({ action: z.literal('clip'), nodeId: id, preset: z.enum(['idle', 'wag', 'walk']), start: finite.min(0).max(3500).default(0), duration: finite.min(.2).max(30).default(2), strength: finite.min(0).max(2).default(1) }),
  z.object({ action: z.literal('morph'), nodeId: id, name: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(60), vertices: z.array(z.number().int().min(0)).min(1).max(300000), delta: vectorSchema, weight: finite.min(0).max(1).default(0) }),
  z.object({ action: z.literal('uv-pack'), nodeId: id, seams: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(20000).default([]) }),
  z.object({ action: z.literal('paint'), nodeId: id, layerId:id.optional(), uv: z.tuple([finite.min(0).max(1), finite.min(0).max(1)]), radius: finite.min(.001).max(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
]);
export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export const sceneRequestSchema = z.object({ pageId: id, command: sceneCommandSchema, expectedRevision: z.number().int().positive(), preview: z.boolean().default(true) });
