import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { connectorRevisionSchema } from '../../src/shared/connector-values';
import { connectionMetadata, ownedConnection, restartConnectionAuthorization } from '../connection-store';
import { readConnectorCredential, storeConnectorCredential } from '../connector-credentials';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { activePrincipalGuard, operationClockSql } from '../connector-principal-guard';
import { fail, now } from '../security';
import { withMcpClient } from './mcp-client';

async function human(env: Bindings, principal: ConnectorPrincipal) {
  if (principal.kind !== 'session') fail(403, 'human_action_required', 'A person must connect or reconnect this server.');
  await assertActiveConnectorPrincipal(env, principal);
}
/** Verify protocol access separately from catalog discovery and the first tool call. */
export async function activateMcpConnection(env: Bindings, principal: ConnectorPrincipal, connectionId: string, expectedRevision: number, credentialVersion?: number, grantedScopes: string[] = []) {
  await human(env, principal); connectorRevisionSchema.parse(expectedRevision);
  const scopes = z.array(z.string().min(1).max(300)).max(100).parse(grantedScopes);
  const connection = await ownedConnection(env, principal.userId, connectionId);
  if (connection.adapter !== 'mcp' || connection.revision !== expectedRevision || connection.status !== 'pending')
    fail(409, 'revision_conflict', 'Connection changed. Restart authorization.');
  const stored = connection.auth_mode === 'anonymous' ? undefined : await readConnectorCredential(env, principal.userId, connectionId);
  if (stored && (stored.row.credential_version !== credentialVersion || stored.row.refresh_lease_id || stored.row.expires_at !== null && stored.row.expires_at <= Date.now()))
    fail(409, 'needs_reauthorization', 'Connection credentials changed or expired.');
  const protocolVersion = await withMcpClient(env, connection, stored?.credential, async scope => scope.client.getNegotiatedProtocolVersion(), { profile: 'auto' });
  const active = activePrincipalGuard(env, principal);
  const credentialGuard = stored ? `AND EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id IS NULL AND (expires_at IS NULL OR expires_at>${operationClockSql}))` : '';
  const result = await env.DB.prepare(`UPDATE connections SET status='connected',revision=revision+1,remote_identity=NULL,scopes_json=?,updated_at=?
    WHERE id=? AND user_id=? AND revision=? AND status='pending' AND ${active.sql} ${credentialGuard}`)
    .bind(JSON.stringify(scopes), now(), connectionId, principal.userId, expectedRevision, ...active.values,
      ...(stored ? [connectionId, principal.userId, stored.row.credential_version] : [])).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection or credentials changed during verification.');
  return { connection: connectionMetadata(await ownedConnection(env, principal.userId, connectionId)), protocolVersion };
}

const bearer = z.string().min(1).max(16384).refine(value => !/[\r\n]/.test(value), 'Bearer credential contains invalid characters.');
/** Interactive anonymous/bearer setup; a newly verified credential never inherits an earlier grant. */
export async function connectMcpConnection(env: Bindings, principal: ConnectorPrincipal, connectionId: string, expectedRevision: number, accessToken?: string) {
  await human(env, principal); connectorRevisionSchema.parse(expectedRevision);
  const previous = await ownedConnection(env, principal.userId, connectionId);
  if (previous.adapter !== 'mcp' || previous.auth_mode === 'oauth') fail(400, 'invalid_auth_mode', 'Use the OAuth authorization flow for this connection.');
  if (previous.auth_mode === 'bearer') bearer.parse(accessToken);
  else if (accessToken !== undefined) fail(400, 'invalid_auth_mode', 'Anonymous connections do not accept credentials.');
  const pending = await restartConnectionAuthorization(env, principal.userId, connectionId, expectedRevision);
  if (previous.auth_mode === 'bearer') await storeConnectorCredential(env, principal.userId, connectionId, pending.revision,
    { accessToken: accessToken!, tokenType: 'Bearer', resource: previous.endpoint! }, null);
  return activateMcpConnection(env, principal, connectionId, pending.revision, previous.auth_mode === 'bearer' ? 1 : undefined);
}
