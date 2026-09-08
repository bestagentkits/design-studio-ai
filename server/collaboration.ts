import { Hono } from 'hono';
import { mergeRequestSchema } from '../src/shared/collaboration-contract';
import { documentSchema } from '../src/shared/schema';
import { mergeDocuments, MergeConflict } from '../src/shared/document-merge';
import { projectRow, saveDocument, serializeProject } from './projects';
import { origin, fail } from './security';
import type { Env } from './types';
export const collaborationRoutes = new Hono<Env>();
export { mergeRequestSchema } from '../src/shared/collaboration-contract';
collaborationRoutes.post('/:id/merge', async c => {
  const row = await projectRow(c, c.req.param('id'));
  const body = mergeRequestSchema.parse(await c.req.json());
  if (body.baseRevision > row.revision || body.base.id !== row.id || body.base.kind !== row.kind || body.document.id !== row.id || body.document.kind !== row.kind) fail(400, 'invalid_merge_base', 'Merge base must belong to this project and cannot be from a future revision.');
  try {
    const next = mergeDocuments(body.base, body.document, documentSchema.parse(JSON.parse(row.document)));
    return c.json({ project: await saveDocument(c, row.id, next, row.revision) });
  } catch (error) {
    if (error instanceof MergeConflict) return c.json({ error: { code: 'merge_conflict', message: error.message, details: { paths: error.paths } } }, 409);
    throw error;
  }
});
collaborationRoutes.get('/:id/changes', async c => {
  const row = await projectRow(c, c.req.param('id'));
  const since = Number(c.req.query('since') ?? 0);
  return c.json(row.revision === since ? { revision: row.revision, unchanged: true } : { revision: row.revision, project: serializeProject(row, origin(c)) });
});
