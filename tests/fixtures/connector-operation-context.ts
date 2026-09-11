import type { TestContext } from 'node:test';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBucket, SqliteDatabase } from '../../server/node-adapters';
import { ApiError, authenticate, hash, secret } from '../../server/security';
import { decideConnectorOperation as decide } from '../../server/connector-operations';
import type { Bindings, Env } from '../../server/types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
export async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-operations-')), db = new SqliteDatabase(join(directory, 'db.sqlite'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir(new URL('../../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  const insert = async (table: string, values: Record<string, unknown>) => { const keys = Object.keys(values); await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run(); };
  const timestamp = new Date().toISOString();
  for (const owner of ['alice', 'bob']) {
    await insert('users', { id: owner, name: owner, email: `${owner}@test.invalid`, password: 'test-password-hash', created_at: timestamp });
    await insert('sessions', { hash: await hash(`${owner}-session`), user_id: owner, expires_at: Date.now() + 3600000 });
    await insert('projects', { id: `${owner}-project`, user_id: owner, name: 'Isolated project', kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
  }
  await insert('connections', { id: 'connection', user_id: 'alice', adapter: 'mcp', display_name: 'Test peer', endpoint: 'https://peer.vendor.net/mcp', auth_mode: 'anonymous', status: 'connected', created_at: timestamp, updated_at: timestamp });
  const selection = JSON.stringify({ adapter: 'mcp', tools: ['action'], resources: [] });
  await insert('project_connection_bindings', { id: 'binding', user_id: 'alice', project_id: 'alice-project', connection_id: 'connection', role: 'tool', selection_json: selection, created_at: timestamp, updated_at: timestamp });
  await insert('api_tokens', { id: 'api-id', user_id: 'alice', hash: await hash('alice-api'), name: 'Test', created_at: timestamp });
  await insert('connection_agent_grants', { id: 'grant', user_id: 'alice', project_id: 'alice-project', connection_id: 'connection', principal_kind: 'api', principal_id: 'api-id', capabilities_json: '["execute_read","prepare_write"]', selection_json: selection, created_at: timestamp, expires_at: Date.now() + 3600000 });
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://studio.test', ENCRYPTION_KEY: secret() };
  const session: ConnectorPrincipal = { kind: 'session', userId: 'alice', sessionId: await hash('alice-session') };
  const api: ConnectorPrincipal = { kind: 'api', userId: 'alice', tokenId: 'api-id' };
  const app = new Hono<Env>(); app.use('*', async (c, next) => { await authenticate(c); await next(); });
  app.onError(e => new Response(JSON.stringify({ code: e instanceof ApiError ? e.code : e.message }), { status: e instanceof ApiError ? e.status : 500 }));
  app.post('/:id/:revision/:decision', async c => c.json(await decide(c, c.req.param('id'), Number(c.req.param('revision')), c.req.param('decision') as 'approve' | 'deny')));
  const decision = (id: string, revision = 1, action = 'approve', credential = 'alice-session', headers: Record<string, string> = {}) => app.request(`https://studio.test/${id}/${revision}/${action}`, { method: 'POST', headers: { ...(credential.endsWith('session') ? { Cookie: `studio_session=${credential}` } : { Authorization: `Bearer ${credential}` }), ...headers } }, env);
  return { db, env, session, api, decision, insert, timestamp };
}
