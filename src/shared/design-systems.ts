import { z } from 'zod';
import { componentSchema, sizingSchema } from './design-capabilities';
import { documentSchema, nodeSchema, pageSchema, themeSchema, type DesignDocument, type DesignNode } from './schema';
import { resolveLayout } from './layout';
const identifier = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const systemComponentSchema = z.object({ id: identifier, name: z.string().min(1).max(120), component: componentSchema, style: nodeSchema.shape.style, sizing: sizingSchema.optional(), width: nodeSchema.shape.width.optional(), height: nodeSchema.shape.height.optional(), text: nodeSchema.shape.text, src: nodeSchema.shape.src });
export const designSystemSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(''), system: z.enum(['antd', 'shadcn']), theme: themeSchema,
  components: z.array(systemComponentSchema).max(100).default([]), compositions: z.array(pageSchema).max(30).default([]),
}).superRefine((definition, ctx) => {
  const ids = [...definition.components.map(c => c.id), ...definition.compositions.map(c => c.id)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Library item IDs must be unique' });
  if (definition.components.some(c => c.src?.includes('/api/assets/') || c.src?.includes('/published/'))) ctx.addIssue({ code: 'custom', message: 'Reusable component media must be embedded or use public HTTPS URLs' });
  for (const page of definition.compositions) {
    const parsed = documentSchema.safeParse({ schemaVersion: 1, id: 'composition', name: page.name || 'Composition', kind: 'web', theme: definition.theme, pages: [page], assets: [], metadata: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } });
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: `Invalid composition ${page.name}: ${parsed.error.issues[0]?.message}` });
    if (page.nodes.some(n => n.src?.includes('/api/assets/') || n.src?.includes('/published/') || n.scene?.material?.textureAssetId)) ctx.addIssue({ code: 'custom', message: 'Reusable compositions must embed their media or use public HTTPS URLs' });
    if (page.nodes.some(n => n.interactions?.some(a => a.action === 'toggle' && !page.nodes.some(target => target.id === a.target)))) ctx.addIssue({ code: 'custom', message: 'Composition toggle targets must belong to the composition' });
  }
});
export const systemUpdateSchema = z.object({ expectedVersion: z.number().int().positive(), definition: designSystemSchema });
export const systemApplySchema = z.object({ projectId: identifier, expectedRevision: z.number().int().positive(), version: z.number().int().positive().optional() });
export type DesignSystemDefinition = z.infer<typeof designSystemSchema>;
export type DesignSystem = { id: string; version: number; definition: DesignSystemDefinition; createdAt: string };
export function captureSystemComponent(node: DesignNode, id: string) {
  if (!node.component) throw new Error('Select a component to capture');
  return systemComponentSchema.parse({ id, name: node.name, component: structuredClone(node.component), style: structuredClone(node.style), sizing: structuredClone(node.sizing), width: node.width, height: node.height, text: node.text, src: node.src });
}
export function applyDesignSystem(document: DesignDocument, library: DesignSystem): DesignDocument {
  const next = structuredClone(document), definition = designSystemSchema.parse(library.definition);
  next.theme = structuredClone(definition.theme); next.designSystem = { id: library.id, version: library.version, name: definition.name };
  for (const page of next.pages) for (const node of page.nodes) if (node.component) {
    const preset = definition.components.find(c => c.component.name === node.component!.name && c.component.variant === node.component!.variant);
    node.component = { ...preset?.component, ...node.component, system: definition.system, props: { ...preset?.component.props, ...node.component.props } };
    node.src ??= preset?.src; node.text ??= preset?.text;
    node.style = { ...preset?.style, ...node.style }; node.sizing = { ...preset?.sizing, ...node.sizing };
  }
  return documentSchema.parse(next);
}
export function insertSystemItem(document: DesignDocument, library: DesignSystem, pageId: string, itemId: string): DesignDocument {
  const next = structuredClone(document), page = next.pages.find(p => p.id === pageId);
  if (!page) throw new Error('Page does not exist');
  const component = library.definition.components.find(c => c.id === itemId);
  if (component) page.nodes.push({ id: crypto.randomUUID(), name: component.name, type: 'component', x: 40, y: 40, width: component.width ?? 240, height: component.height ?? 48, text: component.text, src: component.src, component: structuredClone(component.component), style: structuredClone(component.style), sizing: structuredClone(component.sizing) });
  else {
    const composition = library.definition.compositions.find(c => c.id === itemId);
    if (!composition) throw new Error('Library item does not exist');
    const normalized = structuredClone(composition), boxes = new Map(resolveLayout(composition).nodes.map(n => [n.id, n]));
    for (const n of normalized.nodes) {
      const parent = composition.nodes.find(p => p.id === n.parentId);
      if (parent && !parent.layout) { n.x -= boxes.get(parent.id)!.x; n.y -= boxes.get(parent.id)!.y; }
      if (!n.layout && composition.nodes.some(child => child.parentId === n.id)) n.layout = { mode: 'absolute' };
    }
    const ids = new Map(composition.nodes.map(n => [n.id, crypto.randomUUID()])), root = crypto.randomUUID();
    page.nodes.push({ id: root, name: composition.name, type: 'frame', x: 40, y: 40, width: composition.width, height: composition.height, layout: composition.layout ?? { mode: 'absolute' }, style: { fill: composition.background } });
    page.nodes.push(...normalized.nodes.map(raw => {
      const n = structuredClone(raw); n.id = ids.get(raw.id)!; n.parentId = raw.parentId ? ids.get(raw.parentId) : root;
      n.interactions = n.interactions?.map(action => ({ ...action, target: action.action === 'toggle' ? ids.get(action.target) ?? action.target : action.action === 'navigate' ? pageId : action.target }));
      return n;
    }));
  }
  return documentSchema.parse(next);
}
