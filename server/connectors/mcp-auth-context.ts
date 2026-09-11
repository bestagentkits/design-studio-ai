import type { AuthorizationServerMetadata, OAuthClientInformationMixed } from '@modelcontextprotocol/client';
import type { Bindings } from '../types';
import type { ConnectorCredential } from '../connector-credentials';
import { boundedConnectorJson } from '../../src/shared/connector-values';
import { encrypt, decrypt, fail, now } from '../security';

export interface McpAuthContext { issuer: string; resource: string; endpoint: string; metadata: AuthorizationServerMetadata; client: OAuthClientInformationMixed; profile: 'modern' | 'legacy'; scope?: string }
export async function sealMcpContext(env: Bindings,userId: string,connectionId: string,context: McpAuthContext,stateHash?: string) {
  const payload = {userId,connectionId,...(stateHash ? {stateHash} : {}),context}; boundedConnectorJson(65536).parse(payload);
  return encrypt(env,JSON.stringify(payload));
}
export async function openMcpContext(env: Bindings,userId: string,connectionId: string,ciphertext: string,stateHash?: string): Promise<McpAuthContext> {
  try {
    const envelope = JSON.parse(await decrypt(env,ciphertext));
    if (envelope.userId !== userId || envelope.connectionId !== connectionId || envelope.stateHash !== stateHash) throw new Error('Context binding mismatch');
    boundedConnectorJson(65536).parse(envelope.context); return envelope.context;
  } catch { return fail(409,'needs_reauthorization','OAuth context is unavailable. Restart authorization.'); }
}
/** Credential and client registration commit together; stale concurrent authorizations cannot mix them. */
export async function storeMcpAuthorization(env: Bindings,userId: string,connectionId: string,revision: number,credential: ConnectorCredential,expiresAt: number | null,context: McpAuthContext,sessionHash: string) {
  const current = await env.DB.prepare('SELECT credential_version FROM connection_credentials WHERE connection_id=? AND user_id=?').bind(connectionId,userId).first<{credential_version:number}>();
  const previous = current?.credential_version ?? 0, version = previous + 1;
  const encrypted = await encrypt(env,JSON.stringify({userId,connectionId,credential})), client = await sealMcpContext(env,userId,connectionId,context);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO connection_credentials(connection_id,user_id,encrypted_payload,credential_version,expires_at,updated_at)
      SELECT id,user_id,?,?,?,? FROM connections WHERE id=? AND user_id=? AND revision=? AND status!='disconnected'
      AND EXISTS(SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires_at>?)
      AND COALESCE((SELECT credential_version FROM connection_credentials WHERE connection_id=? AND user_id=?),0)=?
      ON CONFLICT(connection_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,credential_version=excluded.credential_version,expires_at=excluded.expires_at,refresh_lease_id=NULL,refresh_lease_expires_at=NULL,updated_at=excluded.updated_at`)
      .bind(encrypted,version,expiresAt,now(),connectionId,userId,revision,sessionHash,userId,Date.now(),connectionId,userId,previous),
    env.DB.prepare(`INSERT INTO connection_mcp_oauth_clients(connection_id,user_id,encrypted_context)
      SELECT connection_id,user_id,? FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND encrypted_payload=?
      ON CONFLICT(connection_id) DO UPDATE SET encrypted_context=excluded.encrypted_context`)
      .bind(client,connectionId,userId,version,encrypted),
  ]) as {meta:{changes:number}}[];
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) fail(409,'revision_conflict','Connection changed before authorization was saved.');
  return version;
}
