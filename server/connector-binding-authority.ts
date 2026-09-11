import type { Bindings } from './types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { authorizeConnectorBinding,type ConnectorCapability } from './connection-policy';
import { readConnectorCredential } from './connector-credentials';
import { canonicalConnectorJson } from './connector-fingerprints';
import { activePrincipalGuard } from './connector-principal-guard';
import { operationClockSql } from './connector-operation-versions';
import { fail } from './security';

export async function connectorBindingAuthority(env: Bindings, principal: ConnectorPrincipal, bindingId: string, capability: ConnectorCapability, uri?: string, projectId?: string, adapter:'mcp'|'github'|'google-drive'='mcp') {
  const auth = await authorizeConnectorBinding(env, principal, bindingId, capability, uri);
  if (auth.connection.adapter !== adapter || auth.selection.adapter !== adapter) fail(400, 'unsupported_protocol', 'The selected adapter does not match this binding.');
  if (projectId !== undefined && auth.binding.project_id !== projectId) fail(403, 'missing_grant', 'Source binding belongs to a different project.');
  const stored = auth.connection.auth_mode === 'anonymous' ? undefined : await readConnectorCredential(env, principal.userId, auth.connection.id);
  if (stored && (stored.connection.revision !== auth.connection.revision || stored.row.refresh_lease_id || stored.row.expires_at !== null && stored.row.expires_at <= Date.now()))
    fail(409, 'needs_reauthorization', 'Connection credentials changed or expired.');
  const active = activePrincipalGuard(env, principal);
  const guard = {
    sql: `EXISTS(SELECT 1 FROM project_connection_bindings b JOIN connections c ON c.id=b.connection_id AND c.user_id=b.user_id
      WHERE b.id=? AND b.user_id=? AND b.project_id=? AND b.policy_revision=? AND b.selection_json=? AND b.disabled_at IS NULL AND c.id=? AND c.revision=? AND c.status='connected') AND (${active.sql})`,
    values: [bindingId, principal.userId, auth.binding.project_id, auth.binding.policy_revision, auth.binding.selection_json, auth.connection.id, auth.connection.revision, ...active.values] as unknown[],
  };
  if (stored) {
    guard.sql += ` AND EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id IS NULL AND (expires_at IS NULL OR expires_at>${operationClockSql}))`;
    guard.values.push(auth.connection.id, principal.userId, stored.row.credential_version);
  }
  if (auth.grant) {
    guard.sql += ` AND EXISTS(SELECT 1 FROM connection_agent_grants WHERE id=? AND user_id=? AND connection_id=? AND project_id=? AND capabilities_json=? AND selection_json=? AND revoked_at IS NULL AND expires_at>${operationClockSql} AND policy_revision=?)`;
    guard.values.push(auth.grant.id, principal.userId, auth.connection.id, auth.binding.project_id, auth.grant.capabilities_json, auth.grant.selection_json, auth.binding.policy_revision);
  }
  const recheck = async () => {
    const current = await authorizeConnectorBinding(env, principal, bindingId, capability, uri);
    if (canonicalConnectorJson(current.selection) !== canonicalConnectorJson(auth.selection) || current.grant?.id !== auth.grant?.id ||
      !await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.values).first()) fail(409, 'revision_conflict', 'Source access changed during the remote request.');
  };
  return { ...auth, credential: stored?.credential, guard, recheck };
}
