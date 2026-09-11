import { z } from 'zod';
import type { Bindings } from './types';
import { encrypt, decrypt, fail, id, now } from './security';
import { ownedConnection } from './connection-store';

const credentialPayloadSchema = z.strictObject({
  accessToken: z.string().min(1).max(16384), refreshToken: z.string().min(1).max(16384).optional(),
  tokenType: z.literal('Bearer'), issuer: z.string().max(2048).optional(), resource: z.string().max(2048),
  clientId: z.string().max(2048).optional(), clientSecret: z.string().max(16384).optional(),
});
export type ConnectorCredential = z.infer<typeof credentialPayloadSchema>;
export interface CredentialRow {
  connection_id: string; user_id: string; encrypted_payload: string; credential_version: number;
  expires_at: number | null; refresh_lease_id: string | null; refresh_lease_expires_at: number | null;
}
async function seal(env: Bindings, userId: string, connectionId: string, payload: ConnectorCredential) {
  // Bind ciphertext to its record; swapping encrypted rows must not move authority between accounts.
  return encrypt(env, JSON.stringify({ userId, connectionId, credential: credentialPayloadSchema.parse(payload) }));
}
export async function readConnectorCredential(env: Bindings, userId: string, connectionId: string) {
  const connection = await ownedConnection(env, userId, connectionId);
  if (connection.status === 'disconnected') fail(409, 'connection_revoked', 'Connection is disconnected.');
  const row = await env.DB.prepare('SELECT * FROM connection_credentials WHERE connection_id=? AND user_id=?')
    .bind(connectionId, userId).first<CredentialRow>();
  if (!row) fail(409, 'needs_reauthorization', 'Connect this account again.');
  try {
    const envelope = JSON.parse(await decrypt(env, row.encrypted_payload));
    if (envelope.userId !== userId || envelope.connectionId !== connectionId) throw new Error('Credential binding mismatch');
    return { row, credential: credentialPayloadSchema.parse(envelope.credential), connection };
  } catch { return fail(409, 'needs_reauthorization', 'Stored credentials cannot be used. Reconnect this account.'); }
}
export async function storeConnectorCredential(env: Bindings, userId: string, connectionId: string, expectedRevision: number, payload: ConnectorCredential, expiresAt: number | null) {
  const encrypted = await seal(env, userId, connectionId, payload);
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) fail(400, 'invalid_expiry', 'Credential expiry must be in the future.');
  const result = await env.DB.prepare(`INSERT INTO connection_credentials(connection_id,user_id,encrypted_payload,credential_version,expires_at,updated_at)
    SELECT id,user_id,?,1,?,? FROM connections WHERE id=? AND user_id=? AND revision=? AND status!='disconnected'
    ON CONFLICT(connection_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,credential_version=connection_credentials.credential_version+1,
      expires_at=excluded.expires_at,refresh_lease_id=NULL,refresh_lease_expires_at=NULL,updated_at=excluded.updated_at`)
    .bind(encrypted, expiresAt, now(), connectionId, userId, expectedRevision).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection changed before credentials were saved.');
}
export async function claimCredentialRefresh(env: Bindings, userId: string, connectionId: string, expectedRevision: number, credentialVersion: number) {
  const leaseId = id(), instant = Date.now();
  const result = await env.DB.prepare(`UPDATE connection_credentials SET refresh_lease_id=?,refresh_lease_expires_at=?,updated_at=?
    WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id IS NULL
    AND EXISTS(SELECT 1 FROM connections WHERE id=? AND user_id=? AND revision=? AND status='connected')`)
    .bind(leaseId, instant + 45000, now(), connectionId, userId, credentialVersion, connectionId, userId, expectedRevision).run();
  // Never steal an expired refresh: token rotation may have succeeded before its response was lost.
  if (result.meta.changes !== 1) fail(409, 'refresh_in_progress', 'Credential refresh is already active or requires reconnecting.');
  return leaseId;
}
export async function finishCredentialRefresh(env: Bindings, userId: string, connectionId: string, expectedRevision: number, credentialVersion: number, leaseId: string, payload: ConnectorCredential, expiresAt: number | null) {
  const encrypted = await seal(env, userId, connectionId, payload);
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) fail(400, 'invalid_expiry', 'Credential expiry must be in the future.');
  const result = await env.DB.prepare(`UPDATE connection_credentials SET encrypted_payload=?,credential_version=credential_version+1,expires_at=?,
    refresh_lease_id=NULL,refresh_lease_expires_at=NULL,updated_at=? WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id=? AND refresh_lease_expires_at>?
    AND EXISTS(SELECT 1 FROM connections WHERE id=? AND user_id=? AND revision=? AND status='connected')`)
    .bind(encrypted, expiresAt, now(), connectionId, userId, credentialVersion, leaseId, Date.now(), connectionId, userId, expectedRevision).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection changed or refresh lease expired. Reconnect if the token rotated.');
}

/** Rotation may have happened remotely; uncertainty requires a new human authorization. */
export async function abandonCredentialRefresh(env: Bindings, userId: string, connectionId: string, expectedRevision: number, credentialVersion: number, leaseId: string) {
  const result = await env.DB.prepare(`UPDATE connections SET status='needs_reauthorization',revision=revision+1,updated_at=?
    WHERE id=? AND user_id=? AND revision=? AND status='connected'
    AND EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id=?)`)
    .bind(now(), connectionId, userId, expectedRevision, connectionId, userId, credentialVersion, leaseId).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection or credential refresh changed.');
}
