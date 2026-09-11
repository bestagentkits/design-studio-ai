import { app } from '../server/index';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import type { Bindings, Bucket } from '../server/types';
import { ApiError, hash } from '../server/security';
import { importProjectSource, listProjectSources, getProjectSource, removeProjectSource, cloneProjectSources, type SourceImport } from '../server/project-sources';
import { cleanupConnectorObjects, beginConnectorObjectUpload } from '../server/connector-object-cleanup';
import { disconnectConnection } from '../server/connection-store';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const input = (): SourceImport => ({ selection: { adapter: 'mcp', tools: [], resources: ['selected-source'] }, remoteIdentity: 'selected-source', remoteVersion: 'v1', mimeType: 'text/plain', extractionVersion: 'raw-v1', bytes: new TextEncoder().encode('Private source π\n') });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-sources-')), db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const insert = async (table: string, values: Record<string, unknown>) => { const keys = Object.keys(values); await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run(); };
  const timestamp = new Date().toISOString();
  for (const owner of ['alice', 'bob']) {
    await insert('users', { id: owner, name: owner, email: `${owner}@example.com`, password: 'unused', created_at: timestamp });
    await insert('sessions', { hash: await hash(owner), user_id: owner, expires_at: Date.now() + 3600000 });
    await insert('projects', { id: `${owner}-project`, user_id: owner, name: 'Sources', kind: 'web', document: '{"unchanged":true}', revision: 7, created_at: timestamp, updated_at: timestamp });
    await insert('connections', { id: `${owner}-connection`, user_id: owner, adapter: 'mcp', display_name: 'Source', endpoint: 'https://api.vendor.net/mcp', auth_mode: 'anonymous', status: 'connected', created_at: timestamp, updated_at: timestamp });
    await insert('project_connection_bindings', { id: `${owner}-binding`, user_id: owner, project_id: `${owner}-project`, connection_id: `${owner}-connection`, role: 'source', selection_json: JSON.stringify(input().selection), created_at: timestamp, updated_at: timestamp });
  }
  await insert('projects', { id: 'target', user_id: 'alice', name: 'Target', kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
  const bucket = new FileBucket(join(directory, 'bucket')), env: Bindings = { DB: db, ASSETS_BUCKET: bucket };
  const alice: ConnectorPrincipal = { kind: 'session', userId: 'alice', sessionId: await hash('alice') };
  const add = (value = input()) => importProjectSource(env, alice, 'alice-project', 'alice-binding', value);
  const key = async (sourceId: string) => (await db.prepare('SELECT content_object_key FROM project_source_snapshots WHERE id=?').bind(sourceId).first<{ content_object_key: string }>())!.content_object_key;
  const queue = () => db.prepare('SELECT * FROM connector_object_cleanup').all<{ object_key: string; state: string }>();
  const due = () => db.prepare('UPDATE connector_object_cleanup SET due_at=0').run();
  return { env, db, bucket, alice, add, key, queue, due, insert, timestamp };
}

test('private immutable imports hash raw bytes, keep document revision and expose no storage keys', async t => {
  const f = await fixture(t), original = input(), first = await f.add(original), second = await f.add({ ...original, remoteVersion: 'v2', bytes: new TextEncoder().encode('Refreshed') });
  assert.notEqual(first.id, second.id); assert.equal(first.contentHash, createHash('sha256').update(original.bytes).digest('hex'));
  assert.equal((await f.queue()).results.length, 0);
  assert.deepEqual({ ...await f.db.prepare("SELECT document,revision FROM projects WHERE id='alice-project'").first() }, { document: '{"unchanged":true}', revision: 7 });
  assert.equal((await listProjectSources(f.env, 'alice', 'alice-project')).length, 2);
  assert.equal(JSON.stringify(first).includes('content_object_key'), false); assert.equal(JSON.stringify(first).includes('private/'), false);
  const fetched = await getProjectSource(f.env, 'alice', 'alice-project', first.id);
  assert.deepEqual(new Uint8Array(await new Response(fetched.body).arrayBuffer()), original.bytes);
  await assert.rejects(f.db.prepare('UPDATE project_source_snapshots SET remote_version=? WHERE id=?').bind('changed', first.id).run(), /immutable/);
  assert.notEqual(await f.key(first.id), await f.key(second.id));
});

test('project/source ownership and exact selected resources are enforced before upload', async t => {
  const f = await fixture(t), source = await f.add();
  await assert.rejects(listProjectSources(f.env, 'bob', 'alice-project'), errorCode('not_found'));
  await assert.rejects(getProjectSource(f.env, 'bob', 'bob-project', source.id), errorCode('not_found'));
  await assert.rejects(removeProjectSource(f.env, 'bob', 'alice-project', source.id), errorCode('not_found'));
  await assert.rejects(importProjectSource(f.env, f.alice, 'target', 'alice-binding', input()), errorCode('missing_grant'));
  await assert.rejects(f.add({ ...input(), selection: { adapter: 'mcp', tools: [], resources: ['not-selected'] } }), errorCode('missing_grant'));
  await assert.rejects(f.add({ ...input(), selection: { adapter: 'mcp', tools: [], resources: [] } }), errorCode('missing_grant'));
  await assert.rejects(f.add({ ...input(), bytes: new Uint8Array(20 * 1024 * 1024 + 1) }), errorCode('limit_exceeded'));
  assert.equal((await f.queue()).results.length, 0);
});

test('clones copy chosen owned bytes with no binding or live authority and survive disconnect', async t => {
  const f = await fixture(t), source = await f.add(), [copy] = await cloneProjectSources(f.env, 'alice', 'alice-project', 'target', [source.id]);
  assert.equal(copy.bindingId, null); assert.equal(copy.status, 'disconnected'); assert.equal(copy.contentHash, source.contentHash);
  assert.notEqual(await f.key(copy.id), await f.key(source.id));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM project_connection_bindings WHERE project_id='target'").first<{ n: number }>())!.n, 0);
  await assert.rejects(cloneProjectSources(f.env, 'alice', 'alice-project', 'bob-project', [source.id]), errorCode('not_found'));
  await disconnectConnection(f.env, 'alice', 'alice-connection', 1);
  assert.equal((await listProjectSources(f.env, 'alice', 'alice-project'))[0].status, 'disconnected');
  await assert.rejects(f.add(), errorCode('connection_revoked'));
  assert.equal(await new Response((await getProjectSource(f.env, 'alice', 'target', copy.id)).body).text(), 'Private source π\n');
});

test('partial bucket write failure leaves durable deletion intent and cleanup retries deletion failures', async t => {
  const f = await fixture(t);
  const controlled: Bucket = { get: key => f.bucket.get(key), delete: key => f.bucket.delete(key), put: async (key, bytes, options) => { await f.bucket.put(key, bytes, options); throw new Error('controlled partial write'); } };
  f.env.ASSETS_BUCKET = controlled;
  await assert.rejects(f.add(), /controlled partial write/);
  const [pending] = (await f.queue()).results; assert.equal(pending.state, 'deleting'); assert.ok(await f.bucket.get(pending.object_key));
  controlled.delete = async () => { throw new Error('controlled delete failure'); };
  assert.equal((await cleanupConnectorObjects(f.env)).failed, 1); assert.equal((await f.queue()).results.length, 1);
  f.env.ASSETS_BUCKET = f.bucket; await f.due(); assert.equal((await cleanupConnectorObjects(f.env)).deleted, 1);
  assert.equal(await f.bucket.get(pending.object_key), null); assert.equal((await f.queue()).results.length, 0);
});

test('real database insertion failure leaves uploaded bytes recoverable and no snapshot', async t => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER controlled_snapshot_failure BEFORE INSERT ON project_source_snapshots BEGIN SELECT RAISE(ABORT,'controlled database failure'); END;");
  await assert.rejects(f.add(), /controlled database failure/);
  const [pending] = (await f.queue()).results; assert.ok(await f.bucket.get(pending.object_key));
  assert.equal((await listProjectSources(f.env, 'alice', 'alice-project')).length, 0);
  await cleanupConnectorObjects(f.env); assert.equal(await f.bucket.get(pending.object_key), null);
});

test('cleanup claim during a delayed upload prevents finalization and cleans late bytes', async t => {
  const f = await fixture(t); let key = '';
  f.env.ASSETS_BUCKET = { get: value => f.bucket.get(value), delete: value => f.bucket.delete(value), put: async (value, bytes, options) => {
    key = value; await f.due(); assert.equal((await cleanupConnectorObjects(f.env)).deleted, 1);
    assert.equal((await f.queue()).results[0].state, 'abandoned');
    await f.bucket.put(value, bytes, options);
  } };
  await assert.rejects(f.add(), errorCode('revision_conflict'));
  assert.equal((await listProjectSources(f.env, 'alice', 'alice-project')).length, 0);
  assert.ok(await f.bucket.get(key)); await cleanupConnectorObjects(f.env);
  assert.equal(await f.bucket.get(key), null); assert.equal((await f.queue()).results.length, 0);
});

test('interrupted uploader tombstone persists and removes an object recreated after an earlier cleanup', async t => {
  const f = await fixture(t), upload = await beginConnectorObjectUpload(f.env);
  await f.due(); await cleanupConnectorObjects(f.env);
  assert.equal((await f.queue()).results[0].state, 'abandoned');
  await f.bucket.put(upload.key, input().bytes); await f.due(); await cleanupConnectorObjects(f.env);
  assert.equal(await f.bucket.get(upload.key), null); assert.equal((await f.queue()).results[0].state, 'abandoned');
});

test('source removal and project/account cascades queue object deletion durably', async t => {
  const f = await fixture(t), source = await f.add(), sourceKey = await f.key(source.id);
  await removeProjectSource(f.env, 'alice', 'alice-project', source.id);
  assert.ok(await f.bucket.get(sourceKey)); await cleanupConnectorObjects(f.env); assert.equal(await f.bucket.get(sourceKey), null);
  const next = await f.add(), [copy] = await cloneProjectSources(f.env, 'alice', 'alice-project', 'target', [next.id]);
  const originalKey = await f.key(next.id), copyKey = await f.key(copy.id);
  await f.db.prepare("DELETE FROM projects WHERE id='alice-project'").run();
  await f.db.prepare("DELETE FROM users WHERE id='alice'").run();
  assert.equal((await f.queue()).results.length, 2); await cleanupConnectorObjects(f.env);
  assert.equal(await f.bucket.get(originalKey), null); assert.equal(await f.bucket.get(copyKey), null);
});

test('GitHub and Drive imports enforce the exact intersection of binding and API grant selections', async t => {
  for (const adapter of ['github', 'google-drive'] as const) {
    const f = await fixture(t), commit = 'a'.repeat(40);
    const selected = (value: string): SourceImport['selection'] => adapter === 'github' ? { adapter, repositoryId: '123', commit, paths: [value] } : { adapter, fileIds: [value] };
    const allowed = adapter === 'github' ? { adapter, repositoryId: '123', commit, paths: ['allowed', 'blocked'] } : { adapter, fileIds: ['allowed', 'blocked'] };
    await f.db.prepare("UPDATE connections SET adapter=?,auth_mode='oauth',endpoint=NULL,remote_identity='isolated-account' WHERE id='alice-connection'").bind(adapter).run();
    await f.db.prepare("UPDATE project_connection_bindings SET selection_json=? WHERE id='alice-binding'").bind(JSON.stringify(allowed)).run();
    await f.insert('api_tokens', { id: 'token', user_id: 'alice', hash: await hash('source-api'), name: 'Isolated', created_at: f.timestamp });
    await f.insert('connection_agent_grants', { id: 'grant', user_id: 'alice', project_id: 'alice-project', connection_id: 'alice-connection', principal_kind: 'api', principal_id: 'token', capabilities_json: '["read_source"]', selection_json: JSON.stringify(selected('allowed')), created_at: f.timestamp, expires_at: Date.now() + 3600000 });
    const api: ConnectorPrincipal = { kind: 'api', userId: 'alice', tokenId: 'token' };
    const add = (selection: SourceImport['selection']) => importProjectSource(f.env, api, 'alice-project', 'alice-binding', { ...input(), selection });
    await assert.rejects(add(selected('blocked')), errorCode('missing_grant'));
    if (adapter === 'github') await assert.rejects(add({ adapter, repositoryId: '999', commit, paths: ['allowed'] }), errorCode('missing_grant'));
    assert.equal((await add(selected('allowed'))).adapter, adapter);
  }
});

test('revoking a connection during bucket upload denies finalization and retains recoverable bytes', async t => {
  const f = await fixture(t);
  f.env.ASSETS_BUCKET = { get: key => f.bucket.get(key), delete: key => f.bucket.delete(key), put: async (key, bytes, options) => {
    await f.bucket.put(key, bytes, options); await disconnectConnection(f.env, 'alice', 'alice-connection', 1);
  } };
  await assert.rejects(f.add(), errorCode('connection_revoked'));
  assert.equal((await listProjectSources(f.env, 'alice', 'alice-project')).length, 0);
  const [pending] = (await f.queue()).results; assert.ok(await f.bucket.get(pending.object_key));
  await cleanupConnectorObjects(f.env); assert.equal(await f.bucket.get(pending.object_key), null);
});

test('20 MiB boundary is accepted and clones reject corrupted private object bytes', async t => {
  const f = await fixture(t), source = await f.add({ ...input(), bytes: new Uint8Array(20 * 1024 * 1024) });
  assert.equal(source.bytes, 20 * 1024 * 1024);
  const key = await f.key(source.id); await f.bucket.put(key, new Uint8Array([1]));
  await assert.rejects(cloneProjectSources(f.env, 'alice', 'alice-project', 'target', [source.id]), errorCode('revision_conflict'));
  assert.equal((await listProjectSources(f.env, 'alice', 'target')).length, 0);
});

test('pending deletion takes priority over unresolved upload tombstones under a bounded cleanup budget', async t => {
  const f = await fixture(t), upload = await beginConnectorObjectUpload(f.env);
  await f.due(); await cleanupConnectorObjects(f.env);
  const source = await f.add(), key = await f.key(source.id);
  await removeProjectSource(f.env, 'alice', 'alice-project', source.id); await f.due();
  assert.equal((await cleanupConnectorObjects(f.env, 1)).examined, 1);
  assert.equal(await f.bucket.get(key), null);
  assert.deepEqual((await f.queue()).results.map(row => row.object_key), [upload.key]);
});


for (const failDelete of [false,true]) test(`project DELETE cleans private snapshots with durable retry=${failDelete}`, async t => {
  const f=await fixture(t), snapshot=await f.add(), objectKey=await f.key(snapshot.id);
  const remove=f.bucket.delete.bind(f.bucket);
  if (failDelete) f.bucket.delete=async()=>{throw new Error('isolated storage failure');};
  const response=await app.request('https://studio.test/api/projects/alice-project',{method:'DELETE',headers:{Cookie:'studio_session=alice',Origin:'https://studio.test'}}, {...f.env,APP_URL:'https://studio.test'});
  assert.equal(response.status,200);
  assert.equal(await f.db.prepare('SELECT id FROM project_source_snapshots WHERE id=?').bind(snapshot.id).first(),null);
  if(failDelete){assert.equal((await f.queue()).results.length,1);f.bucket.delete=remove;await f.due();await cleanupConnectorObjects(f.env);}
  assert.equal(await f.bucket.get(objectKey),null);assert.equal((await f.queue()).results.length,0);
});
