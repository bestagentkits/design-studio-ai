import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import type { Bindings } from '../server/types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { ApiError, hash, secret } from '../server/security';
import { storeConnectorCredential } from '../server/connector-credentials';
import { disconnectConnection } from '../server/connection-store';
import { getProjectSource } from '../server/project-sources';
import { discoverBindingMcpCatalog, importMcpResource } from '../server/connectors/mcp-resources';
const endpoint = 'https://resources.vendor.net/mcp', uri = 'source://selected';
const error = (code: string) => (value: unknown) => value instanceof ApiError && value.code === code;
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-resources-')), db = new SqliteDatabase(join(directory, 'db.sqlite'));
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const insert = async (table: string, values: Record<string, unknown>) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  const timestamp = new Date().toISOString(), future = Date.now() + 3600000;
  const session: ConnectorPrincipal = { kind: 'session', userId: 'alice', sessionId: await hash('isolated-session') };
  const api: ConnectorPrincipal = { kind: 'api', userId: 'alice', tokenId: 'isolated-api' };
  for (const user of ['alice', 'bob']) await insert('users', { id: user, name: user, email: `${user}@isolated.invalid`, password: 'unused-test-hash', created_at: timestamp });
  await insert('sessions', { hash: await hash('bob-session'), user_id: 'bob', expires_at: future });
  await insert('sessions', { hash: session.sessionId, user_id: 'alice', expires_at: future });
  await insert('api_tokens', { id: api.tokenId, hash: await hash('isolated-api'), user_id: 'alice', name: 'Test', created_at: timestamp });
  for (const project of ['project', 'other']) await insert('projects', { id: project, user_id: 'alice', name: project, kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
  await insert('connections', { id: 'connection', user_id: 'alice', adapter: 'mcp', endpoint, display_name: 'Peer', auth_mode: 'bearer', status: 'connected', created_at: timestamp, updated_at: timestamp });
  await insert('project_connection_bindings', { id: 'binding', user_id: 'alice', project_id: 'project', connection_id: 'connection', role: 'source', selection_json: JSON.stringify({ adapter: 'mcp', tools: ['one', 'two'], resources: [uri, 'source://second'] }), created_at: timestamp, updated_at: timestamp });
  const methods: string[] = [], targets: string[] = [];
  let contents: unknown[] = [{ uri, text: '<script>untrusted()</script>', mimeType: 'text/html' }], duringResponse: (() => Promise<unknown>) | undefined, raceMethod = 'after-handshake';
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer isolated-token');
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString()); methods.push(rpc.method);
    let result: object;
    if (rpc.method === 'server/discover') result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {} } };
    else if (rpc.method === 'tools/list') result = { tools: ['one','two','hidden'].map(name => ({ name, inputSchema: { type: 'object' } })) };
    else if (rpc.method === 'resources/list') result = { resources: [uri,'source://second','source://hidden'].map(uri => ({ name: uri, uri })) };
    else if (rpc.method === 'resources/templates/list') result = { resourceTemplates: [{ name: 'Broad template', uriTemplate: 'source://{any}' }] };
    else { assert.equal(rpc.method, 'resources/read'); assert.equal(rpc.params.uri, uri); result = { contents }; }
    if (duringResponse && (raceMethod === 'handshake' ? rpc.method === 'server/discover' : rpc.method !== 'server/discover')) { const run = duringResponse; duringResponse = undefined; await run(); }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { ...result, resultType: 'complete', ttlMs: 0, cacheScope: 'private' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; db.close(); await rm(directory, { recursive: true, force: true }); });
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.test', CONNECTOR_FETCH: async (input, init) => {
    const request = new Request(input, init); targets.push(request.url); assert.equal(request.url, endpoint);
    return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, { method: request.method, headers: request.headers, body: request.body, signal: request.signal, redirect: 'manual', duplex: 'half' } as RequestInit);
  } };
  const rotate = () => storeConnectorCredential(env, 'alice', 'connection', 1, { resource: endpoint, tokenType: 'Bearer', accessToken: 'isolated-token' }, future);
  await rotate();
  const grant = () => insert('connection_agent_grants', { id: 'grant', user_id: 'alice', project_id: 'project', connection_id: 'connection', principal_kind: 'api', principal_id: api.tokenId, capabilities_json: '["discover","read_source"]', selection_json: JSON.stringify({ adapter: 'mcp', tools: ['one'], resources: [uri] }), created_at: timestamp, expires_at: future });
  const count = async () => (await db.prepare('SELECT count(*) AS n FROM project_source_snapshots').first<{ n: number }>())!.n;
  return { env, db, session, api, methods, targets, grant, rotate, count, contents: (value: unknown[]) => { contents = value; }, race: (run: () => Promise<unknown>, method = 'after-handshake') => { duringResponse = run; raceMethod = method; } };
}

test('catalog filters both human binding and API grant intersections and never expands templates', async t => {
  const f = await fixture(t), human = await discoverBindingMcpCatalog(f.env, f.session, 'binding');
  assert.deepEqual(human.tools.map(value => value.remoteName), ['one','two']); assert.deepEqual(human.resources.map(value => value.uri), [uri,'source://second']); assert.deepEqual(human.templates, []);
  await f.grant(); const agent = await discoverBindingMcpCatalog(f.env, f.api, 'binding');
  assert.deepEqual(agent.tools.map(value => value.remoteName), ['one']); assert.deepEqual(agent.resources.map(value => value.uri), [uri]); assert.deepEqual(agent.templates, []);
  assert.notEqual(human.fingerprint, agent.fingerprint);
});
test('missing grant, wrong owner, project mismatch and unselected URI fail before credentials or network', async t => {
  const f = await fixture(t);
  await f.db.prepare('DELETE FROM connection_credentials').run();
  await assert.rejects(discoverBindingMcpCatalog(f.env, f.api, 'binding'), error('missing_grant'));
  await assert.rejects(discoverBindingMcpCatalog(f.env, { kind: 'session', sessionId: await hash('bob-session'), userId: 'bob' }, 'binding'), error('binding_not_found'));
  await assert.rejects(importMcpResource(f.env, f.session, 'other', 'binding', uri), error('missing_grant'));
  await assert.rejects(importMcpResource(f.env, f.session, 'project', 'binding', 'source://hidden'), error('missing_grant'));
  assert.deepEqual(f.methods, []); assert.deepEqual(f.targets, []);
});
test('resource read stores canonical inert private content with honest digest provenance', async t => {
  const f = await fixture(t); await f.grant();
  const snapshot = await importMcpResource(f.env, f.api, 'project', 'binding', uri);
  assert.equal(snapshot.remoteIdentity, uri); assert.equal(snapshot.remoteVersion, `sha256:${snapshot.contentHash}`); assert.equal(snapshot.mimeType, 'application/json');
  const content = await getProjectSource(f.env, 'alice', 'project', snapshot.id), text = await new Response(content.body).text();
  assert.equal(text, '{"content":[{"content":{"text":"<script>untrusted()</script>","type":"text"},"type":"resource","uri":"source://selected"}]}');
  await assert.rejects(getProjectSource(f.env, 'bob', 'project', snapshot.id), error('not_found'));
  assert.deepEqual(f.methods, ['server/discover','resources/read']); assert.ok(f.targets.every(target => target === endpoint));
});
test('mismatched resource contents and unsafe media cannot become snapshots', async t => {
  const f = await fixture(t);
  f.contents([{ uri: 'source://other', text: 'unselected' }]); await assert.rejects(importMcpResource(f.env, f.session, 'project', 'binding', uri), error('invalid_resource'));
  f.contents([{ uri, mimeType: 'image/svg+xml', blob: 'YWJj' }]); await assert.rejects(importMcpResource(f.env, f.session, 'project', 'binding', uri), error('unsupported_content'));
  assert.equal(await f.count(), 0);
  f.contents([{ uri, mimeType: 'image/png', blob: 'YWJj' }]); const snapshot = await importMcpResource(f.env, f.session, 'project', 'binding', uri);
  const stored = await getProjectSource(f.env, 'alice', 'project', snapshot.id); assert.match(await new Response(stored.body).text(), /"type":"binary"/);
});
test('expired credentials and active refresh leases fail without network', async t => {
  const f = await fixture(t);
  await f.db.prepare('UPDATE connection_credentials SET expires_at=0').run();
  await assert.rejects(discoverBindingMcpCatalog(f.env, f.session, 'binding'), error('needs_reauthorization'));
  await f.rotate(); await f.db.prepare("UPDATE connection_credentials SET refresh_lease_id='refresh',refresh_lease_expires_at=?").bind(Date.now()+60000).run();
  await assert.rejects(importMcpResource(f.env, f.session, 'project', 'binding', uri), error('needs_reauthorization')); assert.deepEqual(f.targets, []);
});
for (const mutation of ['grant', 'policy', 'credential', 'disconnect'] as const) test(`${mutation} change during HTTP response prevents stale import`, async t => {
  const f = await fixture(t); await f.grant();
  f.race(() => mutation === 'grant' ? f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked'").run()
    : mutation === 'policy' ? f.db.prepare('UPDATE project_connection_bindings SET policy_revision=policy_revision+1').run()
    : mutation === 'credential' ? f.rotate() : disconnectConnection(f.env, 'alice', 'connection', 1));
  await assert.rejects(importMcpResource(f.env, f.api, 'project', 'binding', uri)); assert.equal(await f.count(), 0);
});
test('credential rotation while writing object defeats the atomic snapshot insert', async t => {
  const f = await fixture(t), put = f.env.ASSETS_BUCKET.put.bind(f.env.ASSETS_BUCKET);
  f.env.ASSETS_BUCKET.put = async (...args) => { const result = await put(...args); await f.rotate(); return result; };
  await assert.rejects(importMcpResource(f.env, f.session, 'project', 'binding', uri), error('revision_conflict')); assert.equal(await f.count(), 0);
});
test('catalog cannot return authority revoked while its response was in flight', async t => {
  const f = await fixture(t); await f.grant(); f.race(() => f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked'").run());
  await assert.rejects(discoverBindingMcpCatalog(f.env, f.api, 'binding'), error('missing_grant'));
});

for (const action of ['import', 'discover']) test(`revocation during handshake blocks ${action} before any catalog or resource read`, async t => {
  const f = await fixture(t); await f.grant();
  f.race(() => f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked'").run(), 'handshake');
  await assert.rejects(action === 'import' ? importMcpResource(f.env, f.api, 'project', 'binding', uri) : discoverBindingMcpCatalog(f.env, f.api, 'binding'), error('missing_grant'));
  assert.deepEqual(f.methods, ['server/discover']); assert.equal(await f.count(), 0);
});

test('mounted source routes protect grant-filtered downloads and retain disconnected human copies',async t=>{
  const f=await fixture(t);await f.grant();f.env.CONNECTORS_ENABLED='true';
  const {app}=await import('../server/index');
  const request=(path:string,credential='isolated-api',method='GET')=>app.request(`https://studio.test/api/projects/project/sources${path}`,{method,headers:{Origin:'https://studio.test',...(credential==='isolated-session'?{Cookie:'studio_session=isolated-session'}:{Authorization:`Bearer ${credential}`})}},f.env);
  f.env.APP_URL='https://studio.test';
  const source=await importMcpResource(f.env,f.api,'project','binding',uri);
  assert.equal((await request('')).status,200);
  const download=await request(`/${source.id}`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')! ,/^attachment/);assert.equal(download.headers.get('content-type'),'application/octet-stream');
  assert.match(await download.text(),/untrusted/);
  assert.equal((await request(`/${source.id}`,'isolated-api','DELETE')).status,403);
  await f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked'").run();
  assert.deepEqual(await (await request('')).json(),{sources:[]});assert.equal((await request(`/${source.id}`)).status,403);
  await disconnectConnection(f.env,'alice','connection',1);
  assert.equal((await request(`/${source.id}`,'isolated-session')).status,200);
  assert.equal((await request(`/${source.id}/refresh`,'isolated-session','POST')).status,409);
  assert.equal((await request(`/${source.id}`,'isolated-session','DELETE')).status,200);
  assert.equal(await f.count(),0);
});
