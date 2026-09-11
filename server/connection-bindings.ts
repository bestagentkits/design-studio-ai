import type { Context } from 'hono';
import type { Env } from './types';
import { connectionBindingCreateSchema, connectionGrantCreateSchema } from '../src/shared/connector-management';
import { projectConnectionBindingSchema, connectionAgentGrantSchema, connectorSelectionSchema } from '../src/shared/connectors';
import { connectorRevisionSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import { ownedConnection } from './connection-store';
import { ownedBinding, interactiveConnectionOwner, assertActiveConnectorPrincipal, principalColumns, type BindingRow } from './connection-policy';
import { fail, id, now } from './security';
import { canonicalConnectorJson } from './connector-fingerprints';

function metadata(row: BindingRow) {
  return projectConnectionBindingSchema.parse({ id: row.id, projectId: row.project_id, connectionId: row.connection_id,
    role: row.role, selection: JSON.parse(row.selection_json), policyRevision: row.policy_revision });
}
function selectionSubset(binding: ReturnType<typeof connectorSelectionSchema.parse>, grant: ReturnType<typeof connectorSelectionSchema.parse>) {
  if (binding.adapter === 'mcp' && grant.adapter === 'mcp') return grant.tools.every(item => binding.tools.includes(item)) && grant.resources.every(item => binding.resources.includes(item));
  if (binding.adapter === 'github' && grant.adapter === 'github') return binding.repositoryId === grant.repositoryId && binding.commit === grant.commit && grant.paths.every(item => binding.paths.includes(item));
  if (binding.adapter === 'google-drive' && grant.adapter === 'google-drive') return grant.fileIds.every(item => binding.fileIds.includes(item)) && (!grant.destinationFolderId || grant.destinationFolderId === binding.destinationFolderId);
  return false;
}
export async function createProjectConnectionBinding(c: Context<Env>, projectId: string, input: unknown) {
  const userId = interactiveConnectionOwner(c), value = connectionBindingCreateSchema.parse(input), connection = await ownedConnection(c.env, userId, value.connectionId);
  if (connection.status !== 'connected') fail(409, 'needs_reauthorization', 'Connect this account first.');
  if (connection.adapter !== value.selection.adapter) fail(400, 'invalid_selection', 'Selection does not match the connector.');
  const bindingId = id(), timestamp = now();
  const result = await c.env.DB.prepare(`INSERT INTO project_connection_bindings(id,user_id,project_id,connection_id,role,selection_json,policy_revision,created_at,updated_at)
    SELECT ?,user_id,id,?,?,?,1,?,? FROM projects WHERE id=? AND user_id=?
    AND EXISTS(SELECT 1 FROM connections WHERE id=? AND user_id=? AND revision=? AND status='connected')`)
    .bind(bindingId, connection.id, value.role, canonicalConnectorJson(value.selection), timestamp, timestamp, projectId, userId, connection.id, userId, connection.revision).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Project or connection changed. Reload before binding.');
  return metadata(await ownedBinding(c.env, userId, bindingId));
}
export async function grantConnectionAccess(c: Context<Env>, bindingId: string, input: unknown) {
  const userId = interactiveConnectionOwner(c), value = connectionGrantCreateSchema.parse(input), binding = await ownedBinding(c.env, userId, bindingId);
  if (binding.policy_revision !== value.expectedPolicyRevision) fail(409, 'revision_conflict', 'Project connection changed.');
  const selected = connectorSelectionSchema.parse(JSON.parse(binding.selection_json));
  if (!selectionSubset(selected, value.selection)) fail(400, 'invalid_selection', 'Grant selection must stay within this project binding.');
  const allowed = binding.role === 'source' ? ['discover','read_source','run'] : binding.role === 'destination' ? ['discover','prepare_write','run'] : ['discover','execute_read','prepare_write','run'];
  if (value.capabilities.some(capability => !allowed.includes(capability))) fail(400, 'invalid_capability', 'Grant capabilities must match the binding role.');
  const expiresAt = Date.parse(value.expiresAt), instant = Date.now();
  if (expiresAt <= instant || expiresAt > instant + 90 * 86400000) fail(400, 'invalid_expiry', 'Grant expiry must be within the next 90 days.');
  const grantId = id();
  const principal: ConnectorPrincipal = value.recipient.kind === 'api' ? { kind: 'api', userId, tokenId: value.recipient.tokenId }
    : value.recipient.kind === 'oauth' ? { kind: 'oauth', userId, clientId: value.recipient.clientId, familyId: value.recipient.familyId }
    : { kind: 'webmcp', userId, projectId: binding.project_id, grantId };
  if (principal.kind !== 'webmcp') await assertActiveConnectorPrincipal(c.env, principal);
  const identity = principalColumns(principal), timestamp = now();
  const result = await c.env.DB.prepare(`INSERT INTO connection_agent_grants(id,user_id,project_id,connection_id,principal_kind,principal_id,principal_client_id,policy_revision,capabilities_json,selection_json,created_at,expires_at)
    SELECT ?,user_id,project_id,connection_id,?,?,?,policy_revision,?,?,?,? FROM project_connection_bindings
    WHERE id=? AND user_id=? AND policy_revision=? AND disabled_at IS NULL
    AND EXISTS(SELECT 1 FROM connections c WHERE c.id=project_connection_bindings.connection_id AND c.user_id=project_connection_bindings.user_id AND c.status='connected')`)
    .bind(grantId, identity.kind, identity.id, identity.clientId, JSON.stringify(value.capabilities), canonicalConnectorJson(value.selection), timestamp, expiresAt, bindingId, userId, value.expectedPolicyRevision).run();
  if (result.meta.changes !== 1) fail(409, 'revision_conflict', 'Connection policy changed before access was granted.');
  return connectionAgentGrantSchema.parse({ id: grantId, projectId: binding.project_id, connectionId: binding.connection_id,
    principal, policyRevision: binding.policy_revision, capabilities: value.capabilities, selection: value.selection, expiresAt: value.expiresAt, revokedAt: null });
}
export async function revokeConnectionAccess(c: Context<Env>, bindingId: string, grantId: string) {
  const userId = interactiveConnectionOwner(c), binding = await ownedBinding(c.env, userId, bindingId);
  const result = await c.env.DB.prepare('UPDATE connection_agent_grants SET revoked_at=? WHERE id=? AND user_id=? AND project_id=? AND connection_id=? AND revoked_at IS NULL')
    .bind(now(), grantId, userId, binding.project_id, binding.connection_id).run();
  if (result.meta.changes !== 1) fail(404, 'grant_not_found', 'Active grant not found.');
}
export async function removeProjectConnectionBinding(c: Context<Env>, bindingId: string, expectedRevision: number) {
  const userId = interactiveConnectionOwner(c); connectorRevisionSchema.parse(expectedRevision);
  await ownedBinding(c.env, userId, bindingId);
  const timestamp = now(), guard = 'EXISTS(SELECT 1 FROM project_connection_bindings b WHERE b.id=? AND b.user_id=? AND b.policy_revision=? AND b.disabled_at IS NULL)';
  const guarded = (sql: string, values: unknown[]) => c.env.DB.prepare(sql).bind(...values, bindingId, userId, expectedRevision);
  const results = await c.env.DB.batch([
    guarded(`UPDATE connection_agent_grants SET revoked_at=? WHERE user_id=? AND (project_id,connection_id) IN(SELECT project_id,connection_id FROM project_connection_bindings WHERE id=?) AND revoked_at IS NULL AND ${guard}`, [timestamp,userId,bindingId]),
    guarded(`UPDATE connector_operations SET encrypted_arguments=NULL,status=CASE WHEN status='running' THEN 'outcome_unknown' WHEN status IN('pending','awaiting_approval') THEN 'cancelled' ELSE status END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?
      WHERE binding_id=? AND user_id=? AND ${guard}`, [timestamp,bindingId,userId]),
    guarded(`UPDATE agent_runs SET encrypted_payload=NULL,status=CASE WHEN status='running' THEN 'outcome_unknown' WHEN status IN('ready_to_continue','awaiting_approval','needs_reauthorization') THEN 'cancelled' ELSE status END,
      revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM json_each(agent_runs.pins_json) pin WHERE json_extract(pin.value,'$.bindingId')=?) AND ${guard}`, [timestamp,userId,bindingId]),
    guarded(`UPDATE run_steps SET encrypted_payload=NULL,status=CASE WHEN status='running' THEN 'outcome_unknown' WHEN status='pending' THEN 'cancelled' ELSE status END,
      revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE user_id=? AND run_id IN(SELECT r.id FROM agent_runs r,json_each(r.pins_json) pin WHERE r.user_id=? AND json_extract(pin.value,'$.bindingId')=?) AND ${guard}`, [timestamp,userId,userId,bindingId]),
    guarded(`DELETE FROM project_source_snapshots WHERE binding_id=? AND user_id=? AND ${guard}`, [bindingId,userId]),
    c.env.DB.prepare('UPDATE project_connection_bindings SET disabled_at=?,policy_revision=policy_revision+1,updated_at=? WHERE id=? AND user_id=? AND policy_revision=? AND disabled_at IS NULL')
      .bind(timestamp,timestamp,bindingId,userId,expectedRevision),
  ]) as {meta:{changes:number}}[];
  if (results.at(-1)?.meta.changes !== 1) fail(409, 'revision_conflict', 'Project connection changed before removal.');
}
