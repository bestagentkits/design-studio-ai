import type { Bindings } from './types';
import { connectionCreateSchema, connectionMetadataSchema } from '../src/shared/connectors';
import { fail, id, now } from './security';

export interface ConnectionRow {
  id: string; user_id: string; adapter: 'mcp' | 'github' | 'google-drive'; display_name: string;
  endpoint: string | null; auth_mode: 'anonymous' | 'bearer' | 'oauth'; status: 'pending' | 'connected' | 'needs_reauthorization' | 'disconnected';
  revision: number; remote_identity: string | null; scopes_json: string; capability_fingerprint: string | null;
  created_at: string; updated_at: string;
}
export async function ownedConnection(env: Bindings, userId: string, connectionId: string): Promise<ConnectionRow> {
  return await env.DB.prepare('SELECT * FROM connections WHERE id=? AND user_id=?').bind(connectionId, userId).first<ConnectionRow>()
    ?? fail(404, 'connection_not_found', 'Connection not found.');
}
export function connectionMetadata(row: ConnectionRow) {
  return connectionMetadataSchema.parse({
    id: row.id, displayName: row.display_name,
    config: row.adapter === 'mcp' ? { adapter: row.adapter, endpoint: row.endpoint, authMode: row.auth_mode } : { adapter: row.adapter, authMode: 'oauth' },
    revision: row.revision, status: row.status, remoteIdentity: row.remote_identity,
    scopes: JSON.parse(row.scopes_json), capabilityFingerprint: row.capability_fingerprint, updatedAt: row.updated_at,
  });
}
export async function createConnection(env: Bindings, userId: string, input: unknown) {
  const value = connectionCreateSchema.parse(input), connectionId = id(), timestamp = now();
  await env.DB.prepare(`INSERT INTO connections(id,user_id,adapter,display_name,endpoint,auth_mode,status,revision,remote_identity,scopes_json,capability_fingerprint,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'pending',1,NULL,'[]',NULL,?,?)`).bind(connectionId, userId, value.config.adapter, value.displayName,
      value.config.adapter === 'mcp' ? value.config.endpoint : null, value.config.authMode, timestamp, timestamp).run();
  return connectionMetadata(await ownedConnection(env, userId, connectionId));
}
export async function listOwnedConnections(env: Bindings, userId: string) {
  const { results } = await env.DB.prepare('SELECT * FROM connections WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 100').bind(userId).all<ConnectionRow>();
  return results.map(connectionMetadata);
}

/** Disconnect is a tombstone. Imported snapshots remain owned by the project. */
export function disconnectConnection(env: Bindings, userId: string, connectionId: string, expectedRevision: number) {
  return resetConnectionAuthority(env, userId, connectionId, expectedRevision, 'disconnected');
}
/** A new human authorization never inherits old grants, credentials or exact approvals. */
export function restartConnectionAuthorization(env: Bindings, userId: string, connectionId: string, expectedRevision: number) {
  return resetConnectionAuthority(env, userId, connectionId, expectedRevision, 'pending');
}
async function resetConnectionAuthority(env: Bindings, userId: string, connectionId: string, expectedRevision: number, status: 'pending' | 'disconnected') {
  await ownedConnection(env, userId, connectionId);
  const timestamp = now(), retention = Date.now() + 7 * 86400000;
  // Mutate dependents against the old revision, then CAS the connection in the same batch.
  // A repeated stale request must not re-invalidate bindings after an earlier disconnect.
  const guard = "EXISTS(SELECT 1 FROM connections WHERE id=? AND user_id=? AND revision=?)";
  const guarded = (sql: string, values: unknown[]) => env.DB.prepare(sql).bind(...values, connectionId, userId, expectedRevision);
  const result = await env.DB.batch([
    guarded(`DELETE FROM connection_credentials WHERE connection_id=? AND user_id=? AND ${guard}`, [connectionId, userId]),
    guarded(`DELETE FROM connection_auth_states WHERE connection_id=? AND user_id=? AND ${guard}`, [connectionId, userId]),
    guarded(`UPDATE connection_agent_grants SET revoked_at=? WHERE connection_id=? AND user_id=? AND revoked_at IS NULL AND ${guard}`, [timestamp, connectionId, userId]),
    guarded(`UPDATE project_connection_bindings SET policy_revision=policy_revision+1,updated_at=? WHERE connection_id=? AND user_id=? AND ${guard}`, [timestamp, connectionId, userId]),
    guarded(`UPDATE project_source_snapshots SET status='disconnected' WHERE user_id=? AND binding_id IN(SELECT id FROM project_connection_bindings WHERE connection_id=? AND user_id=?) AND ${guard}`, [userId, connectionId, userId]),
    guarded(`UPDATE connector_operations SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
      revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE connection_id=? AND user_id=? AND status IN('pending','awaiting_approval','running') AND ${guard}`, [timestamp, retention, connectionId, userId]),
    guarded(`UPDATE agent_runs SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
      revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE user_id=? AND status IN('ready_to_continue','running','awaiting_approval','needs_reauthorization')
      AND EXISTS(SELECT 1 FROM json_each(agent_runs.pins_json) pin JOIN project_connection_bindings b ON b.id=json_extract(pin.value,'$.bindingId') WHERE b.connection_id=? AND b.user_id=?) AND ${guard}`, [timestamp, retention, userId, connectionId, userId]),
    guarded(`UPDATE run_steps SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
      revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE user_id=? AND status IN('pending','running')
      AND run_id IN(SELECT r.id FROM agent_runs r,json_each(r.pins_json) pin JOIN project_connection_bindings b ON b.id=json_extract(pin.value,'$.bindingId') WHERE r.user_id=? AND b.connection_id=? AND b.user_id=?) AND ${guard}`, [timestamp, retention, userId, userId, connectionId, userId]),
    env.DB.prepare("UPDATE connections SET status=?,revision=revision+1,updated_at=?,remote_identity=CASE WHEN ?='pending' THEN NULL ELSE remote_identity END,scopes_json=CASE WHEN ?='pending' THEN '[]' ELSE scopes_json END,capability_fingerprint=CASE WHEN ?='pending' THEN NULL ELSE capability_fingerprint END WHERE id=? AND user_id=? AND revision=?")
      .bind(status, timestamp, status, status, status, connectionId, userId, expectedRevision),
  ]) as { meta: { changes: number } }[];
  if (result.at(-1)?.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection changed. Reload before disconnecting.');
  return connectionMetadata(await ownedConnection(env, userId, connectionId));
}
