import { z } from 'zod';

export const kinds = ['web', 'slides', 'report', 'wireframe', '3d', 'video'] as const;
export type ProjectKind = typeof kinds[number];
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const finite = z.number().finite();
const coordinate = finite.min(-100000).max(100000);
const dimension = finite.min(0).max(20000);
const primitiveStyle = z.record(z.string().max(80), z.union([z.string().max(2000), finite]));
export function isSafeUrl(value: string): boolean {
  if (/^\/api\/assets\/[\w-]+$/.test(value) || /^\/published\/[\w-]+\/assets\/[\w-]+$/.test(value)) return true;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return true;
  if (/^data:(audio\/(mpeg|wav|ogg)|video\/(mp4|webm)|model\/gltf-binary);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
export const themeSchema = z.object({
  id, name: z.string().min(1).max(120), colors: z.record(z.string().max(80), z.string().max(80)),
  fonts: z.object({ heading: z.string().max(200), body: z.string().max(200) }),
  spacing: z.array(finite.min(0).max(1000)).max(32), radius: finite.min(0).max(1000)
});
export const nodeSchema = z.object({
  id, type: z.enum(['frame', 'text', 'image', 'shape', 'icon', 'chart', 'model3d', 'video', 'audio']),
  name: z.string().max(200), x: coordinate, y: coordinate, width: dimension, height: dimension,
  rotation: finite.min(-36000).max(36000).optional(), opacity: finite.min(0).max(1).optional(),
  parentId: id.optional(), locked: z.boolean().optional(), visible: z.boolean().optional(),
  text: z.string().max(50000).optional(), src: z.string().max(2000000).refine(isSafeUrl, 'Only HTTPS, owned assets, or raster image data URLs are allowed').optional(),
  style: primitiveStyle.optional(), data: z.record(z.string().max(80), z.unknown()).optional()
});
export const pageSchema = z.object({ id, name: z.string().max(200), width: dimension.min(1), height: dimension.min(1), background: z.string().max(80), nodes: z.array(nodeSchema).max(2000) });
export const documentSchema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().min(1).max(200), kind: z.enum(kinds), theme: themeSchema,
  pages: z.array(pageSchema).min(1).max(200),
  assets: z.array(z.object({ id, name: z.string().max(300), type: z.string().max(80), mimeType: z.string().max(100), url: z.string().max(2000000).refine(isSafeUrl), size: finite.min(0).optional() })).max(2000),
  timeline: z.object({ duration: finite.min(0.1).max(3600), fps: finite.min(1).max(60), tracks: z.array(z.object({ id, nodeId: id, keyframes: z.array(z.object({ time: finite.min(0).max(3600), values: primitiveStyle })).max(2000) })).max(2000) }).optional(),
  metadata: z.object({ createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
}).superRefine((doc, ctx) => {
  const allIds = new Set<string>();
  const nodeIds = new Set<string>();
  let total = 0;
  const unique = (value: string) => { if (allIds.has(value)) ctx.addIssue({ code: 'custom', message: `Duplicate ID: ${value}` }); allIds.add(value); };
  for (const page of doc.pages) {
    unique(page.id);
    const nodes = new Map(page.nodes.map(n => [n.id, n]));
    total += page.nodes.length;
    for (const node of page.nodes) {
      unique(node.id); nodeIds.add(node.id);
      const visited = new Set([node.id]); let parent = node.parentId;
      while (parent) {
        if (!nodes.has(parent) || visited.has(parent)) { ctx.addIssue({ code: 'custom', message: 'Invalid or cyclic node parent' }); break; }
        visited.add(parent); parent = nodes.get(parent)?.parentId;
      }
    }
  }
  if (total > 5000) ctx.addIssue({ code: 'custom', message: 'Maximum 5000 nodes per document' });
  for (const asset of doc.assets) unique(asset.id);
  for (const track of doc.timeline?.tracks ?? []) {
    unique(track.id);
    if (!nodeIds.has(track.nodeId)) ctx.addIssue({ code: 'custom', message: 'Timeline references an unknown node' });
    const times = new Set<number>();
    for (const key of track.keyframes) {
      if (key.time > doc.timeline!.duration || times.has(key.time)) ctx.addIssue({ code: 'custom', message: 'Keyframes must have unique times within duration' });
      times.add(key.time);
    }
  }
});

export type Theme = z.infer<typeof themeSchema>;
export type DesignNode = z.infer<typeof nodeSchema>;
export type DesignPage = z.infer<typeof pageSchema>;
export type DesignDocument = z.infer<typeof documentSchema>;
export type AssetRef = DesignDocument['assets'][number];
export type Timeline = NonNullable<DesignDocument['timeline']>;
export interface Project { id: string; name: string; description: string; kind: ProjectKind; document: DesignDocument; revision: number; createdAt: string; updatedAt: string; publishedUrl?: string }
export type ProjectSummary = Omit<Project, 'document'>;
export interface User { id: string; email: string; name: string }
export const uid = () => crypto.randomUUID();
