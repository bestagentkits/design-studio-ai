import { z } from 'zod';
import type { Bindings } from './types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { encrypt, decrypt, hash, now, secret, fail } from './security';
import { assertActiveConnectorPrincipal } from './connection-policy';
import { validateConnectorUrl } from './connector-network-policy';
import { ownedConnection } from './connection-store';

const setupSchema = z.strictObject({
  issuer: z.string().max(2048), resource: z.string().max(2048), callback: z.string().max(2048),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});
interface AuthStateRow {
  connection_id: string; user_id: string; encrypted_verifier: string;
  expected_issuer: string; expected_resource: string; redirect_uri: string; connection_revision: number;
}
function humanSession(principal: ConnectorPrincipal): asserts principal is Extract<ConnectorPrincipal, { kind: 'session' }> {
  if (principal.kind !== 'session') fail(403, 'human_action_required', 'Open connection settings to authorize an account.');
}
export async function createConnectorAuthState(env: Bindings, principal: ConnectorPrincipal, connectionId: string, expectedRevision: number, input: z.infer<typeof setupSchema>) {
  humanSession(principal); await assertActiveConnectorPrincipal(env, principal);
  const setup = setupSchema.parse(input), connection = await ownedConnection(env, principal.userId, connectionId);
  if (connection.revision !== expectedRevision || connection.status === 'disconnected') fail(409, 'revision_conflict', 'Connection changed. Restart authorization.');
  validateConnectorUrl(setup.issuer); validateConnectorUrl(setup.resource);
  if (!env.APP_URL) fail(503, 'connector_unconfigured', 'Set the canonical application URL before authorizing connectors.');
  let canonical: URL;
  try { canonical = new URL(env.APP_URL); } catch { return fail(503, 'connector_unconfigured', 'Application URL is invalid.'); }
  const expectedCallback = `${canonical.origin}/api/connectors/${connection.adapter}/callback`;
  if (setup.callback !== expectedCallback) fail(400, 'invalid_callback', 'Connector callback must exactly match this application.');
  const callback = new URL(expectedCallback);
  const state = secret(), stateHash = await hash(state), instant = Date.now();
  const encrypted = await encrypt(env, JSON.stringify({ stateHash, userId: principal.userId, connectionId, verifier: setup.verifier }));
  const result = await env.DB.prepare(`INSERT INTO connection_auth_states(state_hash,connection_id,user_id,session_hash,encrypted_verifier,expected_issuer,expected_resource,redirect_uri,connection_revision,created_at,expires_at)
    SELECT ?,id,user_id,?,?,?,?,?,?,?,? FROM connections WHERE id=? AND user_id=? AND revision=? AND status!='disconnected'
    AND EXISTS(SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires_at>?)`)
    .bind(stateHash, principal.sessionId, encrypted, setup.issuer, setup.resource, callback.href, expectedRevision, now(), instant + 600000,
      connectionId, principal.userId, expectedRevision, principal.sessionId, principal.userId, instant).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Session or connection changed. Restart authorization.');
  return state;
}
export async function consumeConnectorAuthState(env: Bindings, principal: ConnectorPrincipal, state: string, adapter: string) {
  humanSession(principal); await assertActiveConnectorPrincipal(env, principal);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) fail(400, 'invalid_state', 'Authorization state is invalid or expired.');
  const stateHash = await hash(state), instant = Date.now();
  const row = await env.DB.prepare(`UPDATE connection_auth_states SET consumed_at=? WHERE state_hash=? AND user_id=? AND session_hash=? AND consumed_at IS NULL AND expires_at>?
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.hash=connection_auth_states.session_hash AND s.user_id=connection_auth_states.user_id AND s.expires_at>?)
    AND EXISTS(SELECT 1 FROM connections c WHERE c.id=connection_auth_states.connection_id AND c.user_id=connection_auth_states.user_id AND c.revision=connection_auth_states.connection_revision AND c.adapter=? AND c.status!='disconnected')
    RETURNING connection_id,user_id,encrypted_verifier,expected_issuer,expected_resource,redirect_uri,connection_revision`)
    .bind(now(), stateHash, principal.userId, principal.sessionId, instant, instant, adapter).first<AuthStateRow>();
  if (!row) fail(400, 'invalid_state', 'Authorization state is invalid or expired.');
  try {
    const envelope = JSON.parse(await decrypt(env, row.encrypted_verifier));
    if (envelope.stateHash !== stateHash || envelope.userId !== principal.userId || envelope.connectionId !== row.connection_id) throw new Error('Invalid binding');
    const setup = setupSchema.parse({ issuer: row.expected_issuer, resource: row.expected_resource, callback: row.redirect_uri, verifier: envelope.verifier });
    return { connectionId: row.connection_id, connectionRevision: row.connection_revision, ...setup };
  } catch { return fail(400, 'invalid_state', 'Authorization state cannot be used. Restart authorization.'); }
}
