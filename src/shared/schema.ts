import { z } from 'zod';
import { boardSchema, boardBoundsSchema, creativeId } from './board-schema';
import { paintingSchema } from './painting-schema';
import { validateCreativeDocument } from './creative-validation';
import { characterSchema, characterInstanceSchema } from './character-schema';
import { characterErrors, instanceErrors } from './character-validation';
import { layoutSchema, sizingSchema, componentSchema, interactionSchema, timelineSchema, sceneObjectSchema, sceneSchema } from './design-capabilities';

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
  id, type: z.enum(['frame', 'group', 'component', 'text', 'image', 'shape', 'icon', 'chart', 'model3d', 'video', 'audio', 'board', 'artwork', 'character']),
  name: z.string().max(200), x: coordinate, y: coordinate, width: dimension, height: dimension,
  rotation: finite.min(-36000).max(36000).optional(), opacity: finite.min(0).max(1).optional(),
  layout: layoutSchema.optional(), sizing: sizingSchema.optional(), position: z.enum(['flow', 'absolute']).optional(),
  pivot: z.tuple([finite.min(0).max(1), finite.min(0).max(1)]).optional(),
  component: componentSchema.optional(), interactions: z.array(interactionSchema).max(20).optional(),
  scene: sceneObjectSchema.optional(), character: characterInstanceSchema.optional(),
  boardId: creativeId.optional(), paintingId: creativeId.optional(), crop: boardBoundsSchema.optional(),
  parentId: id.optional(), locked: z.boolean().optional(), visible: z.boolean().optional(),
  text: z.string().max(50000).optional(), src: z.string().max(2000000).refine(isSafeUrl, 'Only HTTPS, owned assets, or raster image data URLs are allowed').optional(),
  style: primitiveStyle.optional(), data: z.record(z.string().max(80), z.unknown()).optional()
});
export const pageSchema = z.object({ id, name: z.string().max(200), width: dimension.min(1), height: dimension.min(1), background: z.string().max(80), layout: layoutSchema.optional(), notes: z.string().max(20000).optional(), scene: sceneSchema.optional(), nodes: z.array(nodeSchema).max(2000) });
const documentBaseSchema = z.object({
  schemaVersion: z.literal(1), characters: z.array(characterSchema).max(32).optional(), id, name: z.string().min(1).max(200), kind: z.enum(kinds), theme: themeSchema,
  pages: z.array(pageSchema).min(1).max(200),
  assets: z.array(z.object({ id, name: z.string().max(300), type: z.string().max(80), mimeType: z.string().max(100), url: z.string().max(2000000).refine(isSafeUrl), size: finite.min(0).optional() })).max(2000),
  designSystem: z.object({ id, version: z.number().int().positive(), name: z.string().max(200) }).optional(),
  presentation: z.object({ interval: finite.min(1).max(600), loop: z.boolean() }).optional(),
  timeline: timelineSchema.optional(),
  metadata: z.object({ createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
});
const legacyDocumentSchema = documentBaseSchema.strict();
const creativeDocumentSchema = documentBaseSchema.extend({ schemaVersion: z.literal(2), boards: z.array(boardSchema).max(100).default([]), paintings: z.array(paintingSchema).max(100).default([]) }).strict();
export const documentSchema = z.discriminatedUnion('schemaVersion', [legacyDocumentSchema, creativeDocumentSchema]).superRefine((doc, ctx) => {
  const allIds = new Set<string>();
  const nodeIds = new Set<string>();
  let total = 0;
  const unique = (value: string) => { if (allIds.has(value)) ctx.addIssue({ code: 'custom', message: `Duplicate ID: ${value}` }); allIds.add(value); };
  const characters = new Map((doc.characters ?? []).map(c => [c.id, c]));
  if (doc.schemaVersion === 1 && (doc.characters?.length || doc.pages.some(p => p.nodes.some(n => n.character || n.type === 'character')))) ctx.addIssue({ code:'custom',message:'Characters require document schemaVersion 2' });
  let characterKeys=0, characterVertices=0;
  for (const c of doc.characters ?? []) {
    unique(c.id);
    for (const error of characterErrors(c, new Set(doc.assets.filter(a=>a.mimeType.startsWith('image/')).map(a=>a.id)))) ctx.addIssue({code:'custom',message:error});
    characterKeys+=c.clips.reduce((sum,clip)=>sum+clip.channels.reduce((n,ch)=>n+ch.keys.length,0),0);
    characterVertices+=c.attachments.reduce((sum,a)=>sum+(a.mesh?.vertices.length??0),0);
  }
  if(characterKeys>50000 || characterVertices>50000) ctx.addIssue({code:'custom',message:'Document exceeds character geometry/key budget'});
  for (const page of doc.pages) {
    unique(page.id);
    const nodes = new Map(page.nodes.map(n => [n.id, n]));
    total += page.nodes.length;
    for (const node of page.nodes) {
      unique(node.id); nodeIds.add(node.id);
      if(node.type==='character' && !node.character) ctx.addIssue({code:'custom',message:'Character node needs instance settings'});
      if(node.character) {
        const c=characters.get(node.character.characterId);
        if(node.type!=='character'||!c) ctx.addIssue({code:'custom',message:'Invalid character instance'});
        else for(const error of instanceErrors(node.character,c)) ctx.addIssue({code:'custom',message:error});
      }
      if (node.scene?.bones) node.scene.bones.forEach((bone, index) => { if (bone.parent >= index) ctx.addIssue({ code: 'custom', message: 'Bone parents must precede their children' }); });
      if (node.scene?.mesh?.skinIndices && node.scene.mesh.skinIndices.some(i => i >= (node.scene?.bones?.length ?? 0))) ctx.addIssue({ code: 'custom', message: 'Skin references an unknown bone' });
      if (node.scene?.material?.textureAssetId && !doc.assets.some(a => a.id === node.scene!.material!.textureAssetId)) ctx.addIssue({ code: 'custom', message: 'Texture references an unknown asset' });
      for (const interaction of node.interactions ?? []) {
        if (interaction.action === 'navigate' && !doc.pages.some(p => p.id === interaction.target)) ctx.addIssue({ code: 'custom', message: 'Navigation target must be an existing page' });
        if (interaction.action === 'url' && !isSafeUrl(interaction.target)) ctx.addIssue({ code: 'custom', message: 'Interaction URL must be safe' });
      }
      const visited = new Set([node.id]); let parent = node.parentId;
      while (parent) {
        if (!nodes.has(parent) || visited.has(parent)) { ctx.addIssue({ code: 'custom', message: 'Invalid or cyclic node parent' }); break; }
        visited.add(parent); parent = nodes.get(parent)?.parentId;
      }
    }
  }
  if (total > 5000) ctx.addIssue({ code: 'custom', message: 'Maximum 5000 nodes per document' });
  for (const asset of doc.assets) unique(asset.id);
  if (doc.schemaVersion === 2) validateCreativeDocument(doc, ctx, unique);
  else if (doc.pages.some(p => p.nodes.some(n => ['board', 'artwork'].includes(n.type) || n.boardId || n.paintingId || n.crop))) ctx.addIssue({ code: 'custom', message: 'Board and artwork require schemaVersion 2; upgrade this document first' });
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
export interface Project { thumbnailUrl?: string; thumbnailRevision?: number | null; id: string; name: string; description: string; kind: ProjectKind; document: DesignDocument; revision: number; createdAt: string; updatedAt: string; publishedUrl?: string }
export type ProjectSummary = Omit<Project, 'document'>;
export interface User { id: string; email: string; name: string }
export const uid = () => crypto.randomUUID();
