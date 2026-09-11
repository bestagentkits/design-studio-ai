import { Hono } from 'hono';
import { projectRow } from './projects';
import { renderProjectExport } from './exports';
import { fail, id, owner } from './security';
import type { Env } from './types';

export const thumbnailRoutes = new Hono<Env>();
thumbnailRoutes.get('/:id/thumbnail', async c => {
  const project = await projectRow(c, c.req.param('id'));
  if (project.thumbnail_deleting) fail(404, 'not_found', 'Project not found.');
  const revision = Number(c.req.query('revision') ?? project.revision);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > project.revision) fail(400, 'invalid_revision', 'Use a saved project revision.');
  const db = c.env.DB, bucket = c.env.ASSETS_BUCKET;
  const record = await db.prepare('SELECT state,storage_key,lease_until FROM project_thumbnails WHERE project_id=? AND revision=?')
    .bind(project.id, revision).first<{ state: string; storage_key: string | null; lease_until: number }>();
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'private,max-age=86400', 'Vary': 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' };
  if (record?.state === 'ready' && record.storage_key) {
    const image = await bucket.get(record.storage_key);
    if (image) return new Response(image.body, { headers });
  }
  if (revision !== project.revision) fail(404, 'thumbnail_unavailable', 'This cover is no longer available. Reload the project list.');
  const clock = Date.now(), token = id();
  if (record?.state === 'failed' && record.lease_until > clock) {
    c.header('Retry-After', '30'); fail(503, 'thumbnail_retry_later', 'Thumbnail rendering failed. Retry shortly; your design is unchanged.');
  }
  // One active render per owner, enforced by SQLite/D1 rather than process memory.
  const claimed = await db.prepare(`INSERT INTO project_thumbnails(project_id,revision,state,lease_token,lease_until)
    SELECT ?,?,'rendering',?,? WHERE NOT EXISTS (
      SELECT 1 FROM project_thumbnails t JOIN projects p ON p.id=t.project_id
      WHERE p.user_id=? AND t.state='rendering' AND t.lease_until>?)
    AND EXISTS (SELECT 1 FROM projects WHERE id=? AND thumbnail_deleting=0)
    ON CONFLICT(project_id,revision) DO UPDATE SET state='rendering',lease_token=excluded.lease_token,lease_until=excluded.lease_until
    WHERE project_thumbnails.state!='rendering' OR project_thumbnails.lease_until<=?`)
    .bind(project.id, revision, token, clock + 120000, owner(c), clock, project.id, clock).run();
  if (!claimed.meta.changes) {
    c.header('Retry-After', '2'); c.header('Cache-Control', 'no-store');
    return c.json({ status: 'rendering', revision }, 202);
  }
  const key = `thumbnails/${project.id}/${revision}/${token}`;
  let publishedCover = false;
  try {
    const response = await renderProjectExport(c, project.id, { format: 'png', expectedRevision: revision }, true);
    const bytes = await response.arrayBuffer();
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    // A deleted project or superseded lease cannot publish this worker's output.
    const published = await db.prepare("UPDATE project_thumbnails SET state='ready',storage_key=?,lease_token=NULL,lease_until=0 WHERE project_id=? AND revision=? AND lease_token=? AND EXISTS (SELECT 1 FROM projects WHERE id=project_id AND thumbnail_deleting=0)")
      .bind(key, project.id, revision, token).run();
    if (!published.meta.changes) { await bucket.delete(key); fail(409, 'thumbnail_superseded', 'Reload the latest project cover.'); }
    publishedCover = true;
    const old = await db.prepare("SELECT revision,storage_key FROM project_thumbnails WHERE project_id=? AND state='ready' ORDER BY revision DESC LIMIT -1 OFFSET 2")
      .bind(project.id).all<{ revision: number; storage_key: string }>();
    for (const entry of old.results) {
      await bucket.delete(entry.storage_key);
      await db.prepare("DELETE FROM project_thumbnails WHERE project_id=? AND revision=? AND state='ready'").bind(project.id, entry.revision).run();
    }
    return new Response(bytes, { headers });
  } catch (error) {
    if (!publishedCover) await bucket.delete(key);
    await db.prepare("UPDATE project_thumbnails SET state='failed',lease_until=? WHERE project_id=? AND revision=? AND lease_token=?")
      .bind(Date.now() + 30000, project.id, revision, token).run();
    throw error;
  }
});
