import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = new URL('../../../../', import.meta.url), timestamp = new Date().toISOString();
const migrationDirectory = new URL('migrations/', root);
const sourceFiles = ['migrations/0010-connectors.sql', 'server/connection-store.ts', 'server/connector-credentials.ts'];
const hashSources = () => Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')]));
const sourceHashes = Object.fromEntries(await hashSources());
const worker = await build({ stdin: { resolveDir: root.pathname, contents: `
  import {createConnection,disconnectConnection,listOwnedConnections} from './server/connection-store.ts';
  import {storeConnectorCredential,readConnectorCredential,claimCredentialRefresh,finishCredentialRefresh} from './server/connector-credentials.ts';
  const payload={accessToken:'isolated-access-value',refreshToken:'isolated-refresh-value',tokenType:'Bearer',resource:'https://vendor.net/mcp'};
  export default {async fetch(request,env){
    const x=await request.json(), owner=x.owner??'alice';
    try {
      let value;
      switch(x.action){
        case 'create': value=await createConnection(env,owner,{displayName:'Isolated D1 probe',config:{adapter:'mcp',authMode:'oauth',endpoint:'https://vendor.net/mcp'}}); break;
        case 'store': await storeConnectorCredential(env,owner,x.id,x.revision,payload,null); value={stored:true}; break;
        case 'read': {const read=await readConnectorCredential(env,owner,x.id); value={version:read.row.credential_version,roundTrip:read.credential.accessToken===payload.accessToken,ciphertextContainsToken:read.row.encrypted_payload.includes(payload.accessToken)}; break;}
        case 'claim': value={lease:await claimCredentialRefresh(env,owner,x.id,x.revision,x.version)}; break;
        case 'finish': await finishCredentialRefresh(env,owner,x.id,x.revision,x.version,x.lease,payload,null); value={finished:true}; break;
        case 'disconnect': value=await disconnectConnection(env,owner,x.id,x.revision); break;
        case 'list': value=await listOwnedConnections(env,owner); break;
        default: throw new Error('Unknown scratch action');
      }
      return Response.json({value});
    } catch(error){return Response.json({error:error.code??'unexpected',message:error.code?error.message:'Unexpected scratch failure'},{status:error.status??500});}
  }};` }, bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['workerd'], minify: true });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { ENCRYPTION_KEY: randomBytes(32).toString('base64') }, script: worker.outputFiles[0].text }));
try {
  const db = await runtime.getD1Database('DB');
  const insert = async (table, values) => {
    const keys = Object.keys(values);
    return db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  };
  const migrations = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort();
  let preserved;
  for (const file of migrations) {
    if (file === '0010-connectors.sql') {
      for (const owner of ['alice', 'bob']) await insert('users', { id: owner, email: `${owner}@probe.example`, name: owner, password: 'unused-probe-value', created_at: timestamp });
      await insert('projects', { id: 'project', user_id: 'alice', name: 'Preserved upgrade data', kind: 'web', document: '{"preserved":true}', revision: 7, created_at: timestamp, updated_at: timestamp });
      preserved = await db.prepare("SELECT document,revision FROM projects WHERE id='project'").first();
    }
    const sql = await readFile(new URL(file, migrationDirectory), 'utf8');
    // D1 exec consumes SQL lines; preserve complete multi-line statements/triggers as one script line.
    await db.exec(sql.replace(/^\s*--.*$/gm, '').replace(/\r?\n/g, ' '));
  }
  assert.ok(preserved, 'Probe must seed data before connector migration');
  assert.deepEqual(await db.prepare("SELECT document,revision FROM projects WHERE id='project'").first(), preserved);
  const call = async (action, fields = {}, status = 200, error) => {
    const response = await runtime.dispatchFetch('http://persistence.test', { method: 'POST', body: JSON.stringify({ action, ...fields }) });
    const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body));
    if (error) assert.equal(body.error, error); return body.value;
  };
  const connection = await call('create');
  await db.prepare("UPDATE connections SET status='connected',remote_identity='isolated-remote' WHERE id=?").bind(connection.id).run();
  const pin = { id: connection.id, revision: 1, version: 1 };
  await call('store', pin);
  assert.deepEqual(await call('read', pin), { version: 1, roundTrip: true, ciphertextContainsToken: false });
  await call('read', { ...pin, owner: 'bob' }, 404, 'connection_not_found');
  assert.deepEqual(await call('list', { owner: 'bob' }), []);
  const claims = await Promise.all([0, 1].map(async () => {
    const response = await runtime.dispatchFetch('http://persistence.test', { method: 'POST', body: JSON.stringify({ action: 'claim', ...pin }) });
    return { status: response.status, body: await response.json() };
  }));
  assert.deepEqual(claims.map(result => result.status).sort(), [200, 409]);
  assert.equal(claims.find(result => result.status === 409).body.error, 'refresh_in_progress');
  const lease = claims.find(result => result.status === 200).body.value.lease;
  await call('finish', { ...pin, lease: 'mismatched' }, 409, 'revision_conflict');
  await call('finish', { ...pin, lease });
  assert.equal((await call('read', pin)).version, 2);
  await call('finish', { ...pin, lease }, 409, 'revision_conflict');
  const nextLease = (await call('claim', { ...pin, version: 2 })).lease;
  const baseBinding = { user_id: 'alice', project_id: 'project', connection_id: connection.id, role: 'tool', selection_json: '{"adapter":"mcp","tools":[],"resources":[]}', policy_revision: 7, created_at: timestamp, updated_at: timestamp };
  await insert('project_connection_bindings', { id: 'binding', ...baseBinding });
  await assert.rejects(insert('project_connection_bindings', { id: 'cross-owner', ...baseBinding, user_id: 'bob' }), /FOREIGN KEY/);
  await assert.rejects(db.prepare("UPDATE project_connection_bindings SET selection_json='[]' WHERE id='binding'").run(), /CHECK/);
  const fingerprint = 'a'.repeat(64);
  await insert('project_source_snapshots', { id: 'snapshot', user_id: 'alice', project_id: 'project', binding_id: 'binding', adapter: 'mcp', remote_identity: 'resource://probe', remote_version: '1', content_hash: fingerprint, content_object_key: 'probe/snapshot', mime_type: 'text/plain', bytes: 4, extraction_version: 'v1', fetched_at: timestamp });
  await assert.rejects(db.prepare("UPDATE project_source_snapshots SET remote_version='2' WHERE id='snapshot'").run(), /immutable/);
  for (const status of ['pending', 'running']) {
    await insert('connector_operations', { id: `operation-${status}`, user_id: 'alice', project_id: 'project', connection_id: connection.id, binding_id: 'binding', principal_kind: 'api', principal_id: 'probe-principal', idempotency_key: `operation-${status}-key`, status, action: 'read', effect: 'read', arguments_hash: fingerprint, action_fingerprint: fingerprint, destination_hash: fingerprint, versions_json: '{}', lease_id: status === 'running' ? 'operation-lease' : null, lease_expires_at: status === 'running' ? Date.now() + 60000 : null, created_at: timestamp, updated_at: timestamp });
    await insert('agent_runs', { id: `run-${status}`, user_id: 'alice', project_id: 'project', principal_kind: 'api', principal_id: 'probe-principal', idempotency_key: `run-${status}-idempotency`, status: status === 'pending' ? 'ready_to_continue' : status, provider: 'openai', model: 'probe', pins_json: '[{"bindingId":"binding","versions":{}}]', lease_id: status === 'running' ? 'run-lease' : null, lease_expires_at: status === 'running' ? Date.now() + 60000 : null, created_at: timestamp, updated_at: timestamp });
  }
  const batch = await db.batch([
    db.prepare("UPDATE project_connection_bindings SET updated_at=? WHERE id='binding'").bind(timestamp),
    db.prepare("UPDATE project_connection_bindings SET updated_at=? WHERE id='absent'").bind(timestamp),
  ]);
  assert.deepEqual(batch.map(result => result.meta.changes), [1, 0]);
  await assert.rejects(db.batch([
    db.prepare("UPDATE project_connection_bindings SET policy_revision=100 WHERE id='binding'"),
    db.prepare("UPDATE project_connection_bindings SET selection_json='[]' WHERE id='binding'"),
  ]), /CHECK/);
  const policy = () => db.prepare("SELECT policy_revision FROM project_connection_bindings WHERE id='binding'").first();
  assert.equal((await policy()).policy_revision, 7, 'D1 batch rolls back preceding writes on constraint failure');
  assert.equal((await call('disconnect', pin)).revision, 2);
  assert.equal((await policy()).policy_revision, 8);
  await call('disconnect', pin, 409, 'revision_conflict');
  assert.equal((await policy()).policy_revision, 8);
  await call('finish', { ...pin, version: 2, lease: nextLease }, 409, 'revision_conflict');
  await call('store', { ...pin, revision: 2 }, 409, 'revision_conflict');
  assert.equal(await db.prepare('SELECT 1 AS present FROM connection_credentials WHERE connection_id=?').bind(connection.id).first(), null);
  assert.deepEqual(await db.prepare("SELECT status,remote_version FROM project_source_snapshots WHERE id='snapshot'").first(), { status: 'disconnected', remote_version: '1' });
  for (const table of ['connector_operations', 'agent_runs']) {
    const { results } = await db.prepare(`SELECT status,lease_id,revision FROM ${table} ORDER BY id`).all();
    assert.deepEqual(results, [{ status: 'cancelled', lease_id: null, revision: 2 }, { status: 'outcome_unknown', lease_id: null, revision: 2 }]);
  }
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual(Object.fromEntries(await hashSources()), sourceHashes, 'Reviewed source changed during the probe; rerun against a stable revision');
  console.log(JSON.stringify({ runtime: 'local workerd + ephemeral D1', compatibilityDate: '2026-09-07', node: process.version, migrations, sourceHashes, workerBundleBytes: worker.outputFiles[0].contents.length,
    upgradePreserved: preserved, credentialRoundTrip: true, refreshClaims: claims.map(result => result.status).sort(), credentialVersionAfterRefresh: 2,
    batchMetaChanges: batch.map(result => result.meta.changes), batchFailureRolledBack: true, compositeForeignKeyRejected: true, jsonShapeRejected: true, immutableTriggerRejected: true,
    disconnectPolicyRevision: 8, staleDisconnectPolicyRevision: 8, lateRefreshRejected: true, disconnectedSaveRejected: true, snapshotContentRetained: true, dependentPendingCancelled: true, dependentRunningUnknown: true, foreignKeyViolations: 0 }));
} finally { await runtime.dispose(); }
