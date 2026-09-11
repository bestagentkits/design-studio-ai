import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { ApiError, secret, hash, encrypt } from '../server/security';
import { createConnection, disconnectConnection } from '../server/connection-store';
import { createConnectorAuthState as createState, consumeConnectorAuthState as consumeState } from '../server/connector-auth-states';
import type { Bindings } from '../server/types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';

type Session = Extract<ConnectorPrincipal, { kind: 'session' }>;
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const setup = (adapter = 'mcp') => ({ issuer: 'https://auth.vendor.net', resource: 'https://api.vendor.net/mcp', callback: `https://studio.example/api/connectors/${adapter}/callback`, verifier: secret() });
async function fixture(run: (env: Bindings, sessions: Session[]) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-auth-states-')), db = new SqliteDatabase(':memory:');
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example' };
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    for (const owner of ['alice', 'bob']) await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(owner, `${owner}@example.com`, owner, 'unused-test-password', new Date().toISOString()).run();
    const sessions: Session[] = [];
    for (const userId of ['alice', 'alice', 'bob']) {
      const sessionId = await hash(secret());
      await db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(sessionId, userId, Date.now() + 3600000).run();
      sessions.push({ kind: 'session', userId, sessionId });
    }
    await run(env, sessions);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
const connection = (env: Bindings, userId = 'alice', adapter: 'mcp' | 'github' | 'google-drive' = 'mcp') => createConnection(env, userId, { displayName: 'Isolated authorization', config: adapter === 'mcp' ? { adapter, endpoint: 'https://api.vendor.net/mcp', authMode: 'oauth' } : { adapter, authMode: 'oauth' } });

test('authorization state stores only a hash and encrypted verifier, and is consumed once', async () => fixture(async (env, [alice]) => {
  const c = await connection(env), input = setup(), state = await createState(env, alice, c.id, 1, input);
  const row = await env.DB.prepare('SELECT * FROM connection_auth_states WHERE state_hash=?').bind(await hash(state)).first<{ state_hash: string; encrypted_verifier: string; session_hash: string }>();
  assert.ok(row); assert.equal(row.session_hash, alice.sessionId); assert.notEqual(row.state_hash, state);
  assert.equal(JSON.stringify(row).includes(input.verifier), false);
  assert.deepEqual(await consumeState(env, alice, state, 'mcp'), { connectionId: c.id, connectionRevision: 1, ...input });
  await assert.rejects(consumeState(env, alice, state, 'mcp'), errorCode('invalid_state'));
  const concurrent = await createState(env, alice, c.id, 1, setup());
  const outcomes = await Promise.allSettled([consumeState(env, alice, concurrent, 'mcp'), consumeState(env, alice, concurrent, 'mcp')]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const loser = outcomes.find(outcome => outcome.status === 'rejected'); assert.ok(loser?.status === 'rejected' && errorCode('invalid_state')(loser.reason));
}));

test('user, browser session, adapter and human authority must match without burning another session state', async () => fixture(async (env, [alice, otherSession, bob]) => {
  const c = await connection(env), state = await createState(env, alice, c.id, 1, setup());
  for (const [principal, adapter] of [[bob, 'mcp'], [otherSession, 'mcp'], [alice, 'github']] as const) await assert.rejects(consumeState(env, principal, state, adapter), errorCode('invalid_state'));
  await assert.rejects(createState(env, bob, c.id, 1, setup()), errorCode('connection_not_found'));
  const api: ConnectorPrincipal = { kind: 'api', userId: 'alice', tokenId: 'isolated-token' };
  await assert.rejects(createState(env, api, c.id, 1, setup()), errorCode('human_action_required'));
  await assert.rejects(consumeState(env, api, state, 'mcp'), errorCode('human_action_required'));
  assert.equal((await consumeState(env, alice, state, 'mcp')).connectionId, c.id);
}));

test('revoked and expired sessions cannot create or consume authorization state', async () => fixture(async (env, [alice, otherSession]) => {
  const c = await connection(env);
  for (const [principal, revoke] of [[alice, true], [otherSession, false]] as const) {
    const state = await createState(env, principal, c.id, 1, setup());
    await env.DB.prepare(revoke ? 'DELETE FROM sessions WHERE hash=?' : 'UPDATE sessions SET expires_at=0 WHERE hash=?').bind(principal.sessionId).run();
    await assert.rejects(createState(env, principal, c.id, 1, setup()), errorCode('missing_grant'));
    await assert.rejects(consumeState(env, principal, state, 'mcp'), errorCode('missing_grant'));
  }
}));

test('expired state, stale connection revisions and disconnect invalidate authorization', async () => fixture(async (env, [alice]) => {
  const c = await connection(env), expired = await createState(env, alice, c.id, 1, setup());
  await env.DB.prepare('UPDATE connection_auth_states SET expires_at=0 WHERE state_hash=?').bind(await hash(expired)).run();
  await assert.rejects(consumeState(env, alice, expired, 'mcp'), errorCode('invalid_state'));
  const stale = await createState(env, alice, c.id, 1, setup());
  await env.DB.prepare('UPDATE connections SET revision=2 WHERE id=?').bind(c.id).run();
  await assert.rejects(consumeState(env, alice, stale, 'mcp'), errorCode('invalid_state'));
  await assert.rejects(createState(env, alice, c.id, 1, setup()), errorCode('revision_conflict'));
  const disconnected = await createState(env, alice, c.id, 2, setup());
  await disconnectConnection(env, 'alice', c.id, 2);
  await assert.rejects(consumeState(env, alice, disconnected, 'mcp'), errorCode('invalid_state'));
  await assert.rejects(createState(env, alice, c.id, 3, setup()), errorCode('revision_conflict'));
}));

test('callbacks use the own origin and adapter path with no credentials, query or fragment', async () => fixture(async (env, [alice]) => {
  for (const adapter of ['mcp', 'github', 'google-drive'] as const) {
    const c = await connection(env, 'alice', adapter), input = setup(adapter);
    assert.equal((await consumeState(env, alice, await createState(env, alice, c.id, 1, input), adapter)).callback, input.callback);
  }
  const c = await connection(env), input = setup();
  for (const callback of ['https://other.example/api/connectors/mcp/callback', 'http://studio.example/api/connectors/mcp/callback', 'https://studio.example:444/api/connectors/mcp/callback', 'https://studio.example/api/connectors/github/callback', `${input.callback}/`, `${input.callback}?code=1`, `${input.callback}#fragment`, 'https://user:pass@studio.example/api/connectors/mcp/callback', 'not-a-url', `${input.callback}?`, `${input.callback}#`]) {
    await assert.rejects(createState(env, alice, c.id, 1, { ...input, callback }), errorCode('invalid_callback'), callback);
  }
}));

test('malformed state and PKCE verifier values fail closed', async () => fixture(async (env, [alice]) => {
  const c = await connection(env), input = setup();
  for (const state of ['', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43), secret()]) await assert.rejects(consumeState(env, alice, state, 'mcp'), errorCode('invalid_state'));
  for (const verifier of ['', 'a'.repeat(42), 'a'.repeat(129), ' '.repeat(43), 'é'.repeat(43)]) await assert.rejects(createState(env, alice, c.id, 1, { ...input, verifier }));
  for (const verifier of ['a'.repeat(43), '~'.repeat(128)]) assert.equal((await consumeState(env, alice, await createState(env, alice, c.id, 1, { ...input, verifier }), 'mcp')).verifier, verifier);
}));

test('encrypted verifier substitution across states, connections and owners cannot authorize', async () => fixture(async (env, [alice, , bob]) => {
  const source = await connection(env), other = await connection(env), foreign = await connection(env, 'bob');
  const input = setup(), original = await createState(env, alice, source.id, 1, input);
  const row = await env.DB.prepare('SELECT encrypted_verifier FROM connection_auth_states WHERE state_hash=?').bind(await hash(original)).first<{ encrypted_verifier: string }>(); assert.ok(row);
  for (const [c, principal] of [[source, alice], [other, alice], [foreign, bob]] as const) {
    const target = await createState(env, principal, c.id, 1, setup());
    await env.DB.prepare('UPDATE connection_auth_states SET encrypted_verifier=? WHERE state_hash=?').bind(row.encrypted_verifier, await hash(target)).run();
    await assert.rejects(consumeState(env, principal, target, 'mcp'), error => errorCode('invalid_state')(error) && !String(error).includes(input.verifier));
    const consumed = await env.DB.prepare('SELECT consumed_at FROM connection_auth_states WHERE state_hash=?').bind(await hash(target)).first<{ consumed_at: string | null }>(); assert.ok(consumed?.consumed_at);
    await assert.rejects(consumeState(env, principal, target, 'mcp'), errorCode('invalid_state'));
  }
  assert.equal((await consumeState(env, alice, original, 'mcp')).verifier, input.verifier);
}));


test('decrypted envelope independently binds user, connection and a valid verifier', async () => fixture(async (env, [alice]) => {
  const c = await connection(env);
  for (const mutation of [{ userId: 'bob' }, { connectionId: 'different-connection' }, { verifier: 'too-short' }]) {
    const input = setup(), state = await createState(env, alice, c.id, 1, input), stateHash = await hash(state);
    const encrypted = await encrypt(env, JSON.stringify({ stateHash, userId: alice.userId, connectionId: c.id, verifier: input.verifier, ...mutation }));
    await env.DB.prepare('UPDATE connection_auth_states SET encrypted_verifier=? WHERE state_hash=?').bind(encrypted, stateHash).run();
    await assert.rejects(consumeState(env, alice, state, 'mcp'), errorCode('invalid_state'));
  }
}));
