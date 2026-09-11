import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { ownedConnection } from '../connection-store';
import { readConnectorCredential } from '../connector-credentials';
import { activePrincipalGuard, operationClockSql } from '../connector-principal-guard';
import { fail, now } from '../security';
import { withMcpClient } from './mcp-client';
import { readMcpCatalog } from './mcp-catalog';

/** A person may browse a connected server before granting any of its capabilities. */
export async function discoverOwnedMcpCatalog(env:Bindings, principal:ConnectorPrincipal, connectionId:string) {
  if(principal.kind!=='session')fail(403,'human_action_required','Select project capabilities in Studio.');
  await assertActiveConnectorPrincipal(env,principal);
  const connection=await ownedConnection(env,principal.userId,connectionId);
  if(connection.adapter!=='mcp')fail(400,'unsupported_protocol','An MCP connection is required.');
  if(connection.status!=='connected')fail(409,'needs_reauthorization','Connect this server first.');
  const stored=connection.auth_mode==='anonymous'?undefined:await readConnectorCredential(env,principal.userId,connectionId);
  if(stored&&(stored.connection.revision!==connection.revision||stored.row.refresh_lease_id||stored.row.expires_at!==null&&stored.row.expires_at<=Date.now()))
    fail(409,'needs_reauthorization','Connection credentials changed or expired.');
  const catalog=await withMcpClient(env,connection,stored?.credential,readMcpCatalog);
  const active=activePrincipalGuard(env,principal);
  const credential=stored?` AND EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id IS NULL AND (expires_at IS NULL OR expires_at>${operationClockSql}))`:'';
  const result=await env.DB.prepare(`UPDATE connections SET capability_fingerprint=?,updated_at=? WHERE id=? AND user_id=? AND revision=? AND status='connected' AND (${active.sql})${credential}`)
    .bind(catalog.fingerprint,now(),connectionId,principal.userId,connection.revision,...active.values,...(stored?[connectionId,principal.userId,stored.row.credential_version]:[])).run();
  if(result.meta.changes!==1)fail(409,'revision_conflict','Connection changed during discovery.');
  return catalog;
}
