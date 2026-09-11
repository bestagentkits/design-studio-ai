import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from './types';
import { connectorIdSchema, connectorRevisionSchema } from '../src/shared/connector-values';
import { authorizeConnectorBinding, interactiveConnectionOwner, requestConnectorPrincipal } from './connection-policy';
import { connectionMetadata, createConnection, disconnectConnection, listOwnedConnections, ownedConnection } from './connection-store';
import { fail, owner } from './security';

const revisionBody = z.strictObject({ expectedRevision: connectorRevisionSchema });
const isHuman = (c: Context<Env>) => c.get('principal')?.kind === 'session' && c.req.header('X-Studio-Client') !== 'webmcp';
async function readableConnection(c: Context<Env>, connectionId: string) {
  const userId = owner(c), row = await ownedConnection(c.env, userId, connectionId);
  if (isHuman(c)) return connectionMetadata(row);
  const projectId = connectorIdSchema.safeParse(c.req.query('projectId'));
  if (!projectId.success) fail(403, 'missing_grant', 'Select a project with explicit connector access. A person can manage access in /settings/connections.');
  const principal = await requestConnectorPrincipal(c, projectId.data);
  const bindings = await c.env.DB.prepare('SELECT id FROM project_connection_bindings WHERE user_id=? AND project_id=? AND connection_id=? AND disabled_at IS NULL LIMIT 100')
    .bind(userId, projectId.data, connectionId).all<{ id: string }>();
  for (const binding of bindings.results) {
    try { await authorizeConnectorBinding(c.env, principal, binding.id, 'discover'); return connectionMetadata(row); }
    catch (error) { if (!(error instanceof Error && 'code' in error && ['missing_grant','connection_revoked','needs_reauthorization'].includes(String(error.code)))) throw error; }
  }
  return fail(403, 'missing_grant', 'No current discovery grant permits this connection. A person can manage access in /settings/connections.');
}

/** Mount only when the connector rollout is enabled; setup remains an interactive human action. */
export const connectionRoutes = new Hono<Env>();
connectionRoutes.get('/', async c => {
  const userId = owner(c);
  if (isHuman(c)) return c.json({ connections: await listOwnedConnections(c.env, userId) });
  const projectId = connectorIdSchema.safeParse(c.req.query('projectId'));
  if (!projectId.success) fail(403, 'missing_grant', 'A project and explicit connector grant are required.');
  const rows = await c.env.DB.prepare('SELECT DISTINCT connection_id FROM project_connection_bindings WHERE user_id=? AND project_id=? AND disabled_at IS NULL LIMIT 100')
    .bind(userId, projectId.data).all<{ connection_id: string }>();
  const connections = [];
  for (const row of rows.results) {
    try { connections.push(await readableConnection(c, row.connection_id)); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'missing_grant')) throw error; }
  }
  return c.json({ connections });
});
connectionRoutes.post('/', async c => c.json({ connection: await createConnection(c.env, interactiveConnectionOwner(c), await c.req.json()) }, 201));
connectionRoutes.get('/:connectionId', async c => c.json({ connection: await readableConnection(c, connectorIdSchema.parse(c.req.param('connectionId'))) }));
connectionRoutes.post('/:connectionId/disconnect', async c => {
  const userId = interactiveConnectionOwner(c), value = revisionBody.parse(await c.req.json());
  return c.json({ connection: await disconnectConnection(c.env, userId, connectorIdSchema.parse(c.req.param('connectionId')), value.expectedRevision) });
});
