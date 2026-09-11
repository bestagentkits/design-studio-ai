import { z } from 'zod';
import { timelineSchema } from './design-capabilities';
import { createDocument } from './catalog';
import { uid, type DesignDocument, type DesignNode } from './schema';

// Validated motion primitives that compile deterministically into timeline keyframes
// (the same timelineSchema the editor, exports and renderer already consume). No
// arbitrary code: a primitive is structured data mapped to keyframe tracks.
//
// Emitted keys are restricted to what interpolateNode actually applies for ordinary
// nodes (src/shared/render.ts): x, y, width, height, rotation, opacity (node level)
// plus fill/fontSize/borderRadius/strokeWidth/stroke (style) and scene.* paths.
// `scale` is NOT a node-level key and silently no-ops, so it is never emitted here.

export const motionPrimitiveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reveal'), duration: z.number().min(0.1).max(60).default(1.5), stagger: z.number().min(0).max(5).default(0.15) }),
  z.object({ type: z.literal('stagger'), duration: z.number().min(0.1).max(60).default(1.5), stagger: z.number().min(0).max(5).default(0.25) }),
  z.object({ type: z.literal('kinetic-type'), duration: z.number().min(0.1).max(60).default(1.2) }),
  z.object({ type: z.literal('chart-race'), duration: z.number().min(0.1).max(60).default(5), steps: z.number().int().min(2).max(20).default(4) }),
]);
export type MotionPrimitive = z.infer<typeof motionPrimitiveSchema>;
type Timeline = z.infer<typeof timelineSchema>;

export const SUPPORTED_KEYS = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function compileMotionPrimitive(primitive: MotionPrimitive, nodeIds: string[]): Timeline {
  const ids = nodeIds.length ? nodeIds : ['node'];
  const tracks: Timeline['tracks'] = [];

  if (primitive.type === 'chart-race') {
    const row = 64;
    const stepDuration = primitive.duration / primitive.steps;
    ids.forEach((nodeId, index) => {
      const keyframes: Timeline['tracks'][number]['keyframes'] = [];
      for (let step = 0; step <= primitive.steps; step++) {
        const progress = step / primitive.steps;
        const y = (index * (1 - progress) + (ids.length - 1 - index) * progress) * row;
        keyframes.push({ time: round(step * stepDuration), values: { y: round(y, 1) }, ...(step === primitive.steps ? {} : { easing: 'linear' as const }) });
      }
      tracks.push({ id: `track-${index}`, nodeId, keyframes });
    });
    return timelineSchema.parse({ duration: round(primitive.duration), fps: 30, tracks });
  }

  if (primitive.type === 'kinetic-type') {
    ids.forEach((nodeId, index) => {
      tracks.push({ id: `track-${index}`, nodeId, keyframes: [
        { time: 0, values: { opacity: 0, rotation: -5, y: 16 } },
        { time: round(primitive.duration), values: { opacity: 1, rotation: 0, y: 0 }, easing: 'easeOut' },
      ] });
    });
    return timelineSchema.parse({ duration: round(primitive.duration), fps: 30, tracks });
  }

  // reveal | stagger
  const rise = primitive.type === 'stagger' ? 32 : 24;
  const rotation = primitive.type === 'stagger' ? -3 : 0;
  const total = primitive.duration + (ids.length - 1) * primitive.stagger;
  ids.forEach((nodeId, index) => {
    const start = index * primitive.stagger;
    const from: Record<string, number> = { opacity: 0, y: rise, ...(rotation ? { rotation } : {}) };
    const to: Record<string, number> = { opacity: 1, y: 0, ...(rotation ? { rotation: 0 } : {}) };
    tracks.push({ id: `track-${index}`, nodeId, keyframes: [
      { time: round(start), values: from },
      { time: round(start + primitive.duration), values: to, easing: 'easeOut' },
    ] });
  });
  return timelineSchema.parse({ duration: round(total), fps: 30, tracks });
}

export const motionTemplates: Array<{ id: string; name: string; primitive: MotionPrimitive }> = [
  { id: 'reveal', name: 'Fade and rise', primitive: { type: 'reveal', duration: 1.5, stagger: 0.15 } },
  { id: 'stagger', name: 'Staggered pop-in', primitive: { type: 'stagger', duration: 1.5, stagger: 0.25 } },
  { id: 'kinetic-type', name: 'Kinetic title', primitive: { type: 'kinetic-type', duration: 1.2 } },
  { id: 'chart-race', name: 'Bar chart race', primitive: { type: 'chart-race', duration: 5, steps: 4 } },
];

function placeholderNode(index: number, primitive: MotionPrimitive): DesignNode {
  if (primitive.type === 'chart-race') {
    const width = 240 - index * 20;
    return { id: uid(), type: 'shape', name: `Bar ${index + 1}`, x: 64, y: 64 + index * 64, width, height: 48, style: { fill: '$accent', borderRadius: 8 } };
  }
  return { id: uid(), type: 'text', name: `Line ${index + 1}`, text: index === 0 ? 'Your title' : `Supporting line ${index}`, x: 64, y: 64 + index * 72, width: 480, height: 48, style: { fontSize: index === 0 ? 40 : 22, fill: '$text', fontFamily: index === 0 ? '$heading' : '$body' } };
}

export function createMotionDocument(primitiveId: string, name = 'Motion template'): DesignDocument {
  const template = motionTemplates.find(t => t.id === primitiveId);
  if (!template) throw new Error(`Unknown motion template "${primitiveId}".`);
  const primitive = motionPrimitiveSchema.parse(template.primitive);
  const doc = createDocument('video', name);
  const count = primitive.type === 'chart-race' ? 4 : primitive.type === 'kinetic-type' ? 1 : 3;
  doc.pages[0].nodes = Array.from({ length: count }, (_, index) => placeholderNode(index, primitive));
  doc.timeline = compileMotionPrimitive(primitive, doc.pages[0].nodes.map(n => n.id));
  return doc;
}
