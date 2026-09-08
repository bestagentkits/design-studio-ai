import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { applyDesignSystem, designSystemSchema, insertSystemItem, systemApplySchema, systemUpdateSchema, type DesignSystem } from '../src/shared/design-systems';
import { projectRow, saveDocument } from './projects';
import { fail, id, now, owner } from './security';
import type { Env } from './types';
const database = (context: Context<Env>) => { const { env: bindings } = context; return bindings.DB; };
export const designSystemRoutes = new Hono<Env>();
export async function readDesignSystem(c: Context<Env>, systemId: string, version?: number): Promise<DesignSystem> {
  const row = await database(c).prepare(`SELECT v.system_id as id,v.version,v.definition,v.created_at as createdAt FROM design_system_versions v JOIN design_systems s ON s.id=v.system_id WHERE s.id=? AND s.user_id=? ${version ? 'AND v.version=?' : ''} ORDER BY v.version DESC LIMIT 1`).bind(systemId, owner(c), ...(version ? [version] : [])).first<{ id: string; version: number; definition: string; createdAt: string }>();
  if (!row) fail(404, 'not_found', 'Design system or version not found');
  return { ...row, definition: designSystemSchema.parse(JSON.parse(row.definition)) };
}
designSystemRoutes.get('/', async c => {
  const rows = await database(c).prepare('SELECT s.id,v.version,v.definition,v.created_at as createdAt FROM design_systems s JOIN design_system_versions v ON v.system_id=s.id WHERE s.user_id=? AND v.version=(SELECT MAX(version) FROM design_system_versions WHERE system_id=s.id) ORDER BY v.created_at DESC').bind(owner(c)).all<{ id: string; version: number; definition: string; createdAt: string }>();
  return c.json({ systems: rows.results.map(row => ({ ...row, definition: designSystemSchema.parse(JSON.parse(row.definition)) })) });
});
designSystemRoutes.post('/', async c => {
  const definition = designSystemSchema.parse(await c.req.json()), systemId = id(), createdAt = now();
  await database(c).batch([
    database(c).prepare('INSERT INTO design_systems(id,user_id,created_at) VALUES(?,?,?)').bind(systemId, owner(c), createdAt),
    database(c).prepare('INSERT INTO design_system_versions(system_id,version,definition,created_at) VALUES(?,1,?,?)').bind(systemId, JSON.stringify(definition), createdAt),
  ]);
  return c.json({ system: { id: systemId, version: 1, definition, createdAt } }, 201);
});
designSystemRoutes.get('/:id/versions', async c => {
  await readDesignSystem(c, c.req.param('id'));
  const rows = await database(c).prepare('SELECT version,created_at as createdAt FROM design_system_versions WHERE system_id=? ORDER BY version DESC').bind(c.req.param('id')).all();
  return c.json({ versions: rows.results });
});
designSystemRoutes.get('/:id', async c => {
  const raw = c.req.query('version'), version = raw === undefined ? undefined : z.coerce.number().int().positive().parse(raw);
  return c.json({ system: await readDesignSystem(c, c.req.param('id'), version) });
});
designSystemRoutes.put('/:id', async c => {
  const body = systemUpdateSchema.parse(await c.req.json()), systemId = c.req.param('id');
  await readDesignSystem(c, systemId);
  // Version preconditions are checked inside the insert, including concurrent writers.
  const result = await database(c).prepare('INSERT INTO design_system_versions(system_id,version,definition,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM design_systems WHERE id=? AND user_id=?) AND (SELECT MAX(version) FROM design_system_versions WHERE system_id=?)=?').bind(systemId, body.expectedVersion + 1, JSON.stringify(body.definition), now(), systemId, owner(c), systemId, body.expectedVersion).run();
  if (!result.meta.changes) fail(409, 'version_conflict', 'Design system changed. Read the latest version before saving.');
  return c.json({ system: await readDesignSystem(c, systemId, body.expectedVersion + 1) });
});
designSystemRoutes.post('/:id/apply', async c => {
  const body = systemApplySchema.parse(await c.req.json()), library = await readDesignSystem(c, c.req.param('id'), body.version);
  const row = await projectRow(c, body.projectId);
  return c.json({ project: await saveDocument(c, row.id, applyDesignSystem(JSON.parse(row.document), library), body.expectedRevision) });
});
designSystemRoutes.post('/:id/insert', async c => {
  const body = systemApplySchema.extend({ pageId: z.string(), itemId: z.string() }).parse(await c.req.json()), library = await readDesignSystem(c, c.req.param('id'), body.version);
  const row = await projectRow(c, body.projectId);
  let document; try { document = insertSystemItem(JSON.parse(row.document), library, body.pageId, body.itemId); } catch (e) { fail(400, 'invalid_item', e instanceof Error ? e.message : 'Invalid library item'); }
  return c.json({ project: await saveDocument(c, row.id, document, body.expectedRevision) });
});
designSystemRoutes.delete('/:id', async c => {
  await readDesignSystem(c, c.req.param('id'));
  await database(c).prepare('DELETE FROM design_systems WHERE id=? AND user_id=?').bind(c.req.param('id'), owner(c)).run();
  return c.json({ ok: true });
});
