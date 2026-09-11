import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { ApiError, encrypt, secret } from '../server/security';
import { maintainConnectorState } from '../server/connector-retention';
import { createConnection, ownedConnection, listOwnedConnections, connectionMetadata, disconnectConnection } from '../server/connection-store';
import { storeConnectorCredential, readConnectorCredential, claimCredentialRefresh, finishCredentialRefresh, abandonCredentialRefresh, type ConnectorCredential, type CredentialRow } from '../server/connector-credentials';
import type { Bindings } from '../server/types';
import { createDocument } from '../src/shared/catalog';

const payload = (suffix = 'original'): ConnectorCredential => ({ accessToken: `isolated-access-${suffix}`, refreshToken: `isolated-refresh-${suffix}`, tokenType: 'Bearer', issuer: 'https://auth.vendor.net', resource: 'https://api.vendor.net/mcp', clientId: 'isolated-client', clientSecret: `isolated-client-secret-${suffix}` });
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const future = () => Date.now() + 3600000;
async function fixture(run: (env: Bindings, db: SqliteDatabase) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-credentials-')), db = new SqliteDatabase(':memory:');
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example' };
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    for (const owner of ['alice', 'bob']) await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(owner, `${owner}@example.com`, owner, 'unused-test-password', new Date().toISOString()).run();
    await run(env, db);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
async function connected(env: Bindings, owner = 'alice') {
  const connection = await createConnection(env, owner, { displayName: 'Isolated connector', config: { adapter: 'mcp', endpoint: 'https://api.vendor.net/mcp', authMode: 'oauth' } });
  // Seed the successfully authorized state; no remote OAuth provider or account is involved.
  await env.DB.prepare("UPDATE connections SET status='connected',remote_identity=? WHERE id=? AND user_id=?").bind(`remote-${owner}`, connection.id, owner).run();
  await storeConnectorCredential(env, owner, connection.id, connection.revision, payload(), future());
  return connection;
}

test('connection ownership isolates metadata and credential read/write/refresh/disconnect', async () => fixture(async env => {
  const alice = await connected(env), bob = await connected(env, 'bob');
  assert.deepEqual((await listOwnedConnections(env, 'alice')).map(row => row.id), [alice.id]);
  assert.deepEqual((await listOwnedConnections(env, 'bob')).map(row => row.id), [bob.id]);
  await assert.rejects(ownedConnection(env, 'bob', alice.id), errorCode('connection_not_found'));
  await assert.rejects(readConnectorCredential(env, 'bob', alice.id), errorCode('connection_not_found'));
  await assert.rejects(storeConnectorCredential(env, 'bob', alice.id, 1, payload('intruder'), future()), errorCode('revision_conflict'));
  await assert.rejects(claimCredentialRefresh(env, 'bob', alice.id, 1, 1), errorCode('refresh_in_progress'));
  await assert.rejects(disconnectConnection(env, 'bob', alice.id, 1), errorCode('connection_not_found'));
  const lease = await claimCredentialRefresh(env, 'alice', alice.id, 1, 1);
  await assert.rejects(finishCredentialRefresh(env, 'bob', alice.id, 1, 1, lease, payload('intruder'), future()), errorCode('revision_conflict'));
  assert.deepEqual((await readConnectorCredential(env, 'alice', alice.id)).credential, payload());
}));

test('stored credentials are encrypted and metadata never includes secret fields', async () => fixture(async env => {
  const connection = await connected(env), stored = await readConnectorCredential(env, 'alice', connection.id);
  assert.deepEqual(stored.credential, payload());
  for (const value of Object.values(payload()).filter(value => value !== 'Bearer')) assert.equal(stored.row.encrypted_payload.includes(value), false);
  const row = await ownedConnection(env, 'alice', connection.id);
  const metadata = connectionMetadata({ ...row, ...stored.row, credential: payload() } as typeof row);
  assert.deepEqual(Object.keys(metadata).sort(), ['id', 'displayName', 'config', 'revision', 'status', 'remoteIdentity', 'scopes', 'capabilityFingerprint', 'updatedAt'].sort());
  const serialized = JSON.stringify(await listOwnedConnections(env, 'alice'));
  for (const field of ['accessToken', 'refreshToken', 'clientSecret', 'encrypted_payload', 'credential_version', 'refresh_lease_id']) assert.equal(serialized.includes(field), false);
  assert.equal(serialized.includes(payload().accessToken), false);
}));

test('ciphertext cannot be substituted between connections or owners and errors remain redacted', async () => fixture(async env => {
  const source = await connected(env), sameOwner = await connected(env), otherOwner = await connected(env, 'bob');
  const encrypted = (await readConnectorCredential(env, 'alice', source.id)).row.encrypted_payload;
  for (const [connection, owner] of [[sameOwner, 'alice'], [otherOwner, 'bob']] as const) {
    await env.DB.prepare('UPDATE connection_credentials SET encrypted_payload=? WHERE connection_id=? AND user_id=?').bind(encrypted, connection.id, owner).run();
    await assert.rejects(readConnectorCredential(env, owner, connection.id), error => errorCode('needs_reauthorization')(error) && !String(error).includes(payload().accessToken));
  }
  await env.DB.prepare('UPDATE connection_credentials SET encrypted_payload=? WHERE connection_id=?').bind('invalid-ciphertext', source.id).run();
  await assert.rejects(readConnectorCredential(env, 'alice', source.id), errorCode('needs_reauthorization'));
}));

test('credential replacement and successful refresh increment versions monotonically', async () => fixture(async env => {
  const connection = await connected(env);
  assert.equal((await readConnectorCredential(env, 'alice', connection.id)).row.credential_version, 1);
  await storeConnectorCredential(env, 'alice', connection.id, 1, payload('replacement'), null);
  assert.equal((await readConnectorCredential(env, 'alice', connection.id)).row.credential_version, 2);
  await assert.rejects(claimCredentialRefresh(env, 'alice', connection.id, 1, 1), errorCode('refresh_in_progress'));
  const lease = await claimCredentialRefresh(env, 'alice', connection.id, 1, 2);
  await finishCredentialRefresh(env, 'alice', connection.id, 1, 2, lease, payload('rotated'), future());
  const stored = await readConnectorCredential(env, 'alice', connection.id);
  assert.equal(stored.row.credential_version, 3); assert.deepEqual(stored.credential, payload('rotated'));
  assert.equal(stored.row.refresh_lease_id, null); assert.equal(stored.row.refresh_lease_expires_at, null);
  await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 2, lease, payload('replay'), future()), errorCode('revision_conflict'));
  assert.equal((await readConnectorCredential(env, 'alice', connection.id)).row.credential_version, 3);
}));

test('concurrent refresh has one lease and rejects version, revision, lease and connection substitution', async () => fixture(async env => {
  const connection = await connected(env), other = await connected(env);
  const results = await Promise.allSettled([claimCredentialRefresh(env, 'alice', connection.id, 1, 1), claimCredentialRefresh(env, 'alice', connection.id, 1, 1)]);
  const winner = results.find(result => result.status === 'fulfilled'); assert.ok(winner && winner.status === 'fulfilled');
  const loser = results.find(result => result.status === 'rejected'); assert.ok(loser && loser.status === 'rejected'); assert.ok(errorCode('refresh_in_progress')(loser.reason));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const otherLease = await claimCredentialRefresh(env, 'alice', other.id, 1, 1);
  for (const [id, revision, version, lease] of [[connection.id, 1, 2, winner.value], [connection.id, 2, 1, winner.value], [connection.id, 1, 1, 'wrong-lease'], [other.id, 1, 1, winner.value]] as const) {
    await assert.rejects(finishCredentialRefresh(env, 'alice', id, revision, version, lease, payload('wrong'), future()), errorCode('revision_conflict'));
  }
  assert.equal((await readConnectorCredential(env, 'alice', other.id)).row.refresh_lease_id, otherLease);
  await storeConnectorCredential(env, 'alice', connection.id, 1, payload('reconnected'), future());
  await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 1, winner.value, payload('late'), future()), errorCode('revision_conflict'));
  assert.deepEqual((await readConnectorCredential(env, 'alice', connection.id)).credential, payload('reconnected'));
}));

test('expired refresh leases cannot be stolen or completed with a possibly rotated token', async () => fixture(async env => {
  const connection = await connected(env), lease = await claimCredentialRefresh(env, 'alice', connection.id, 1, 1);
  await env.DB.prepare('UPDATE connection_credentials SET refresh_lease_expires_at=? WHERE connection_id=?').bind(Date.now() - 1000, connection.id).run();
  await assert.rejects(claimCredentialRefresh(env, 'alice', connection.id, 1, 1), errorCode('refresh_in_progress'));
  await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 1, lease, payload('late'), future()), errorCode('revision_conflict'));
  const stored = await readConnectorCredential(env, 'alice', connection.id);
  assert.equal(stored.row.refresh_lease_id, lease); assert.equal(stored.row.credential_version, 1); assert.deepEqual(stored.credential, payload());
}));

test('invalid expiries cannot replace credentials or consume an active refresh lease', async () => fixture(async env => {
  const connection = await connected(env), lease = await claimCredentialRefresh(env, 'alice', connection.id, 1, 1);
  for (const expiry of [0, Date.now() - 1000, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(storeConnectorCredential(env, 'alice', connection.id, 1, payload('bad-expiry'), expiry), errorCode('invalid_expiry'));
    await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 1, lease, payload('bad-expiry'), expiry), errorCode('invalid_expiry'));
  }
  const stored = await readConnectorCredential(env, 'alice', connection.id);
  assert.equal(stored.row.refresh_lease_id, lease); assert.equal(stored.row.credential_version, 1);
  await finishCredentialRefresh(env, 'alice', connection.id, 1, 1, lease, payload('no-expiry'), null);
  assert.equal((await readConnectorCredential(env, 'alice', connection.id)).row.expires_at, null);
}));

test('disconnect deletes credentials and prevents late refresh or save from resurrecting them', async () => fixture(async env => {
  const connection = await connected(env), lease = await claimCredentialRefresh(env, 'alice', connection.id, 1, 1);
  await assert.rejects(disconnectConnection(env, 'alice', connection.id, 2), errorCode('revision_conflict'));
  assert.equal((await readConnectorCredential(env, 'alice', connection.id)).row.refresh_lease_id, lease);
  const disconnected = await disconnectConnection(env, 'alice', connection.id, 1);
  assert.equal(disconnected.status, 'disconnected'); assert.equal(disconnected.revision, 2);
  await assert.rejects(readConnectorCredential(env, 'alice', connection.id), errorCode('connection_revoked'));
  await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 1, lease, payload('late'), future()), errorCode('revision_conflict'));
  for (const revision of [1, 2]) await assert.rejects(storeConnectorCredential(env, 'alice', connection.id, revision, payload('resurrection'), future()), errorCode('revision_conflict'));
  const row = await env.DB.prepare('SELECT * FROM connection_credentials WHERE connection_id=?').bind(connection.id).first<CredentialRow>();
  assert.equal(row, null); assert.equal((await ownedConnection(env, 'alice', connection.id)).status, 'disconnected');
}));

test('a stale repeated disconnect cannot invalidate a binding policy twice', async () => fixture(async env => {
  const connection = await connected(env), unrelated = await connected(env), timestamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO projects(id,user_id,name,kind,document,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind('project', 'alice', 'Isolated project', 'web', JSON.stringify(createDocument('web', 'Isolated project')), timestamp, timestamp).run();
  for (const [id, connectionId] of [['binding', connection.id], ['unrelated', unrelated.id]]) {
    await env.DB.prepare('INSERT INTO project_connection_bindings(id,user_id,project_id,connection_id,role,selection_json,policy_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id, 'alice', 'project', connectionId, 'tool', JSON.stringify({ adapter: 'mcp', tools: ['read'], resources: [] }), 7, timestamp, timestamp).run();
  }
  const policyRevision = async (id: string) => (await env.DB.prepare('SELECT policy_revision FROM project_connection_bindings WHERE id=?').bind(id).first<{ policy_revision: number }>())!.policy_revision;
  await disconnectConnection(env, 'alice', connection.id, 1);
  assert.equal(await policyRevision('binding'), 8); assert.equal(await policyRevision('unrelated'), 7);
  await assert.rejects(disconnectConnection(env, 'alice', connection.id, 1), errorCode('revision_conflict'));
  assert.equal(await policyRevision('binding'), 8); assert.equal(await policyRevision('unrelated'), 7);
  assert.equal((await ownedConnection(env, 'alice', connection.id)).revision, 2);
}));


test('uncertain refresh requires reauthorization and cannot complete or resurrect a disconnected account', async () => fixture(async env => {
  const connection = await connected(env);
  const lease = await claimCredentialRefresh(env, 'alice', connection.id, 1, 1);
  await abandonCredentialRefresh(env, 'alice', connection.id, 1, 1, lease);
  const current = await ownedConnection(env, 'alice', connection.id);
  assert.equal(current.status, 'needs_reauthorization'); assert.equal(current.revision, 2);
  await assert.rejects(finishCredentialRefresh(env, 'alice', connection.id, 1, 1, lease, payload('late'), future()), errorCode('revision_conflict'));
  await disconnectConnection(env, 'alice', connection.id, 2);
  await assert.rejects(abandonCredentialRefresh(env, 'alice', connection.id, 2, 1, lease), errorCode('revision_conflict'));
  assert.equal((await ownedConnection(env, 'alice', connection.id)).status, 'disconnected');
}));

test('disconnect without snapshots invalidates run steps and expires private terminal payloads', async () => fixture(async env => {
  const connection = await connected(env), unrelated = await connected(env), timestamp = new Date().toISOString();
  const ciphertext = await encrypt(env, 'Isolated private operation and run content'), fingerprint = 'a'.repeat(64);
  const insert = async (table: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    await env.DB.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run();
  };
  await insert('projects', { id: 'project', user_id: 'alice', name: 'Isolated project', kind: 'web', document: '{}', created_at: timestamp, updated_at: timestamp });
  const tracked: { table: string; id: string; payload: string; expectedStatus: string; affected: boolean }[] = [];
  for (const [prefix, connectionId] of [['affected', connection.id], ['unrelated', unrelated.id]]) {
    const bindingId = `${prefix}-binding`;
    await insert('project_connection_bindings', { id: bindingId, user_id: 'alice', project_id: 'project', connection_id: connectionId,
      role: 'tool', selection_json: '{"adapter":"mcp","tools":["read"],"resources":[]}', created_at: timestamp, updated_at: timestamp });
    for (const running of [false, true]) {
      const suffix = `${prefix}-${running ? 'running' : 'pending'}`, runId = `run-${suffix}`;
      const lease = { lease_id: running ? `lease-${suffix}` : null, lease_expires_at: running ? future() : null };
      const common = { user_id: 'alice', project_id: 'project', created_at: timestamp, updated_at: timestamp, ...lease };
      const expectedStatus = running ? 'outcome_unknown' : 'cancelled';
      await insert('connector_operations', { ...common, id: `op-${suffix}`, connection_id: connectionId, binding_id: bindingId,
        principal_kind: 'session', principal_id: 'isolated-session', idempotency_key: `operation-key-${suffix}`, status: running ? 'running' : 'pending',
        action: 'read', effect: 'read', arguments_hash: fingerprint, action_fingerprint: fingerprint, destination_hash: fingerprint,
        versions_json: '{}', encrypted_arguments: ciphertext });
      await insert('agent_runs', { ...common, id: runId, principal_kind: 'session', principal_id: 'isolated-session', idempotency_key: `run-key-${suffix}`,
        status: running ? 'running' : 'ready_to_continue', provider: 'isolated', model: 'isolated', pins_json: JSON.stringify([{ bindingId }]), encrypted_payload: ciphertext });
      await insert('run_steps', { ...common, id: `step-${suffix}`, run_id: runId, sequence: 1, kind: 'model', status: running ? 'running' : 'pending', encrypted_payload: ciphertext });
      for (const [table, id, payloadField, initialStatus] of [
        ['connector_operations', `op-${suffix}`, 'encrypted_arguments', running ? 'running' : 'pending'],
        ['agent_runs', runId, 'encrypted_payload', running ? 'running' : 'ready_to_continue'],
        ['run_steps', `step-${suffix}`, 'encrypted_payload', running ? 'running' : 'pending'],
      ]) tracked.push({ table, id, payload: payloadField, expectedStatus: prefix === 'affected' ? expectedStatus : initialStatus, affected: prefix === 'affected' });
    }
  }
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM project_source_snapshots').first<{ n: number }>())!.n, 0);
  const started = Date.now();
  await disconnectConnection(env, 'alice', connection.id, 1);
  const completed = Date.now();
  await maintainConnectorState(env);
  type LifecycleRow = { status: string; revision: number; lease_id: string | null; lease_expires_at: number | null; payload_expires_at: number | null; payload: string | null };
  const read = (item: typeof tracked[number]) => env.DB.prepare(`SELECT status,revision,lease_id,lease_expires_at,payload_expires_at,${item.payload} AS payload FROM ${item.table} WHERE id=?`).bind(item.id).first<LifecycleRow>();
  for (const item of tracked) {
    const row = (await read(item))!;
    assert.equal(row.status, item.expectedStatus, item.id);
    assert.equal(row.revision, item.affected ? 2 : 1, item.id);
    assert.equal(row.payload, ciphertext, 'Retain terminal payload until its deadline');
    if (item.affected) {
      assert.equal(row.lease_id, null); assert.equal(row.lease_expires_at, null);
      assert.ok(row.payload_expires_at! >= started + 7 * 86400000 && row.payload_expires_at! <= completed + 7 * 86400000);
      await env.DB.prepare(`UPDATE ${item.table} SET payload_expires_at=? WHERE id=?`).bind(Date.now() - 1, item.id).run();
    } else {
      assert.equal(row.payload_expires_at, null);
      assert.equal(Boolean(row.lease_id), item.id.endsWith('running'));
    }
  }
  await maintainConnectorState(env);
  for (const item of tracked) assert.equal((await read(item))!.payload, item.affected ? null : ciphertext, item.id);
}));
