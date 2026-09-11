import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
const migrationUrl = new URL('../migrations/', import.meta.url);
const time = '2026-09-10T12:00:00.000Z';
const hash = 'a'.repeat(64);
async function database(upgrade = false) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  const files = (await readdir(migrationUrl)).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (upgrade && file === '0010-connectors.sql') seed(db);
    db.exec(await readFile(new URL(file, migrationUrl), 'utf8'));
  }
  if (!upgrade) seed(db);
  return db;
}
function insert(db: DatabaseSync, table: string, values: Record<string, SQLInputValue>) {
  const keys = Object.keys(values);
  return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values));
}
function seed(db: DatabaseSync) {
  for (const user of ['alice', 'bob']) {
    insert(db, 'users', { id: user, email: `${user}@migration.test`, name: user, password: 'isolated-test-hash', created_at: time });
    insert(db, 'sessions', { hash: `${user}-session`, user_id: user, expires_at: 1999999999999 });
    insert(db, 'projects', { id: `${user}-project`, user_id: user, name: 'Preserved project', kind: 'web', document: '{"preserved":true}', revision: 7, created_at: time, updated_at: time });
  }
}
function connection(db: DatabaseSync, id = 'connection', user_id = 'alice') {
  insert(db, 'connections', { id, user_id, adapter: 'mcp', display_name: id, endpoint: 'https://remote.vendor.net/mcp', auth_mode: 'anonymous', created_at: time, updated_at: time });
}
function binding(db: DatabaseSync, id = 'binding', overrides: Record<string, SQLInputValue> = {}) {
  insert(db, 'project_connection_bindings', { id, user_id: 'alice', project_id: 'alice-project', connection_id: 'connection', role: 'tool', selection_json: '{"adapter":"mcp","tools":[],"resources":[]}', created_at: time, updated_at: time, ...overrides });
}
function operation(db: DatabaseSync, id = 'operation', overrides: Record<string, SQLInputValue> = {}) {
  insert(db, 'connector_operations', { id, user_id: 'alice', project_id: 'alice-project', connection_id: 'connection', binding_id: 'binding', principal_kind: 'api', principal_id: 'token-id', idempotency_key: 'idempotency-key-0001', action: 'read', effect: 'read', arguments_hash: hash, action_fingerprint: hash, destination_hash: hash, versions_json: '{}', created_at: time, updated_at: time, ...overrides });
}
function approval(db: DatabaseSync, id = 'approval', overrides: Record<string, SQLInputValue> = {}) {
  insert(db, 'connector_approvals', { id, operation_id: 'operation', user_id: 'alice', arguments_hash: hash, action_fingerprint: hash, destination_hash: hash, versions_json: '{}', created_at: time, expires_at: 1999999999999, ...overrides });
}
function run(db: DatabaseSync, id = 'run', overrides: Record<string, SQLInputValue> = {}) {
  insert(db, 'agent_runs', { id, user_id: 'alice', project_id: 'alice-project', principal_kind: 'api', principal_id: 'token-id', idempotency_key: 'run-idempotency-0001', provider: 'openai', model: 'test-model', pins_json: '[{}]', created_at: time, updated_at: time, ...overrides });
}

test('connector migration works fresh and preserves existing data on upgrade', async () => {
  for (const upgrade of [false, true]) {
    const db = await database(upgrade);
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM users').get()!.n, 2);
      assert.deepEqual({ ...db.prepare('SELECT revision,document FROM projects WHERE id=?').get('alice-project')! }, { revision: 7, document: '{"preserved":true}' });
      connection(db); connection(db, 'second-account'); binding(db); operation(db);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('connections','connection_credentials','connection_auth_states','project_connection_bindings','connection_agent_grants','project_source_snapshots','connector_operations','connector_approvals','agent_runs','run_steps')").get()!.n, 10);
    } finally { db.close(); }
  }
});

test('composite foreign keys reject cross-owner credentials, auth states, bindings and approvals', async () => {
  const db = await database();
  try {
    connection(db); binding(db); operation(db);
    assert.throws(() => binding(db, 'wrong-project', { project_id: 'bob-project' }), /FOREIGN KEY/);
    assert.throws(() => binding(db, 'wrong-connection', { user_id: 'bob', project_id: 'bob-project' }), /FOREIGN KEY/);
    assert.throws(() => insert(db, 'connection_credentials', { connection_id: 'connection', user_id: 'bob', encrypted_payload: 'encrypted-test-value', updated_at: time }), /FOREIGN KEY/);
    assert.throws(() => insert(db, 'connection_auth_states', { state_hash: hash, connection_id: 'connection', user_id: 'alice', session_hash: 'bob-session', encrypted_verifier: 'encrypted-test-verifier', expected_issuer: 'https://issuer.vendor.net', expected_resource: 'https://remote.vendor.net/mcp', redirect_uri: 'https://studio.vendor.net/callback', connection_revision: 1, created_at: time, expires_at: 1999999999999 }), /FOREIGN KEY/);
    assert.throws(() => approval(db, 'wrong-owner', { user_id: 'bob' }), /FOREIGN KEY/);
    assert.throws(() => operation(db, 'wrong-operation', { project_id: 'bob-project', idempotency_key: 'another-key-000001' }), /FOREIGN KEY/);
  } finally { db.close(); }
});

test('idempotency includes stable principal identity and OAuth client family', async () => {
  const db = await database();
  try {
    connection(db); binding(db); operation(db);
    assert.throws(() => operation(db, 'duplicate'), /UNIQUE/);
    operation(db, 'different-principal', { principal_id: 'different-token' });
    operation(db, 'oauth-first', { principal_kind: 'oauth', principal_id: 'family', principal_client_id: 'client-a' });
    operation(db, 'oauth-other-client', { principal_kind: 'oauth', principal_id: 'family', principal_client_id: 'client-b' });
    assert.throws(() => operation(db, 'oauth-duplicate', { principal_kind: 'oauth', principal_id: 'family', principal_client_id: 'client-a' }), /UNIQUE/);
    run(db); assert.throws(() => run(db, 'run-duplicate'), /UNIQUE/);
  } finally { db.close(); }
});

test('lifecycle, lease, revision and bounded JSON checks reject inconsistent records', async () => {
  const db = await database();
  try {
    connection(db); binding(db); operation(db);
    for (const sql of ["UPDATE connections SET revision=0", "UPDATE connections SET revision=1.5", "UPDATE connections SET status='invented'", "UPDATE connections SET scopes_json='{'", "UPDATE project_connection_bindings SET selection_json='[]'", "UPDATE connector_operations SET status='running'", "UPDATE connector_operations SET lease_id='lease'", "UPDATE connector_operations SET status='running',effect='write',lease_id='lease',lease_expires_at=1999999999999", "UPDATE connector_operations SET versions_json='[]'"]) assert.throws(() => db.exec(sql), /CHECK|malformed JSON/, sql);
    assert.throws(() => db.prepare('UPDATE project_connection_bindings SET selection_json=?').run(JSON.stringify({ content: 'é'.repeat(550000) })), /CHECK/);
    approval(db);
    db.exec("UPDATE connector_operations SET status='running',effect='write',approval_id='approval',lease_id='lease',lease_expires_at=1999999999999");
    run(db);
    assert.throws(() => db.exec("UPDATE agent_runs SET status='awaiting_approval'"), /CHECK/);
    assert.throws(() => db.exec("UPDATE agent_runs SET status='succeeded'"), /CHECK/);
    assert.throws(() => db.exec('UPDATE agent_runs SET model_turns=9'), /CHECK/);
    insert(db, 'connection_credentials', { connection_id: 'connection', user_id: 'alice', encrypted_payload: 'encrypted-test-value', expires_at: 1999999999999, refresh_lease_id: 'refresh', refresh_lease_expires_at: 1999999999999, updated_at: time });
    assert.throws(() => db.exec("UPDATE connection_credentials SET expires_at='not-an-epoch'"), /CHECK/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('project and owner deletion cascade through connector records without deleting another owner', async () => {
  for (const target of ['project', 'connection', 'owner']) {
    const db = await database();
    try {
      connection(db); connection(db, 'bob-connection', 'bob'); binding(db); operation(db); approval(db);
      db.exec("UPDATE connector_operations SET approval_id='approval'");
      run(db, 'run', { pending_operation_id: 'operation' });
      insert(db, 'run_steps', { id: 'step', run_id: 'run', user_id: 'alice', project_id: 'alice-project', sequence: 1, kind: 'tool', status: 'pending', operation_id: 'operation', created_at: time, updated_at: time });
      insert(db, 'project_source_snapshots', { id: 'snapshot', user_id: 'alice', project_id: 'alice-project', binding_id: 'binding', adapter: 'mcp', remote_identity: 'source', remote_version: 'v1', content_hash: hash, content_object_key: 'private/source', mime_type: 'text/plain', bytes: 3, extraction_version: '1', fetched_at: time });
      insert(db, 'connection_agent_grants', { id: 'grant', user_id: 'alice', project_id: 'alice-project', connection_id: 'connection', principal_kind: 'api', principal_id: 'token', capabilities_json: '["discover"]', selection_json: '{}', created_at: time, expires_at: 1999999999999 });
      insert(db, 'connection_credentials', { connection_id: 'connection', user_id: 'alice', encrypted_payload: 'encrypted-test-value', updated_at: time });
      if (target === 'project') db.exec("DELETE FROM projects WHERE id='alice-project'");
      else if (target === 'connection') db.exec("DELETE FROM connections WHERE id='connection'");
      else db.exec("DELETE FROM users WHERE id='alice'");
      for (const table of ['project_connection_bindings', 'connection_agent_grants', 'project_source_snapshots', 'connector_operations', 'connector_approvals', 'agent_runs', 'run_steps']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, `${target}: ${table}`);
      assert.equal(db.prepare("SELECT count(*) AS n FROM connections WHERE user_id='bob'").get()!.n, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM connection_credentials').get()!.n, target === 'project' ? 1 : 0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
  }
});

test('disconnected cloned snapshots retain project ownership without copying bindings', async () => {
  const db = await database();
  const values = { id: 'cloned-snapshot', user_id: 'alice', project_id: 'alice-project', binding_id: null, adapter: 'mcp', remote_identity: 'source', remote_version: 'v1', content_hash: hash, content_object_key: 'private/cloned-source', mime_type: 'text/plain', bytes: 3, extraction_version: '1', fetched_at: time, status: 'disconnected' };
  try {
    insert(db, 'project_source_snapshots', values);
    assert.throws(() => db.exec("UPDATE project_source_snapshots SET remote_version='changed'"), /immutable/);
    db.exec("UPDATE project_source_snapshots SET status='disconnected'");
    assert.throws(() => insert(db, 'project_source_snapshots', { ...values, id: 'cross-owner', project_id: 'bob-project' }), /FOREIGN KEY/);
    assert.throws(() => insert(db, 'project_source_snapshots', { ...values, id: 'available-unbound', status: 'available' }), /CHECK/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM project_connection_bindings').get()!.n, 0);
    db.exec("DELETE FROM projects WHERE id='alice-project'");
    assert.equal(db.prepare('SELECT count(*) AS n FROM project_source_snapshots').get()!.n, 0);
  } finally { db.close(); }
});

test('auth states are session-bound and disappear on session deletion', async () => {
  const db = await database();
  try {
    connection(db);
    insert(db, 'connection_auth_states', { state_hash: hash, connection_id: 'connection', user_id: 'alice', session_hash: 'alice-session', encrypted_verifier: 'encrypted-test-verifier', expected_issuer: 'https://issuer.vendor.net', expected_resource: 'https://remote.vendor.net/mcp', redirect_uri: 'https://studio.vendor.net/callback', connection_revision: 1, created_at: time, expires_at: 1999999999999 });
    db.exec("DELETE FROM sessions WHERE hash='alice-session'");
    assert.equal(db.prepare('SELECT count(*) AS n FROM connection_auth_states').get()!.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM connections').get()!.n, 1);
  } finally { db.close(); }
});
