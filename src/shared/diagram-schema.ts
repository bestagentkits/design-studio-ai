import { z } from 'zod';
export const diagramFamilySchema = z.enum(['flowchart', 'architecture', 'user-flow', 'mind-map']);
export const diagramRoleSchema = z.enum(['start', 'end', 'process', 'decision', 'service', 'database', 'actor', 'boundary', 'screen', 'topic']);
export const diagramNodeSchema = z.object({
  family: diagramFamilySchema, role: diagramRoleSchema, label: z.string().max(2000),
  pinned: z.boolean().default(false), fontFamily: z.string().min(1).max(200).default('Arial'), fontSize: z.number().min(8).max(128).default(16),
  ports: z.array(z.object({ id: z.string().min(1).max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(32).default([]),
  autoSize: z.boolean().default(false), textColor: z.string().regex(/^(#[\da-fA-F]{3,8}|transparent|none)$/).default('#172554'), align: z.enum(['left', 'center', 'right']).default('center'),
  thumbnailAssetId: z.string().max(120).optional(),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramFamily = z.infer<typeof diagramFamilySchema>;
