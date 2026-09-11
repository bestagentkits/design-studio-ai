import { activePrincipalGuard } from './connector-principal-guard';
import type { Context } from 'hono';
import type { Bindings, Env } from './types';
import { connectorPrincipalSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import { connectorSelectionSchema } from '../src/shared/connectors';
import { fail, owner } from './security';
import { ownedConnection } from './connection-store';

export type ConnectorCapability = 'discover' | 'read_source' | 'execute_read' | 'prepare_write' | 'run';
export interface BindingRow {
  id: string; user_id: string; project_id: string; connection_id: string;
  role: 'source' | 'tool' | 'destination'; disabled_at: string | null; selection_json: string; policy_revision: number;
}
export function principalColumns(value: ConnectorPrincipal) {
  const principal = connectorPrincipalSchema.parse(value);
  const principalId = principal.kind === 'session' ? principal.sessionId : principal.kind === 'api' ? principal.tokenId
    : principal.kind === 'oauth' ? principal.familyId : principal.kind === 'webmcp' ? principal.grantId : principal.runId;
  return { kind: principal.kind, id: principalId, clientId: principal.kind === 'oauth' ? principal.clientId : null };
}
export function interactiveConnectionOwner(c: Context<Env>) {
  const userId = owner(c);
  if (c.get('principal')?.kind !== 'session' || c.req.header('X-Studio-Client') === 'webmcp')
    fail(403, 'human_action_required', 'Open connection settings in Studio to manage access.');
  return userId;
}
export function requestConnectorPrincipal(c: Context<Env>, projectId: string): ConnectorPrincipal {
  owner(c);
  const principal = c.get('principal');
  if (!principal) return fail(401, 'unauthorized', 'Sign in or supply an API token.');
  if (c.req.header('X-Studio-Client') !== 'webmcp') return principal;
  if (principal.kind !== 'session') return fail(403, 'missing_grant', 'WebMCP requires a signed-in project grant.');
  const grantId = c.req.header('X-Studio-Connector-Grant');
  if (!grantId) return fail(403, 'missing_grant', 'Enable agent access for this project in Studio.');
  // A header can select an existing grant; it cannot create one or authorize a different owner.
  return connectorPrincipalSchema.parse({ kind: 'webmcp', userId: principal.userId, projectId, grantId });
}
export async function assertActiveConnectorPrincipal(env: Bindings, principal: ConnectorPrincipal) {
  const guard = activePrincipalGuard(env, principal);
  const exists = await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.values).first();
  if (!exists) fail(403, 'missing_grant', 'This authentication or agent grant is no longer active.');
}
export async function ownedBinding(env: Bindings, userId: string, bindingId: string) {
  return await env.DB.prepare('SELECT * FROM project_connection_bindings WHERE id=? AND user_id=? AND disabled_at IS NULL').bind(bindingId, userId).first<BindingRow>()
    ?? fail(404, 'binding_not_found', 'Project connection not found.');
}
type Selection = ReturnType<typeof connectorSelectionSchema.parse>;
function intersectSelection(binding: Selection, grant: Selection): Selection | null {
  if (binding.adapter === 'mcp' && grant.adapter === 'mcp') return { adapter: 'mcp', tools: binding.tools.filter(value => grant.tools.includes(value)), resources: binding.resources.filter(value => grant.resources.includes(value)) };
  if (binding.adapter === 'github' && grant.adapter === 'github' && binding.repositoryId === grant.repositoryId && binding.commit === grant.commit) {
    const paths = binding.paths.filter(value => grant.paths.includes(value));
    return paths.length ? { ...binding, paths } : null;
  }
  if (binding.adapter === 'google-drive' && grant.adapter === 'google-drive') return { adapter: 'google-drive', fileIds: binding.fileIds.filter(value => grant.fileIds.includes(value)),
    ...(binding.destinationFolderId && binding.destinationFolderId === grant.destinationFolderId ? { destinationFolderId: binding.destinationFolderId } : {}) };
  return null;
}
function permits(selection: Selection, capability: ConnectorCapability, action?: string) {
  if (!action) return selection.adapter !== 'mcp' || capability === 'discover' || capability === 'run';
  if (selection.adapter === 'mcp') {
    if (capability === 'read_source') return selection.resources.includes(action);
    if (capability === 'execute_read' || capability === 'prepare_write') return selection.tools.includes(action);
    return selection.tools.includes(action) || selection.resources.includes(action);
  }
  // The adapter receives only the intersected selection, never the broader project binding.
  return true;
}
export async function authorizeConnectorBinding(env: Bindings, principal: ConnectorPrincipal, bindingId: string, capability: ConnectorCapability, action?: string) {
  await assertActiveConnectorPrincipal(env, principal);
  const binding = await ownedBinding(env, principal.userId, bindingId);
  const roles: Record<ConnectorCapability, BindingRow['role'][]> = { discover: ['source','tool','destination'], read_source: ['source'], execute_read: ['tool'], prepare_write: ['tool','destination'], run: ['source','tool','destination'] };
  if (!roles[capability].includes(binding.role)) fail(403, 'missing_grant', 'Project connection role does not permit this action.');
  const connection = await ownedConnection(env, principal.userId, binding.connection_id);
  if (connection.status !== 'connected') fail(409, connection.status === 'disconnected' ? 'connection_revoked' : 'needs_reauthorization', 'Connect this account before using its resources.');
  const selection = connectorSelectionSchema.parse(JSON.parse(binding.selection_json));
  if (selection.adapter !== connection.adapter || !permits(selection, capability, action)) fail(403, 'missing_grant', 'Resource is not enabled for this project.');
  if (principal.kind === 'session') return { binding, connection, selection, grant: null };
  if ((principal.kind === 'run' || principal.kind === 'webmcp') && principal.projectId !== binding.project_id) fail(403, 'missing_grant', 'Agent access belongs to a different project.');
  if (principal.kind === 'run') return fail(403, 'missing_grant', 'Internal runs must recheck their originating principal and pinned policy before dispatch.');
  const identity = principalColumns(principal);
  const { results } = await env.DB.prepare(`SELECT id,capabilities_json,selection_json FROM connection_agent_grants WHERE user_id=? AND project_id=? AND connection_id=?
    AND principal_kind=? AND principal_id=? AND principal_client_id IS ? AND policy_revision=? AND revoked_at IS NULL AND expires_at>?`)
    .bind(principal.userId, binding.project_id, binding.connection_id, identity.kind, identity.id, identity.clientId, binding.policy_revision, Date.now())
    .all<{ id: string; capabilities_json: string; selection_json: string }>();
  for (const grant of results) {
    if (principal.kind === 'webmcp' && grant.id !== principal.grantId) continue;
    if (!(JSON.parse(grant.capabilities_json) as string[]).includes(capability)) continue;
    const permitted = intersectSelection(selection, connectorSelectionSchema.parse(JSON.parse(grant.selection_json)));
    if (permitted && permits(permitted, capability, action)) return { binding, connection, selection: permitted, grant };
  }
  return fail(403, 'missing_grant', 'Ask the project owner to grant this agent access in Studio.');
}
