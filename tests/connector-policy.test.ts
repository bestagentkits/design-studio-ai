import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { ApiError, authenticate, hash } from '../server/security';
import { authorizeConnectorBinding, interactiveConnectionOwner, requestConnectorPrincipal, type ConnectorCapability } from '../server/connection-policy';
import type { Bindings, Env } from '../server/types';

const selection = { adapter: 'mcp', tools: ['read', 'write'], resources: ['source'] };
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-connector-policy-'));
  const db = new SqliteDatabase(join(directory, 'test.sqlite'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const insert = async (table: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    await db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  };
  const timestamp = new Date().toISOString(), future = Date.now() + 3600000;
  for (const owner of ['alice', 'bob']) {
    await insert('users', { id: owner, name: owner, email: `${owner}@policy.test`, password: 'isolated-test-password-hash', created_at: timestamp });
    await insert('sessions', { hash: await hash(`${owner}-session`), user_id: owner, expires_at: future });
    await insert('api_tokens', { id: `${owner}-token-id`, user_id: owner, hash: await hash(`${owner}-api`), name: 'Isolated token', created_at: timestamp });
    await insert('projects', { id: `${owner}-project`, user_id: owner, name: 'Policy project', kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
    await insert('connections', { id: `${owner}-connection`, user_id: owner, adapter: 'mcp', display_name: 'Policy connection', endpoint: 'https://connector.vendor.net/mcp', auth_mode: 'anonymous', status: 'connected', created_at: timestamp, updated_at: timestamp });
    await insert('project_connection_bindings', { id: `${owner}-binding`, user_id: owner, project_id: `${owner}-project`, connection_id: `${owner}-connection`, role: 'tool', selection_json: JSON.stringify(selection), created_at: timestamp, updated_at: timestamp });
  }
  await insert('projects', { id: 'alice-other-project', user_id: 'alice', name: 'Other project', kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
  await insert('project_connection_bindings', { id: 'alice-other-binding', user_id: 'alice', project_id: 'alice-other-project', connection_id: 'alice-connection', role: 'tool', selection_json: JSON.stringify(selection), created_at: timestamp, updated_at: timestamp });
  for (const client of ['client-a', 'client-b']) await insert('oauth_clients', { id: client, name: client, redirect_uris: '[]', created_at: timestamp });
  for (const [token, client, family] of [['oauth-a', 'client-a', 'family-a'], ['oauth-b', 'client-b', 'family-a'], ['oauth-new-family', 'client-a', 'family-b']]) await insert('oauth_tokens', { hash: await hash(token), user_id: 'alice', client_id: client, family, resource: 'https://studio.policy.test/mcp', kind: 'access', expires_at: future });
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://studio.policy.test' };
  // These endpoints exist only in this test harness; production connector routes remain disabled.
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { await authenticate(c); await next(); });
  app.onError((error) => new Response(JSON.stringify({ code: error instanceof ApiError ? error.code : error.message }), { status: error instanceof ApiError ? error.status : 500, headers: { 'content-type': 'application/json' } }));
  app.get('/manage', c => c.json({ userId: interactiveConnectionOwner(c) }));
  app.get('/use/:project/:binding', async c => {
    const principal = requestConnectorPrincipal(c, c.req.param('project'));
    const result = await authorizeConnectorBinding(c.env, principal, c.req.param('binding'), (c.req.query('cap') ?? 'discover') as ConnectorCapability, c.req.query('action'));
    return c.json({ project: result.binding.project_id, selection: result.selection });
  });
  const request = (path = '/use/alice-project/alice-binding', credential = 'alice-api', headers: Record<string, string> = {}) => app.request(`https://studio.policy.test${path}`, { headers: { ...(credential.endsWith('-session') ? { Cookie: `studio_session=${credential}` } : { Authorization: `Bearer ${credential}` }), ...headers } }, env);
  const grant = (id = 'grant', overrides: Record<string, unknown> = {}) => insert('connection_agent_grants', { id, user_id: 'alice', project_id: 'alice-project', connection_id: 'alice-connection', principal_kind: 'api', principal_id: 'alice-token-id', capabilities_json: '["discover","execute_read"]', selection_json: JSON.stringify(selection), created_at: timestamp, expires_at: future, ...overrides });
  const failure = async (response: Response, code: string, status = 403) => { assert.equal(response.status, status); assert.equal((await response.json() as { code: string }).code, code); };
  return { db, insert, grant, request, failure, timestamp, future };
}

test('owner sessions can use their binding; API keys have no implicit grant or owner crossing', async t => {
  const { request, grant, failure } = await setup(t);
  assert.equal((await request(undefined, 'alice-session')).status, 200);
  await failure(await request(), 'missing_grant');
  await grant(); assert.equal((await request()).status, 200);
  await failure(await request('/use/bob-project/bob-binding'), 'binding_not_found', 404);
  await failure(await request('/use/bob-project/bob-binding', 'alice-session'), 'binding_not_found', 404);
  await failure(await request(undefined, 'bob-api'), 'binding_not_found', 404);
  await failure(await request('/use/alice-project/alice-binding?cap=execute_read&action=disabled'), 'missing_grant');
});

test('OAuth grants bind both client and token family and do not survive token revocation', async t => {
  const { request, grant, failure, db } = await setup(t);
  await failure(await request(undefined, 'oauth-a'), 'missing_grant');
  await grant('oauth-grant', { principal_kind: 'oauth', principal_id: 'family-a', principal_client_id: 'client-a' });
  assert.equal((await request(undefined, 'oauth-a')).status, 200);
  await failure(await request(undefined, 'oauth-b'), 'missing_grant');
  await failure(await request(undefined, 'oauth-new-family'), 'missing_grant');
  await db.prepare("DELETE FROM oauth_tokens WHERE client_id='client-a' AND family='family-a'").run();
  await failure(await request(undefined, 'oauth-a'), 'unauthorized', 401);
});

test('revoked expired stale and insufficient grants fail; removed API authentication cannot reuse a grant', async t => {
  const { request, grant, failure, db, future } = await setup(t);
  await grant();
  for (const [column, invalid, restore] of [['revoked_at', new Date().toISOString(), null], ['expires_at', 0, future], ['policy_revision', 2, 1], ['capabilities_json', '["run"]', '["discover"]']] as const) {
    await db.prepare(`UPDATE connection_agent_grants SET ${column}=? WHERE id='grant'`).bind(invalid).run();
    await failure(await request(), 'missing_grant');
    await db.prepare(`UPDATE connection_agent_grants SET ${column}=? WHERE id='grant'`).bind(restore).run();
  }
  await db.prepare("UPDATE connections SET status='disconnected' WHERE id='alice-connection'").run();
  await failure(await request(), 'connection_revoked', 409);
  await db.prepare("UPDATE connections SET status='connected' WHERE id='alice-connection'").run();
  await db.prepare("DELETE FROM api_tokens WHERE id='alice-token-id'").run();
  await failure(await request(), 'unauthorized', 401);
});

test('WebMCP headers select only an existing project grant and cannot enable human management', async t => {
  const { request, grant, failure, db } = await setup(t);
  const headers = { 'X-Studio-Client': 'webmcp', 'X-Studio-Connector-Grant': 'web-grant' };
  await failure(await request(undefined, 'alice-session', headers), 'missing_grant');
  await grant('web-grant', { principal_kind: 'webmcp', principal_id: 'web-grant' });
  assert.equal((await request(undefined, 'alice-session', headers)).status, 200);
  await failure(await request(undefined, 'alice-api', headers), 'missing_grant');
  await failure(await request('/use/alice-other-project/alice-other-binding', 'alice-session', headers), 'missing_grant');
  await failure(await request('/use/alice-project/alice-other-binding', 'alice-session', headers), 'missing_grant');
  await failure(await request(undefined, 'bob-session', headers), 'missing_grant');
  await failure(await request(undefined, 'alice-session', { 'X-Studio-Client': 'webmcp' }), 'missing_grant');
  await failure(await request('/manage', 'alice-session', headers), 'human_action_required');
  await db.prepare("UPDATE connection_agent_grants SET revoked_at=? WHERE id='web-grant'").bind(new Date().toISOString()).run();
  await failure(await request(undefined, 'alice-session', headers), 'missing_grant');
});

test('human management accepts sessions only and explicit invalid authorization cannot fall back to cookies', async t => {
  const { request, failure } = await setup(t);
  assert.equal((await request('/manage', 'alice-session')).status, 200);
  for (const credential of ['alice-api', 'oauth-a']) await failure(await request('/manage', credential), 'human_action_required');
  await failure(await request('/manage', 'alice-session', { Authorization: 'Basic invalid' }), 'unauthorized', 401);
});

test('binding role and grant selection restrict actual returned resources', async t => {
  const { request, grant, failure, db } = await setup(t);
  await grant('limited', { selection_json: JSON.stringify({ adapter: 'mcp', tools: ['read'], resources: [] }) });
  const restricted = await request(); assert.equal(restricted.status, 200);
  assert.deepEqual((await restricted.json() as { selection: unknown }).selection, { adapter: 'mcp', tools: ['read'], resources: [] });
  await failure(await request('/use/alice-project/alice-binding?cap=execute_read&action=write'), 'missing_grant');
  await failure(await request('/use/alice-project/alice-binding?cap=read_source'), 'missing_grant');
  await db.prepare("UPDATE project_connection_bindings SET role='source' WHERE id='alice-binding'").run();
  await failure(await request('/use/alice-project/alice-binding?cap=execute_read&action=read', 'alice-session'), 'missing_grant');
});

test('native grants intersect exact GitHub repository and commit and Drive file selections', async t => {
  const { request, grant, failure, db } = await setup(t);
  const commit = 'a'.repeat(40);
  const binding = { adapter: 'github', repositoryId: '123', commit, paths: ['src', 'docs'] };
  await db.prepare("UPDATE connections SET adapter='github',endpoint=NULL,auth_mode='oauth',remote_identity='123' WHERE id='alice-connection'").run();
  await db.prepare("UPDATE project_connection_bindings SET selection_json=? WHERE id='alice-binding'").bind(JSON.stringify(binding)).run();
  await grant('native', { selection_json: JSON.stringify({ ...binding, paths: ['src', 'private'] }) });
  let response = await request(); assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { selection: unknown }).selection, { ...binding, paths: ['src'] });
  await db.prepare("UPDATE connection_agent_grants SET selection_json=? WHERE id='native'").bind(JSON.stringify({ ...binding, commit: 'b'.repeat(40) })).run();
  await failure(await request(), 'missing_grant');
  await db.prepare("UPDATE connection_agent_grants SET selection_json=? WHERE id='native'").bind(JSON.stringify({ ...binding, repositoryId: '456' })).run();
  await failure(await request(), 'missing_grant');
  const drive = { adapter: 'google-drive', fileIds: ['file-a', 'file-b'], destinationFolderId: 'folder-a' };
  await db.prepare("UPDATE connections SET adapter='google-drive' WHERE id='alice-connection'").run();
  await db.prepare("UPDATE project_connection_bindings SET selection_json=? WHERE id='alice-binding'").bind(JSON.stringify(drive)).run();
  await db.prepare("UPDATE connection_agent_grants SET selection_json=? WHERE id='native'").bind(JSON.stringify({ ...drive, fileIds: ['file-a', 'file-c'], destinationFolderId: 'folder-b' })).run();
  response = await request(); assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { selection: unknown }).selection, { adapter: 'google-drive', fileIds: ['file-a'] });
});

test('MCP resource grants cannot authorize same-name tool execution', async t => {
  const { request, grant, failure, db } = await setup(t);
  const resourceOnly = { adapter: 'mcp', tools: [], resources: ['source'] };
  await db.prepare("UPDATE project_connection_bindings SET selection_json=? WHERE id='alice-binding'").bind(JSON.stringify(resourceOnly)).run();
  await grant('resource-only', { selection_json: JSON.stringify(resourceOnly) });
  await failure(await request('/use/alice-project/alice-binding?cap=execute_read&action=source'), 'missing_grant');
  await db.prepare("UPDATE project_connection_bindings SET selection_json=? WHERE id='alice-binding'").bind(JSON.stringify({ ...resourceOnly, tools: ['source'] })).run();
  await failure(await request('/use/alice-project/alice-binding?cap=execute_read&action=source'), 'missing_grant');
  await db.prepare("UPDATE project_connection_bindings SET role='source' WHERE id='alice-binding'").run();
  await db.prepare("UPDATE connection_agent_grants SET capabilities_json='[\"read_source\"]',selection_json=? WHERE id='resource-only'").bind(JSON.stringify({ adapter: 'mcp', tools: ['source'], resources: [] })).run();
  await failure(await request('/use/alice-project/alice-binding?cap=read_source&action=source'), 'missing_grant');
});

test('expired sessions and OAuth access tokens cannot inherit still-valid connector grants', async t => {
  const { request, grant, failure, db } = await setup(t);
  await grant('oauth-grant', { principal_kind: 'oauth', principal_id: 'family-a', principal_client_id: 'client-a' });
  await db.prepare("UPDATE oauth_tokens SET expires_at=0 WHERE client_id='client-a' AND family='family-a'").run();
  await failure(await request(undefined, 'oauth-a'), 'unauthorized', 401);
  await db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id='alice'").run();
  await failure(await request(undefined, 'alice-session'), 'unauthorized', 401);
});

test('WebMCP grant expiry and binding policy changes require a fresh valid grant', async t => {
  const { request, grant, failure, db, future } = await setup(t);
  await grant('web-grant', { principal_kind: 'webmcp', principal_id: 'web-grant' });
  const headers = { 'X-Studio-Client': 'webmcp', 'X-Studio-Connector-Grant': 'web-grant' };
  await db.prepare("UPDATE connection_agent_grants SET expires_at=0 WHERE id='web-grant'").run();
  await failure(await request(undefined, 'alice-session', headers), 'missing_grant');
  await db.prepare("UPDATE connection_agent_grants SET expires_at=? WHERE id='web-grant'").bind(future).run();
  await db.prepare("UPDATE project_connection_bindings SET policy_revision=2 WHERE id='alice-binding'").run();
  await failure(await request(undefined, 'alice-session', headers), 'missing_grant');
});
