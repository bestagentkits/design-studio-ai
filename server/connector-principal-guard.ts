import type { Bindings } from './types';
import { connectorPrincipalSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import { fail } from './security';

function oauthResource(env: Bindings) {
  if (!env.APP_URL) return fail(503, 'connector_unconfigured', 'Set the canonical application URL for connector access.');
  try { return `${new URL(env.APP_URL).origin}/mcp`; }
  catch { return fail(503, 'connector_unconfigured', 'Application URL is invalid.'); }
}
export const operationClockSql = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export function activePrincipalGuard(env: Bindings, value: ConnectorPrincipal): { sql: string; values: unknown[] } {
  const principal = connectorPrincipalSchema.parse(value), instant = operationClockSql;
  if (principal.kind === 'session') return { sql: `EXISTS(SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires_at>${instant})`, values: [principal.sessionId, principal.userId] };
  if (principal.kind === 'api') return { sql: 'EXISTS(SELECT 1 FROM api_tokens WHERE id=? AND user_id=?)', values: [principal.tokenId, principal.userId] };
  if (principal.kind === 'oauth') return { sql: `EXISTS(SELECT 1 FROM oauth_tokens WHERE family=? AND client_id=? AND user_id=? AND kind='access' AND resource=? AND expires_at>${instant})`, values: [principal.familyId, principal.clientId, principal.userId, oauthResource(env)] };
  if (principal.kind === 'webmcp') return { sql: `EXISTS(SELECT 1 FROM connection_agent_grants WHERE id=? AND principal_kind='webmcp' AND principal_id=? AND user_id=? AND project_id=? AND revoked_at IS NULL AND expires_at>${instant})`, values: [principal.grantId, principal.grantId, principal.userId, principal.projectId] };
  return { sql: '0', values: [] };
}
