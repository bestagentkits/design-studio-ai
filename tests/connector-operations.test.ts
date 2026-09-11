import { setup } from './fixtures/connector-operation-context';
import assert from 'node:assert/strict';
import { readConnectorOperation } from '../server/connector-operation-reads';
import { maintainConnectorState } from '../server/connector-retention';
import { test, type TestContext } from 'node:test';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { ApiError, authenticate, hash, secret } from '../server/security';
import { prepareConnectorOperation as prepare, decideConnectorOperation as decide, claimConnectorOperation as claim, finishConnectorOperation as finish, cancelConnectorOperation as cancel, recoverExpiredConnectorOperations as recover } from '../server/connector-operations';
import type { Bindings, Env } from '../server/types';
import type { ConnectorTool } from '../src/shared/connectors';
import type { ConnectorPrincipal } from '../src/shared/connector-values';

const pins = { connectionRevision: 1, credentialVersion: 1, policyRevision: 1, documentRevision: 1, briefRevision: 0, sourceSnapshotIds: [] };
const tool: ConnectorTool = { connectionId: 'connection', remoteName: 'action', description: 'Isolated tool', fingerprint: 'a'.repeat(64), effect: 'write', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
const input = (key = 'operation-key-0001') => ({ bindingId: 'binding', action: 'action', arguments: { text: 'sensitive argument' }, idempotencyKey: key, expectedVersions: pins });
const error = (code: string) => (value: unknown) => value instanceof ApiError && value.code === code;

test('strict preparation validates trusted schema, stores encrypted arguments, and enforces idempotency', async t => {
  const { env, session, db } = await setup(t);
  await assert.rejects(prepare(env, session, { ...input(), approved: true }, tool));
  await assert.rejects(prepare(env, session, { ...input(), arguments: { text: 3 } }, tool), error('invalid_tool_arguments'));
  const op = await prepare(env, session, input(), tool);
  assert.equal(op.status, 'awaiting_approval'); assert.equal((await prepare(env, session, input(), tool)).id, op.id);
  await assert.rejects(prepare(env, session, { ...input(), arguments: { text: 'other' } }, tool), error('idempotency_conflict'));
  assert.ok(!JSON.stringify(op).includes('sensitive argument'));
  const stored = await db.prepare('SELECT encrypted_arguments FROM connector_operations WHERE id=?').bind(op.id).first<{ encrypted_arguments: string }>();
  assert.ok(stored?.encrypted_arguments && !stored.encrypted_arguments.includes('sensitive argument'));
  await assert.rejects(claim(env, session, op.id, 1, tool), error('approval_required'));
});

test('only human sessions approve exact writes; parallel claims consume approval once and cannot replay', async t => {
  const { env, api, decision, db } = await setup(t), op = await prepare(env, api, input(), tool);
  assert.equal((await decision(op.id, 1, 'approve', 'alice-api')).status, 403);
  assert.equal((await decision(op.id, 1, 'approve', 'bob-session')).status, 404);
  assert.equal((await decision(op.id, 1, 'approve', 'alice-session', { 'X-Studio-Client': 'webmcp', 'X-Studio-Connector-Grant': 'grant' })).status, 403);
  assert.equal((await decision(op.id)).status, 200);
  const results = await Promise.allSettled([claim(env, api, op.id, 2, tool), claim(env, api, op.id, 2, tool)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claim>>>;
  assert.deepEqual(winner.value.arguments, input().arguments);
  assert.ok((await db.prepare('SELECT consumed_at FROM connector_approvals WHERE operation_id=?').bind(op.id).first<{ consumed_at: string }>())?.consumed_at);
  await assert.rejects(claim(env, api, op.id, 2, tool), error('revision_conflict'));
  const done = await finish(env, api, op.id, 3, winner.value.leaseId, { status: 'succeeded', remoteIds: ['remote-id'] });
  assert.equal(done.status, 'succeeded');
  const retained = await db.prepare('SELECT payload_expires_at FROM connector_operations WHERE id=?').bind(op.id).first<{ payload_expires_at: number }>();
  assert.ok(retained!.payload_expires_at > Date.now() + 6.99 * 86400000);
});

test('read claims need grants but do not mint approvals; changed schema fails closed', async t => {
  const { env, api, decision, db } = await setup(t), read = { ...tool, effect: 'read' as const };
  const op = await prepare(env, api, input(), read); assert.equal(op.status, 'pending');
  assert.equal((await decision(op.id)).status, 409);
  await assert.rejects(claim(env, api, op.id, 1, { ...read, inputSchema: { type: 'object' } }), error('schema_changed'));
  await db.prepare("UPDATE connection_agent_grants SET revoked_at=? WHERE id='grant'").bind(new Date().toISOString()).run();
  await assert.rejects(claim(env, api, op.id, 1, read), error('missing_grant'));
});

test('expired approvals and stale document, policy or source pins prevent claims', async t => {
  const { env, session, decision, db } = await setup(t), op = await prepare(env, session, input(), tool);
  assert.equal((await decision(op.id)).status, 200);
  await db.prepare('UPDATE connector_approvals SET expires_at=0').run();
  await assert.rejects(claim(env, session, op.id, 2, tool), error('revision_conflict'));
  for (const [sql, restore] of [["UPDATE projects SET revision=2 WHERE id='alice-project'", "UPDATE projects SET revision=1 WHERE id='alice-project'"], ["UPDATE project_connection_bindings SET policy_revision=2", "UPDATE project_connection_bindings SET policy_revision=1"]]) {
    await db.prepare(sql).run(); await assert.rejects(prepare(env, session, input('new-operation-0001'), tool), error('revision_conflict')); await db.prepare(restore).run();
  }
  await assert.rejects(prepare(env, session, { ...input('new-operation-0002'), expectedVersions: { ...pins, sourceSnapshotIds: ['other-project-snapshot'] } }, tool), error('revision_conflict'));
});

test('denial cancels; expired and cancelled running leases become unknown and reject late finish', async t => {
  const { env, session, decision, db } = await setup(t), denied = await prepare(env, session, input(), tool);
  assert.equal((await decision(denied.id, 1, 'deny')).status, 200);
  await assert.rejects(claim(env, session, denied.id, 2, tool), error('revision_conflict'));
  const read = { ...tool, effect: 'read' as const }, op = await prepare(env, session, input('read-operation-0001'), read), running = await claim(env, session, op.id, 1, read);
  await db.prepare('UPDATE connector_operations SET lease_expires_at=0 WHERE id=?').bind(op.id).run();
  assert.equal(await recover(env, 'alice'), 1); assert.equal(await recover(env, 'alice'), 0);
  await assert.rejects(finish(env, session, op.id, 2, running.leaseId, { status: 'succeeded' }), error('revision_conflict'));
  const second = await prepare(env, session, input('read-operation-0002'), read), lease = await claim(env, session, second.id, 1, read);
  assert.equal((await cancel(env, session, second.id, 2)).status, 'outcome_unknown');
  await assert.rejects(finish(env, session, second.id, 2, lease.leaseId, { status: 'succeeded' }), error('revision_conflict'));
});

test('wrong lease, disconnected connection and ciphertext substitution cannot complete or dispatch', async t => {
  const { env, session, db } = await setup(t), read = { ...tool, effect: 'read' as const };
  const first = await prepare(env, session, input(), read), second = await prepare(env, session, input('other-operation-0001'), read);
  await db.prepare('UPDATE connector_operations SET encrypted_arguments=(SELECT encrypted_arguments FROM connector_operations WHERE id=?) WHERE id=?').bind(first.id, second.id).run();
  await assert.rejects(claim(env, session, second.id, 1, read), error('operation_payload_unavailable'));
  const running = await claim(env, session, first.id, 1, read);
  await assert.rejects(finish(env, session, first.id, 2, 'wrong', { status: 'succeeded' }), error('revision_conflict'));
  await db.prepare("UPDATE connections SET status='disconnected',revision=2").run();
  await assert.rejects(finish(env, session, first.id, 2, running.leaseId, { status: 'succeeded' }), error('connection_revoked'));
});

test('claim CAS rejects a grant revoked after authorization without consuming human approval', async t => {
  const { env, api, decision, db } = await setup(t), op = await prepare(env, api, input(), tool);
  assert.equal((await decision(op.id)).status, 200);
  // This wrapper schedules a real competing database mutation at the claim boundary.
  const batch = db.batch.bind(db);
  db.batch = async statements => {
    await db.prepare("UPDATE connection_agent_grants SET revoked_at=? WHERE id='grant'").bind(new Date().toISOString()).run();
    return batch(statements);
  };
  await assert.rejects(claim(env, api, op.id, 2, tool), error('revision_conflict'));
  assert.equal((await db.prepare('SELECT consumed_at FROM connector_approvals WHERE operation_id=?').bind(op.id).first<{ consumed_at: string | null }>())!.consumed_at, null);
  assert.equal((await db.prepare('SELECT status FROM connector_operations WHERE id=?').bind(op.id).first<{ status: string }>())!.status, 'pending');
});

test('current project and binding policy revisions are checked again at claim and finish', async t => {
  const { env, session, db } = await setup(t), read = { ...tool, effect: 'read' as const };
  const op = await prepare(env, session, input(), read);
  await db.prepare("UPDATE projects SET revision=2 WHERE id='alice-project'").run();
  await assert.rejects(claim(env, session, op.id, 1, read), error('revision_conflict'));
  await db.prepare("UPDATE projects SET revision=1 WHERE id='alice-project'").run();
  const lease = await claim(env, session, op.id, 1, read);
  await db.prepare('UPDATE project_connection_bindings SET policy_revision=2').run();
  await assert.rejects(finish(env, session, op.id, 2, lease.leaseId, { status: 'succeeded' }), error('revision_conflict'));
});

test('unknown effects require approval and source pins cannot cross owners', async t => {
  const { env, session, insert, timestamp } = await setup(t);
  const unknown = { ...tool, effect: 'unknown' as const }, op = await prepare(env, session, input(), unknown);
  assert.equal(op.status, 'awaiting_approval');
  await assert.rejects(claim(env, session, op.id, 1, unknown), error('approval_required'));
  await insert('project_source_snapshots', { id: 'bob-snapshot', user_id: 'bob', project_id: 'bob-project', binding_id: null, adapter: 'mcp', remote_identity: 'source', remote_version: '1', content_hash: 'b'.repeat(64), content_object_key: 'isolated/source.txt', mime_type: 'text/plain', bytes: 1, extraction_version: '1', fetched_at: timestamp, status: 'disconnected' });
  await assert.rejects(prepare(env, session, { ...input('snapshot-operation-0001'), expectedVersions: { ...pins, sourceSnapshotIds: ['bob-snapshot'] } }, unknown), error('revision_conflict'));
});

async function sourceSetup(t: TestContext) {
  const context = await setup(t), { insert, timestamp, env, session } = context;
  await insert('connections', { id: 'source-connection', user_id: 'alice', adapter: 'mcp', display_name: 'Source peer', endpoint: 'https://source.vendor.net/mcp', auth_mode: 'anonymous', status: 'connected', created_at: timestamp, updated_at: timestamp });
  await insert('project_connection_bindings', { id: 'source-binding', user_id: 'alice', project_id: 'alice-project', connection_id: 'source-connection', role: 'source', selection_json: JSON.stringify({ adapter: 'mcp', tools: [], resources: ['source'] }), created_at: timestamp, updated_at: timestamp });
  await insert('project_source_snapshots', { id: 'source-snapshot', user_id: 'alice', project_id: 'alice-project', binding_id: 'source-binding', adapter: 'mcp', remote_identity: 'source', remote_version: '1', content_hash: 'b'.repeat(64), content_object_key: 'isolated/source.txt', mime_type: 'text/plain', bytes: 1, extraction_version: '1', fetched_at: timestamp });
  const selected = (key: string) => ({ ...input(key), expectedVersions: { ...pins, sourceSnapshotIds: ['source-snapshot'] } });
  const run = async (id: string, running: boolean) => {
    await insert('agent_runs', { id, user_id: 'alice', project_id: 'alice-project', principal_kind: 'session', principal_id: session.kind === 'session' ? session.sessionId : '', idempotency_key: `${id}-idempotency-key`, status: running ? 'running' : 'ready_to_continue', provider: 'test-provider', model: 'test-model', pins_json: JSON.stringify([{ bindingId: 'binding', versions: selected('x').expectedVersions }]), source_snapshot_ids_json: '[]', lease_id: running ? `${id}-lease` : null, lease_expires_at: running ? Date.now() + 30000 : null, created_at: timestamp, updated_at: timestamp });
    await insert('run_steps', { id: `${id}-step`, run_id: id, user_id: 'alice', project_id: 'alice-project', sequence: 1, kind: 'tool', status: running ? 'running' : 'pending', lease_id: running ? `${id}-step-lease` : null, lease_expires_at: running ? Date.now() + 30000 : null, created_at: timestamp, updated_at: timestamp });
  };
  const { disconnectConnection } = await import('../server/connection-store');
  return { ...context, selected, run, disconnect: () => disconnectConnection(env, 'alice', 'source-connection', 1) };
}

test('disconnecting another connection invalidates source-pinned approvals and running work but allows explicit retained-copy reuse', async t => {
  const { env, session, decision, db, selected, run, disconnect } = await sourceSetup(t);
  const pending = await prepare(env, session, selected('source-pending-operation'), tool);
  const active = await prepare(env, session, selected('source-active-operation'), tool);
  assert.equal((await decision(pending.id)).status, 200); assert.equal((await decision(active.id)).status, 200);
  const lease = await claim(env, session, active.id, 2, tool);
  await run('source-ready-run', false); await run('source-active-run', true);
  await disconnect();
  for (const [table, id, status] of [['connector_operations', pending.id, 'cancelled'], ['connector_operations', active.id, 'outcome_unknown'], ['agent_runs', 'source-ready-run', 'cancelled'], ['agent_runs', 'source-active-run', 'outcome_unknown'], ['run_steps', 'source-ready-run-step', 'cancelled'], ['run_steps', 'source-active-run-step', 'outcome_unknown']]) {
    const row = await db.prepare(`SELECT status,lease_id,payload_expires_at FROM ${table} WHERE id=?`).bind(id).first<{ status: string; lease_id: string | null; payload_expires_at: number }>();
    assert.equal(row!.status, status); assert.equal(row!.lease_id, null); assert.ok(row!.payload_expires_at > Date.now());
  }
  await assert.rejects(claim(env, session, pending.id, 2, tool), error('revision_conflict'));
  await assert.rejects(finish(env, session, active.id, 3, lease.leaseId, { status: 'succeeded' }), error('revision_conflict'));
  const fresh = await prepare(env, session, selected('retained-copy-operation'), tool);
  assert.equal((await decision(fresh.id)).status, 200);
  assert.equal((await claim(env, session, fresh.id, 2, tool)).operation.status, 'running');
});

test('source removal invalidates cross-connection operations and nested run source pins', async t => {
  const { env, session, db, selected, run } = await sourceSetup(t);
  const pending = await prepare(env, session, selected('deleted-source-operation'), tool);
  await run('deleted-source-run', true);
  await db.prepare("DELETE FROM project_source_snapshots WHERE id='source-snapshot'").run();
  assert.equal((await db.prepare('SELECT status FROM connector_operations WHERE id=?').bind(pending.id).first<{ status: string }>())!.status, 'cancelled');
  for (const table of ['agent_runs', 'run_steps']) assert.equal((await db.prepare(`SELECT status FROM ${table}`).first<{ status: string }>())!.status, 'outcome_unknown');
  await assert.rejects(prepare(env, session, selected('removed-source-retry'), tool), error('revision_conflict'));
});

test('source disconnect between authorization and operation insertion fails the snapshot status CAS', async t => {
  const { env, session, db, selected, disconnect } = await sourceSetup(t);
  const base = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = base(sql);
    if (sql.startsWith('INSERT INTO connector_operations')) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values), execute = bound.run.bind(bound);
        bound.run = async () => { await disconnect(); return execute(); };
        return bound;
      };
    }
    return statement;
  };
  await assert.rejects(prepare(env, session, selected('raced-source-prepare'), tool), error('revision_conflict'));
  assert.equal((await base('SELECT count(*) AS total FROM connector_operations').first<{ total: number }>())!.total, 0);
});

test('source disconnect immediately before claim prevents dispatch and leaves consent unconsumed', async t => {
  const { env, session, db, decision, selected, disconnect } = await sourceSetup(t);
  const op = await prepare(env, session, selected('raced-source-claim'), tool); assert.equal((await decision(op.id)).status, 200);
  const batch = db.batch.bind(db); let intercept = true;
  db.batch = async statements => { if (intercept) { intercept = false; await disconnect(); } return batch(statements); };
  await assert.rejects(claim(env, session, op.id, 2, tool), error('revision_conflict'));
  assert.equal((await db.prepare('SELECT consumed_at FROM connector_approvals WHERE operation_id=?').bind(op.id).first<{ consumed_at: string | null }>())!.consumed_at, null);
});

test('OAuth operation authorization canonicalizes APP_URL to the token resource origin', async t => {
  const { env, db, insert, timestamp } = await setup(t);
  env.APP_URL = 'https://studio.test/nested/path/';
  await insert('oauth_clients', { id: 'client', name: 'Test OAuth', redirect_uris: '[]', created_at: timestamp });
  await insert('oauth_tokens', { hash: await hash('test-oauth-only'), user_id: 'alice', client_id: 'client', family: 'family', resource: 'https://studio.test/mcp', kind: 'access', expires_at: Date.now() + 3600000 });
  await db.prepare("UPDATE connection_agent_grants SET principal_kind='oauth',principal_id='family',principal_client_id='client'").run();
  const actor: ConnectorPrincipal = { kind: 'oauth', userId: 'alice', familyId: 'family', clientId: 'client' };
  const read = { ...tool, effect: 'read' as const }, op = await prepare(env, actor, input(), read);
  assert.equal((await claim(env, actor, op.id, 1, read)).operation.status, 'running');
});

test('removing the source binding invalidates an approved tool on a different binding', async t => {
  const { env, session, decision, db, selected } = await sourceSetup(t);
  const { removeProjectConnectionBinding } = await import('../server/connection-bindings');
  const op = await prepare(env, session, selected('binding-removal-operation'), tool);
  assert.equal((await decision(op.id)).status, 200);
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { await authenticate(c); await next(); });
  app.delete('/', async c => { await removeProjectConnectionBinding(c, 'source-binding', 1); return c.json({ ok: true }); });
  const removed = await app.request('https://studio.test/', { method: 'DELETE', headers: { Cookie: 'studio_session=alice-session' } }, env);
  assert.equal(removed.status, 200);
  assert.equal((await db.prepare('SELECT status FROM connector_operations WHERE id=?').bind(op.id).first<{ status: string }>())!.status, 'cancelled');
  assert.equal(await db.prepare("SELECT id FROM project_source_snapshots WHERE id='source-snapshot'").first(), null);
  await assert.rejects(claim(env, session, op.id, 2, tool), error('revision_conflict'));
});


test('changed tool description invalidates exact approval without consuming it', async t => {
  const { env, api, decision, db } = await setup(t);
  const operation = await prepare(env, api, input(), tool);
  assert.equal((await decision(operation.id)).status, 200);
  await assert.rejects(claim(env, api, operation.id, 2, { ...tool, description: 'Changed remote action instructions' }), error('schema_changed'));
  const approval = await db.prepare('SELECT consumed_at FROM connector_approvals WHERE operation_id=?').bind(operation.id).first<{consumed_at:string|null}>();
  assert.equal(approval!.consumed_at, null);
  const stored = await db.prepare('SELECT status,revision FROM connector_operations WHERE id=?').bind(operation.id).first<{status:string;revision:number}>();
  assert.equal(stored!.status, 'pending'); assert.equal(stored!.revision, 2);
});


test('results are encrypted, read-only, principal-scoped and erased with arguments', async t => {
  const { env, api, session, decision, db } = await setup(t);
  const op = await prepare(env, api, input(), tool);
  assert.equal((await decision(op.id)).status, 200);
  const claimed = await claim(env, api, op.id, 2, tool);
  const result = {content:[{type:'text',text:'private tool output'}]};
  await finish(env, api, op.id, 3, claimed.leaseId, {status:'succeeded',result});
  assert.deepEqual((await readConnectorOperation(env, api, op.id)).result, result);
  assert.deepEqual((await readConnectorOperation(env, session, op.id)).arguments, input().arguments);
  const stored = await db.prepare('SELECT encrypted_result FROM connector_operations WHERE id=?').bind(op.id).first<{encrypted_result:string}>();
  assert.ok(stored!.encrypted_result && !stored!.encrypted_result.includes('private tool output'));
  await db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked' WHERE id='grant'").run();
  const denied = await readConnectorOperation(env, api, op.id);
  assert.equal(denied.operation.status, 'succeeded'); assert.equal(denied.payloadAvailable, false); assert.equal(denied.result, null);
  assert.deepEqual((await readConnectorOperation(env, session, op.id)).result, result);
  await db.prepare('UPDATE connector_operations SET payload_expires_at=1 WHERE id=?').bind(op.id).run();
  assert.equal((await readConnectorOperation(env, session, op.id)).payloadAvailable, false);
  await maintainConnectorState(env);
  const cleared = await db.prepare('SELECT encrypted_arguments,encrypted_result FROM connector_operations WHERE id=?').bind(op.id).first<{encrypted_arguments:null;encrypted_result:null}>();
  assert.equal(cleared!.encrypted_arguments, null); assert.equal(cleared!.encrypted_result, null);
});
