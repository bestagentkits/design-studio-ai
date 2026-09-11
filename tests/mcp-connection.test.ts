import { app } from '../server/index';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { connectMcpConnection, activateMcpConnection } from '../server/connectors/mcp-connection';
import { createConnection, ownedConnection } from '../server/connection-store';
import { storeConnectorCredential, readConnectorCredential } from '../server/connector-credentials';
import { ApiError, hash, secret } from '../server/security';
import type { Bindings } from '../server/types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
const endpoint = 'https://activation.vendor.net/mcp';
const error = (code: string) => (value: unknown) => value instanceof ApiError && value.code === code;
async function fixture(t: TestContext, mode: 'anonymous' | 'bearer' | 'oauth' = 'anonymous') {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-activation-')), db = new SqliteDatabase(join(directory, 'db.sqlite'));
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const timestamp = new Date().toISOString();
  await db.prepare('INSERT INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)').bind('alice', 'Alice', 'activation@isolated.invalid', 'unused-test-hash', timestamp).run();
  const principal: ConnectorPrincipal = { kind: 'session', userId: 'alice', sessionId: await hash('isolated-session') };
  await db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(principal.sessionId, 'alice', Date.now() + 3600000).run();
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    if (mode !== 'anonymous' && request.headers.authorization !== 'Bearer valid-isolated-token') { response.writeHead(401).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString()); methods.push(rpc.method);
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'not-an-account-identity', version: '1' } } } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; db.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://studio.test', ENCRYPTION_KEY: secret(), CONNECTOR_FETCH: async (input, init) => {
    const request = new Request(input, init); assert.equal(request.url, endpoint);
    return fetch(base, { method: request.method, headers: request.headers, body: request.body, signal: request.signal, redirect: 'manual', duplex: 'half' } as RequestInit);
  } };
  const connection = await createConnection(env, 'alice', { displayName: 'Activation peer', config: { adapter: 'mcp', endpoint, authMode: mode } });
  const credential = { accessToken: 'valid-isolated-token', tokenType: 'Bearer' as const, resource: endpoint };
  const race = (mutation: () => Promise<unknown>) => {
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
      const statement = prepare(sql);
      if (sql.startsWith("UPDATE connections SET status='connected'")) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...values) => { const bound = bind(...values), run = bound.run.bind(bound); bound.run = async () => { await mutation(); return run(); }; return bound; };
      }
      return statement;
    };
  };
  return { env, db, principal, connection, credential, methods, timestamp, race };
}

for (const mode of ['anonymous', 'bearer'] as const) test(`${mode} reconnection verifies real MCP and clears prior authority without inventing identity`, async t => {
  const { env, db, principal, connection, methods, timestamp } = await fixture(t, mode);
  await db.prepare("UPDATE connections SET status='connected',remote_identity='old-account',capability_fingerprint=? WHERE id=?").bind('a'.repeat(64), connection.id).run();
  await db.prepare("INSERT INTO projects(id,user_id,name,kind,document,created_at,updated_at) VALUES('project','alice','Project','web','{}',?,?)").bind(timestamp, timestamp).run();
  await db.prepare("INSERT INTO project_connection_bindings(id,user_id,project_id,connection_id,role,selection_json,created_at,updated_at) VALUES('binding','alice','project',?,'tool',?, ?,?)").bind(connection.id, JSON.stringify({ adapter: 'mcp', tools: ['tool'], resources: [] }), timestamp, timestamp).run();
  await db.prepare("INSERT INTO connection_agent_grants(id,user_id,project_id,connection_id,principal_kind,principal_id,capabilities_json,selection_json,created_at,expires_at) VALUES('grant','alice','project',?,'api','prior-token','[\"execute_read\"]',?, ?,?)").bind(connection.id, JSON.stringify({ adapter: 'mcp', tools: ['tool'], resources: [] }), timestamp, Date.now() + 3600000).run();
  for (const status of ['pending', 'running']) await db.prepare(`INSERT INTO connector_operations(id,user_id,project_id,connection_id,binding_id,principal_kind,principal_id,idempotency_key,status,action,effect,arguments_hash,action_fingerprint,destination_hash,versions_json,lease_id,lease_expires_at,created_at,updated_at)
    VALUES(?,'alice','project',?,'binding','session',?,?,?,'tool','read',?,?,?,'{}',?,?,?,?)`).bind(`old-${status}`, connection.id, principal.kind === 'session' ? principal.sessionId : '', `prior-operation-${status}`, status, 'a'.repeat(64), 'a'.repeat(64), 'a'.repeat(64), status === 'running' ? 'old-lease' : null, status === 'running' ? Date.now() + 30000 : null, timestamp, timestamp).run();
  const result = await connectMcpConnection(env, principal, connection.id, 1, mode === 'bearer' ? 'valid-isolated-token' : undefined);
  assert.equal(result.connection.status, 'connected'); assert.equal(result.connection.revision, 3); assert.equal(result.connection.remoteIdentity, null);
  assert.equal(result.connection.capabilityFingerprint, null); assert.equal(result.protocolVersion, '2026-07-28');
  assert.deepEqual(methods, ['server/discover']);
  assert.ok((await db.prepare("SELECT revoked_at FROM connection_agent_grants WHERE id='grant'").first<{ revoked_at: string }>())!.revoked_at);
  assert.equal((await db.prepare("SELECT policy_revision FROM project_connection_bindings WHERE id='binding'").first<{ policy_revision: number }>())!.policy_revision, 2);
  const rows = await db.prepare('SELECT id,status,lease_id FROM connector_operations ORDER BY id').all<{ id: string; status: string; lease_id: string | null }>();
  assert.deepEqual(rows.results.map(row => row.status), ['cancelled', 'outcome_unknown']); assert.ok(rows.results.every(row => row.lease_id === null));
});

test('invalid bearer remains pending and does not claim verified metadata or tool access', async t => {
  const { env, db, principal, connection, methods } = await fixture(t, 'bearer');
  await assert.rejects(connectMcpConnection(env, principal, connection.id, 1, 'wrong-isolated-token'), error('needs_reauthorization'));
  const row = await ownedConnection(env, 'alice', connection.id);
  assert.equal(row.status, 'pending'); assert.equal(row.revision, 2); assert.equal(row.remote_identity, null); assert.equal(row.capability_fingerprint, null); assert.deepEqual(methods, []);
  assert.equal((await db.prepare('SELECT count(*) AS total FROM connector_operations').first<{ total: number }>())!.total, 0);
});

test('expired and revoked human sessions cannot start activation', async t => {
  const { env, db, principal, connection, methods } = await fixture(t);
  await db.prepare('UPDATE sessions SET expires_at=0').run();
  await assert.rejects(connectMcpConnection(env, principal, connection.id, 1), error('missing_grant'));
  await db.prepare('DELETE FROM sessions').run();
  await assert.rejects(activateMcpConnection(env, principal, connection.id, 1), error('missing_grant'));
  assert.deepEqual(methods, []); assert.equal((await ownedConnection(env, 'alice', connection.id)).revision, 1);
});

test('connection revision or human revocation between handshake and activation defeats the CAS', async t => {
  for (const mutation of ['connection', 'session']) {
    const { env, db, principal, connection, methods, race } = await fixture(t);
    race(() => mutation === 'connection' ? db.prepare('UPDATE connections SET revision=revision+1,endpoint=? WHERE id=?').bind('https://other.vendor.net/mcp', connection.id).run() : db.prepare('DELETE FROM sessions').run());
    await assert.rejects(activateMcpConnection(env, principal, connection.id, 1), error('revision_conflict'));
    assert.equal((await ownedConnection(env, 'alice', connection.id)).status, 'pending'); assert.deepEqual(methods, ['server/discover']);
  }
});

test('OAuth activation requires exact credential version and rejects a rotation race', async t => {
  const { env, db, principal, connection, credential, methods, race } = await fixture(t, 'oauth');
  await storeConnectorCredential(env, 'alice', connection.id, 1, credential, Date.now() + 3600000);
  await storeConnectorCredential(env, 'alice', connection.id, 1, credential, Date.now() + 3600000);
  await assert.rejects(activateMcpConnection(env, principal, connection.id, 1, 1), error('needs_reauthorization')); assert.deepEqual(methods, []);
  race(() => db.prepare('UPDATE connection_credentials SET credential_version=credential_version+1 WHERE connection_id=?').bind(connection.id).run());
  await assert.rejects(activateMcpConnection(env, principal, connection.id, 1, 2), error('revision_conflict'));
  assert.equal((await ownedConnection(env, 'alice', connection.id)).status, 'pending'); assert.deepEqual(methods, ['server/discover']);
});

test('OAuth exact-version activation succeeds without inventing account identity', async t => {
  const { env, principal, connection, credential, methods } = await fixture(t, 'oauth');
  await storeConnectorCredential(env, 'alice', connection.id, 1, credential, Date.now() + 3600000);
  const result = await activateMcpConnection(env, principal, connection.id, 1, 1);
  assert.equal(result.connection.status, 'connected'); assert.equal(result.connection.revision, 2); assert.equal(result.connection.remoteIdentity, null);
  assert.deepEqual(methods, ['server/discover']);
});

test('credentials sealed for another connection cannot activate this connection', async t => {
  const { env, db, principal, connection, credential } = await fixture(t, 'oauth');
  const other = await createConnection(env, 'alice', { displayName: 'Other', config: { adapter: 'mcp', endpoint, authMode: 'oauth' } });
  await storeConnectorCredential(env, 'alice', other.id, 1, credential, null);
  await storeConnectorCredential(env, 'alice', connection.id, 1, credential, null);
  const sealed = (await readConnectorCredential(env, 'alice', other.id)).row.encrypted_payload;
  await db.prepare('UPDATE connection_credentials SET encrypted_payload=? WHERE connection_id=?').bind(sealed, connection.id).run();
  await assert.rejects(activateMcpConnection(env, principal, connection.id, 1, 1), error('needs_reauthorization'));
});


test('mounted setup route enforces rollout, CSRF and human authority before HTTP activation', async t => {
  const { env, connection, methods } = await fixture(t);
  const request = (headers: Record<string,string> = {}) => app.request('https://studio.test/api/connectors/mcp/connect', {
    method: 'POST', headers: { Cookie: 'studio_session=isolated-session', Origin: 'https://studio.test', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ connectionId: connection.id, expectedRevision: 1 }),
  }, env);
  assert.equal((await request()).status, 503);
  env.CONNECTORS_ENABLED = 'true';
  assert.equal((await request({Origin: 'https://other.test'})).status, 403);
  assert.equal((await request({'X-Studio-Client': 'webmcp'})).status, 403);
  assert.deepEqual(methods, []);
  const response = await request(); assert.equal(response.status, 200);
  const data = await response.json() as any;
  assert.equal(data.connection.status, 'connected'); assert.equal(data.connection.revision, 3);
  assert.deepEqual(methods, ['server/discover']);
  assert.equal((await request()).status, 409);
});
