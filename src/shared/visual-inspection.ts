import { z } from 'zod';
import type { DesignDocument } from './schema';

const pagination = { offset: z.number().int().min(0).max(1000000).default(0), limit: z.number().int().min(1).max(12).default(6) };
const sampling = { time: z.number().finite().min(0).max(3600).default(0), tileSize: z.number().int().min(160).max(800).default(400) };
export const workspaceInspectionSchema = z.object({ ...pagination, ...sampling }).strict();
export const visualInspectionSchema = z.object({
  ...pagination, ...sampling,
  mode: z.enum(['page', 'overview']).default('overview'),
  pageId: z.string().min(1).max(200).optional(), pageIndex: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().positive().optional(),
  columns: z.number().int().min(1).max(4).default(3),
  maxDimension: z.number().int().min(256).max(2048).default(1600),
}).strict().superRefine((value, ctx) => {
  if (value.pageId !== undefined && value.pageIndex !== undefined) ctx.addIssue({ code: 'custom', message: 'Choose pageId or pageIndex, not both.' });
  if (value.mode !== 'page' && (value.pageId !== undefined || value.pageIndex !== undefined)) ctx.addIssue({ code: 'custom', message: 'Page selectors require mode page.' });
});
export type VisualInspectionInput = z.infer<typeof visualInspectionSchema>;
export interface InspectionRenderOptions { pageIndices: number[]; time: number; mode: 'page' | 'overview'; tileSize: number; columns: number; maxDimension: number }
export interface InspectionBounds { x: number; y: number; width: number; height: number }
export interface VisualInspectionItem {
  projectId: string; projectName: string; kind: DesignDocument['kind']; revision: number;
  pageId: string; pageIndex: number; pageName: string; width: number; height: number;
  time: number; imageIndex: number; bounds: InspectionBounds;
}
export interface VisualInspectionResult {
  scope: 'page' | 'project' | 'workspace'; source: 'saved'; total: number; offset: number; nextOffset: number | null;
  items: VisualInspectionItem[];
  images: { mimeType: 'image/png'; data: string; width: number; height: number }[];
}

/** Shared pixel mapping keeps the image and machine-readable coordinates identical. */
export function inspectionLayout(doc: DesignDocument, options: InspectionRenderOptions) {
  const { pageIndices, tileSize, maxDimension } = options;
  const columns = Math.min(options.columns, pageIndices.length);
  const fit = (index: number, edge: number) => {
    const page = doc.pages[index], scale = Math.min(1, edge / page.width, edge / page.height);
    return { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) };
  };
  if (options.mode === 'page') {
    const size = fit(pageIndices[0], maxDimension);
    return { ...size, tiles: [{ x: 0, y: 0, ...size }] };
  }
  return {
    width: columns * tileSize, height: Math.ceil(pageIndices.length / columns) * (tileSize + 40),
    tiles: pageIndices.map((index, position) => {
      const size = fit(index, tileSize - 16);
      return { x: (position % columns) * tileSize + Math.floor((tileSize - size.width) / 2), y: Math.floor(position / columns) * (tileSize + 40) + Math.floor((tileSize - size.height) / 2), ...size };
    }),
  };
}

/** The same content shape is understood by network MCP and browser model-context hosts. */
export function visualInspectionContent(result: VisualInspectionResult) {
  return { content: [
    { type: 'text' as const, text: JSON.stringify({ ...result, images: result.images.map(({ data, ...image }) => image) }) },
    ...result.images.map(({ mimeType, data }) => ({ type: 'image' as const, mimeType, data })),
  ] };
}
