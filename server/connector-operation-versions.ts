import { activePrincipalGuard, operationClockSql } from './connector-principal-guard';
export { activePrincipalGuard, operationClockSql } from './connector-principal-guard';
import { ConnectorSchemaError, validateConnectorArguments } from './connector-schema-validation';
import { connectorToolSchema, type ConnectorTool } from '../src/shared/connectors';
import { connectorVersionPinsSchema, type ConnectorOperationStatus } from '../src/shared/connector-operations';
import { connectorPrincipalSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import { authorizeConnectorBinding, principalColumns } from './connection-policy';
import { canonicalConnectorJson, connectorFingerprint } from './connector-fingerprints';
import { fail } from './security';
import type { Bindings } from './types';

export interface OperationRow {
  id: string; user_id: string; project_id: string; connection_id: string; binding_id: string;
  principal_kind: ConnectorPrincipal['kind']; principal_id: string; principal_client_id: string | null;
  idempotency_key: string; revision: number; status: ConnectorOperationStatus;
  action: string; effect: ConnectorTool['effect']; arguments_hash: string; action_fingerprint: string;
  destination_hash: string; versions_json: string; encrypted_arguments: string | null; approval_id: string | null;
  lease_id: string | null; lease_expires_at: number | null; remote_ids_json: string; created_at: string; updated_at: string;
}
export function operationPrincipal(row: OperationRow): ConnectorPrincipal {
  const fields = row.principal_kind === 'session' ? { sessionId: row.principal_id } : row.principal_kind === 'api' ? { tokenId: row.principal_id }
    : row.principal_kind === 'oauth' ? { familyId: row.principal_id, clientId: row.principal_client_id }
    : row.principal_kind === 'webmcp' ? { projectId: row.project_id, grantId: row.principal_id } : { projectId: row.project_id, runId: row.principal_id };
  return connectorPrincipalSchema.parse({ kind: row.principal_kind, userId: row.user_id, ...fields });
}
export function sameOperationPrincipal(row: OperationRow, principal: ConnectorPrincipal) {
  return row.user_id === principal.userId && canonicalConnectorJson(principalColumns(operationPrincipal(row))) === canonicalConnectorJson(principalColumns(principal))
    && (!('projectId' in principal) || principal.projectId === row.project_id);
}
export async function ownedOperation(env: Bindings, userId: string, operationId: string) {
  return await env.DB.prepare('SELECT * FROM connector_operations WHERE id=? AND user_id=?').bind(operationId, userId).first<OperationRow>()
    ?? fail(404, 'operation_not_found', 'Operation not found.');
}
export async function inspectOperationVersions(env: Bindings, principal: ConnectorPrincipal, bindingId: string, inputPins: unknown, effect: ConnectorTool['effect'], action: string) {
  const pins = connectorVersionPinsSchema.parse(inputPins);
  if (new Set(pins.sourceSnapshotIds).size !== pins.sourceSnapshotIds.length) fail(400, 'invalid_input', 'Source snapshot pins must be unique.');
  const authorized = await authorizeConnectorBinding(env, principal, bindingId, effect === 'read' ? 'execute_read' : 'prepare_write', action);
  const { binding, connection } = authorized;
  const project = await env.DB.prepare('SELECT revision FROM projects WHERE id=? AND user_id=?').bind(binding.project_id, principal.userId).first<{ revision: number }>();
  const brief = await env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(binding.project_id, principal.userId).first<{ revision: number }>();
  const credential = await env.DB.prepare('SELECT credential_version,expires_at,refresh_lease_id FROM connection_credentials WHERE connection_id=? AND user_id=?')
    .bind(connection.id, principal.userId).first<{ credential_version: number; expires_at: number | null; refresh_lease_id: string | null }>();
  if (connection.auth_mode !== 'anonymous' && (!credential || (credential.expires_at !== null && credential.expires_at <= Date.now()) || credential.refresh_lease_id)) fail(409, 'needs_reauthorization', 'Credentials are unavailable, expired or being refreshed.');
  if (!project || project.revision !== pins.documentRevision || (brief?.revision ?? 0) !== pins.briefRevision || connection.revision !== pins.connectionRevision
    || binding.policy_revision !== pins.policyRevision || (connection.auth_mode === 'anonymous' ? 1 : credential!.credential_version) !== pins.credentialVersion)
    fail(409, 'revision_conflict', 'Project, source policy or connection changed. Prepare a new operation.');
  const snapshots = await env.DB.prepare('SELECT id,status FROM project_source_snapshots WHERE user_id=? AND project_id=? AND id IN(SELECT value FROM json_each(?))')
    .bind(principal.userId, binding.project_id, JSON.stringify(pins.sourceSnapshotIds)).all<{ id: string; status: string }>();
  if (snapshots.results.length !== pins.sourceSnapshotIds.length) fail(409, 'revision_conflict', 'A pinned source is unavailable in this project.');
  const checks: string[] = [], values: unknown[] = [];
  const add = (sql: string, args: unknown[]) => { checks.push(sql); values.push(...args); };
  const active = activePrincipalGuard(env, principal); add(active.sql, active.values);
  add('EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND revision=?)', [binding.project_id, principal.userId, pins.documentRevision]);
  add('COALESCE((SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?),0)=?', [binding.project_id, principal.userId, pins.briefRevision]);
  add("EXISTS(SELECT 1 FROM connections WHERE id=? AND user_id=? AND status='connected' AND revision=? AND endpoint IS ? AND auth_mode=? AND remote_identity IS ?)", [connection.id, principal.userId, pins.connectionRevision, connection.endpoint, connection.auth_mode, connection.remote_identity]);
  add('EXISTS(SELECT 1 FROM project_connection_bindings WHERE id=? AND user_id=? AND project_id=? AND connection_id=? AND policy_revision=? AND disabled_at IS NULL AND role=? AND selection_json=?)', [binding.id, principal.userId, binding.project_id, connection.id, pins.policyRevision, binding.role, binding.selection_json]);
  if (connection.auth_mode !== 'anonymous') add(`EXISTS(SELECT 1 FROM connection_credentials WHERE connection_id=? AND user_id=? AND credential_version=? AND refresh_lease_id IS NULL AND (expires_at IS NULL OR expires_at>${operationClockSql}))`, [connection.id, principal.userId, pins.credentialVersion]);
  add('NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM project_source_snapshots WHERE id=wanted.value AND user_id=? AND project_id=?))', [JSON.stringify(pins.sourceSnapshotIds), principal.userId, binding.project_id]);
  add("NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM project_source_snapshots WHERE id=json_extract(expected.value,'$.id') AND status=json_extract(expected.value,'$.status') AND user_id=? AND project_id=?))", [JSON.stringify(snapshots.results), principal.userId, binding.project_id]);
  if (principal.kind !== 'session') {
    const grant = authorized.grant;
    if (!grant) fail(403, 'missing_grant', 'Exact agent authorization is unavailable.');
    const identity = principalColumns(principal);
    add(`EXISTS(SELECT 1 FROM connection_agent_grants WHERE id=? AND user_id=? AND project_id=? AND connection_id=? AND principal_kind=? AND principal_id=? AND principal_client_id IS ? AND policy_revision=? AND revoked_at IS NULL AND expires_at>${operationClockSql} AND capabilities_json=? AND selection_json=?)`,
      [grant.id, principal.userId, binding.project_id, connection.id, identity.kind, identity.id, identity.clientId, pins.policyRevision, grant.capabilities_json, grant.selection_json]);
  }
  const destinationHash = await connectorFingerprint({ adapter: connection.adapter, endpoint: connection.endpoint, remoteIdentity: connection.remote_identity, bindingId: binding.id, role: binding.role, selection: authorized.selection });
  return { ...authorized, pins, destinationHash, guard: { sql: checks.map(check => `(${check})`).join(' AND '), values } };
}
export async function validateOperationTool(input: ConnectorTool, args: unknown) {
  const tool = connectorToolSchema.parse(input);
  try { validateConnectorArguments(tool.inputSchema, args); }
  catch (error) {
    if (error instanceof ConnectorSchemaError && error.code === 'invalid_tool_arguments') fail(400, 'invalid_tool_arguments', error.message);
    if (error instanceof ConnectorSchemaError && error.code === 'schema_budget_exceeded') fail(413, 'limit_exceeded', 'Tool schema validation exceeds the execution budget.');
    fail(409, 'schema_changed', 'This tool schema contains unsupported constraints. Choose a supported tool.');
  }
  return { tool, fingerprint: await connectorFingerprint({ fingerprint: tool.fingerprint, name: tool.remoteName, effect: tool.effect, schema: tool.inputSchema }) };
}
