import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import type { ConnectorCredential } from '../connector-credentials';
import { activePrincipalGuard } from '../connector-principal-guard';
import { encrypt,now,fail } from '../security';
import { connectionMetadata,ownedConnection } from '../connection-store';
/** Only a verified provider callback can atomically activate a native account and its credential. */
export async function activateNativeAuthorization(env:Bindings,principal:ConnectorPrincipal,connectionId:string,revision:number,adapter:'github'|'google-drive',identity:string,scopes:string[],credential:ConnectorCredential,expiresAt:number){
  const encrypted=await encrypt(env,JSON.stringify({userId:principal.userId,connectionId,credential})),active=activePrincipalGuard(env,principal);
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO connection_credentials(connection_id,user_id,encrypted_payload,credential_version,expires_at,updated_at)
      SELECT id,user_id,?,1,?,? FROM connections WHERE id=? AND user_id=? AND revision=? AND adapter=? AND status='pending' AND (${active.sql})
      ON CONFLICT(connection_id) DO NOTHING`).bind(encrypted,expiresAt,now(),connectionId,principal.userId,revision,adapter,...active.values),
    env.DB.prepare(`UPDATE connections SET status='connected',remote_identity=?,scopes_json=?,revision=revision+1,updated_at=?
      WHERE id=? AND user_id=? AND revision=? AND status='pending' AND adapter=? AND EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND encrypted_payload=?)`)
      .bind(identity,JSON.stringify(scopes),now(),connectionId,principal.userId,revision,adapter,connectionId,principal.userId,encrypted),
  ]) as {meta:{changes:number}}[];
  if(results.some(result=>result.meta.changes!==1))fail(409,'revision_conflict','The account or session changed during authorization.');
  return connectionMetadata(await ownedConnection(env,principal.userId,connectionId));
}
