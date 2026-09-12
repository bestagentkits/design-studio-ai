import { Hono, type Context } from 'hono';
import { documentSchema } from '../src/shared/schema';
import { inspectionLayout, visualInspectionSchema, workspaceInspectionSchema, type VisualInspectionInput, type VisualInspectionResult } from '../src/shared/visual-inspection';
import { renderProjectExport } from './exports';
import { projectRow, type ProjectRow } from './projects';
import { fail, owner, rateLimit } from './security';
import type { Env } from './types';

export const visualInspectionRoutes = new Hono<Env>();

async function inspectProject(c: Context<Env>, row: ProjectRow, options: VisualInspectionInput): Promise<VisualInspectionResult> {
  if (row.thumbnail_deleting) fail(404, 'not_found', 'Project not found.');
  if (options.expectedRevision !== undefined && options.expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Read the current project revision before inspection.');
  const doc = documentSchema.parse(JSON.parse(row.document));
  const pageIndex = options.pageId !== undefined ? doc.pages.findIndex(page => page.id === options.pageId) : options.pageIndex ?? 0;
  if (options.mode === 'page' && !doc.pages[pageIndex]) fail(400, 'invalid_page', 'Select an existing page ID or zero-based page index.');
  if (options.mode === 'overview' && options.offset >= doc.pages.length) fail(400, 'invalid_offset', 'Select an offset inside the project pages.');
  const pageIndices = options.mode === 'page' ? [pageIndex] : doc.pages.map((_, index) => index).slice(options.offset, options.offset + options.limit);
  const render = { ...options, pageIndices };
  const layout = inspectionLayout(doc, render);
  const response = await renderProjectExport(c, row.id, { format: 'png', pageIndex: pageIndices[0], expectedRevision: row.revision }, false, row, render);
  // Do not present a stale image as the current saved design if an edit raced the render.
  const latest = await projectRow(c, row.id);
  if (latest.thumbnail_deleting) fail(404, 'not_found', 'Project not found.');
  if (latest.revision !== row.revision) fail(409, 'revision_conflict', 'The design changed during inspection. Read and inspect the new revision.');
  const offset = options.mode === 'page' ? pageIndex : options.offset;
  return {
    scope: options.mode === 'page' ? 'page' : 'project', source: 'saved', total: doc.pages.length, offset,
    nextOffset: options.mode === 'overview' && offset + pageIndices.length < doc.pages.length ? offset + pageIndices.length : null,
    items: pageIndices.map((index, position) => ({ projectId: row.id, projectName: row.name, kind: row.kind, revision: row.revision,
      pageId: doc.pages[index].id, pageIndex: index, pageName: doc.pages[index].name, width: doc.pages[index].width, height: doc.pages[index].height,
      time: options.time, imageIndex: 0, bounds: layout.tiles[position] })),
    images: [{ mimeType: 'image/png', data: Buffer.from(await response.arrayBuffer()).toString('base64'), width: layout.width, height: layout.height }],
  };
}

visualInspectionRoutes.post('/:id/inspect', async c => {
  const options = visualInspectionSchema.parse(await c.req.json());
  const row = await projectRow(c, c.req.param('id'));
  c.header('Cache-Control', 'private,no-store');
  return c.json(await inspectProject(c, row, options));
});

visualInspectionRoutes.post('/inspect', async c => {
  const options = workspaceInspectionSchema.parse(await c.req.json());
  await rateLimit(c, `workspace-inspection:${owner(c)}`, 10);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM projects WHERE user_id=? AND thumbnail_deleting=0').bind(owner(c)).first<{ total: number }>();
  const rows = await c.env.DB.prepare('SELECT id FROM projects WHERE user_id=? AND thumbnail_deleting=0 ORDER BY id ASC LIMIT ? OFFSET ?')
    .bind(owner(c), options.limit, options.offset).all<{ id: string }>();
  const result: VisualInspectionResult = { scope: 'workspace', source: 'saved', total: count?.total ?? 0, offset: options.offset, nextOffset: null, items: [], images: [] };
  let encodedBytes = 0;
  for (const entry of rows.results) {
    const row = await projectRow(c, entry.id);
    const project = await inspectProject(c, row, { ...visualInspectionSchema.parse({ mode: 'page', pageIndex: 0, time: options.time }), maxDimension: options.tileSize });
    encodedBytes += project.images[0].data.length;
    if (encodedBytes > 12 * 1024 * 1024) fail(413, 'inspection_too_large', 'Reduce workspace inspection dimensions or project count.');
    result.items.push({ ...project.items[0], imageIndex: result.images.length }); result.images.push(project.images[0]);
  }
  if (options.offset + rows.results.length < result.total) result.nextOffset = options.offset + rows.results.length;
  c.header('Cache-Control', 'private,no-store');
  return c.json(result);
});
