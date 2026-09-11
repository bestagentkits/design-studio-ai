import type { Context } from 'hono';
import { z } from 'zod';
import type { Bindings, Env } from './types';
import { connectorOperationPrepareSchema, connectorOperationSchema } from '../src/shared/connector-operations';
import { connectorPrincipalSchema, connectorRevisionSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import type { ConnectorTool } from '../src/shared/connectors';
import { assertActiveConnectorPrincipal, interactiveConnectionOwner, principalColumns } from './connection-policy';
import { canonicalConnectorJson, connectorFingerprint } from './connector-fingerprints';
import { activePrincipalGuard, inspectOperationVersions, operationClockSql, operationPrincipal, ownedOperation, sameOperationPrincipal, validateOperationTool, type OperationRow } from './connector-operation-versions';
import { decrypt, encrypt, fail, id, now } from './security';

const retentionMs = 7 * 86400000;
const metadata = (row: OperationRow) => connectorOperationSchema.parse({
  id: row.id, projectId: row.project_id, connectionId: row.connection_id, principal: operationPrincipal(row), revision: row.revision,
  status: row.status, action: row.action, effect: row.effect, argumentsHash: row.arguments_hash, actionFingerprint: row.action_fingerprint,
  destinationHash: row.destination_hash, versions: JSON.parse(row.versions_json), approvalId: row.approval_id,
  leaseId: row.lease_id, leaseExpiresAt: row.lease_expires_at === null ? null : new Date(row.lease_expires_at).toISOString(),
  remoteIds: JSON.parse(row.remote_ids_json), createdAt: row.created_at, updatedAt: row.updated_at,
});
const conflict = () => fail(409, 'revision_conflict', 'Operation or its authorization changed. Reload and prepare again.');
const changes = (result: unknown) => (result as { meta: { changes: number } }).meta.changes;
async function actorOperation(env: Bindings, input: ConnectorPrincipal, operationId: string, allowOwner = false) {
  const principal = connectorPrincipalSchema.parse(input);
  await assertActiveConnectorPrincipal(env, principal);
  const row = await ownedOperation(env, principal.userId, operationId);
  if (!sameOperationPrincipal(row, principal) && !(allowOwner && principal.kind === 'session')) fail(403, 'missing_grant', 'This operation belongs to a different principal.');
  return { row, principal };
}
async function inspectRow(env: Bindings, row: OperationRow) {
  const context = await inspectOperationVersions(env, operationPrincipal(row), row.binding_id, JSON.parse(row.versions_json), row.effect, row.action);
  if (context.destinationHash !== row.destination_hash) conflict();
  return context;
}

/** The adapter supplies the trusted tool descriptor; request input cannot choose effect or approve itself. */
export async function prepareConnectorOperation(env: Bindings, actor: ConnectorPrincipal, input: unknown, descriptor: ConnectorTool) {
  const principal = connectorPrincipalSchema.parse(actor), value = connectorOperationPrepareSchema.parse(input);
  const { tool, fingerprint } = await validateOperationTool(descriptor, value.arguments);
  if (value.action !== tool.remoteName) fail(409, 'schema_changed', 'Selected action changed.');
  const context = await inspectOperationVersions(env, principal, value.bindingId, value.expectedVersions, tool.effect, tool.remoteName);
  if (tool.connectionId !== context.connection.id) fail(409, 'schema_changed', 'Selected action belongs to another connection.');
  const operationId = id(), timestamp = now(), identity = principalColumns(principal), argsHash = await connectorFingerprint(value.arguments);
  const versions = canonicalConnectorJson(context.pins);
  const encrypted = await encrypt(env, canonicalConnectorJson({ operationId, userId: principal.userId, bindingId: value.bindingId, arguments: value.arguments }));
  await env.DB.prepare(`INSERT INTO connector_operations(id,user_id,project_id,connection_id,binding_id,principal_kind,principal_id,principal_client_id,idempotency_key,status,action,effect,arguments_hash,action_fingerprint,destination_hash,versions_json,encrypted_arguments,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql} ON CONFLICT DO NOTHING`)
    .bind(operationId, principal.userId, context.binding.project_id, context.connection.id, value.bindingId, identity.kind, identity.id, identity.clientId, value.idempotencyKey,
      tool.effect === 'read' ? 'pending' : 'awaiting_approval', value.action, tool.effect, argsHash, fingerprint, context.destinationHash, versions, encrypted, timestamp, timestamp, ...context.guard.values).run();
  const stored = await env.DB.prepare(`SELECT * FROM connector_operations WHERE user_id=? AND project_id=? AND principal_kind=? AND principal_id=? AND principal_client_id IS ? AND idempotency_key=?`)
    .bind(principal.userId, context.binding.project_id, identity.kind, identity.id, identity.clientId, value.idempotencyKey).first<OperationRow>();
  if (!stored) return conflict();
  if (stored.binding_id !== value.bindingId || stored.action !== value.action || stored.effect !== tool.effect || stored.arguments_hash !== argsHash || stored.action_fingerprint !== fingerprint || stored.destination_hash !== context.destinationHash || stored.versions_json !== versions)
    fail(409, 'idempotency_conflict', 'This idempotency key already identifies different operation content.');
  return metadata(stored);
}

/** Human consent is bound to the stored operation, not caller-supplied hashes or approval flags. */
export async function decideConnectorOperation(c: Context<Env>, operationId: string, expectedRevision: number, decision: 'approve' | 'deny') {
  const userId = interactiveConnectionOwner(c), principal = c.get('principal')!;
  await assertActiveConnectorPrincipal(c.env, principal);
  connectorRevisionSchema.parse(expectedRevision); z.enum(['approve', 'deny']).parse(decision);
  const row = await ownedOperation(c.env, userId, operationId), human = activePrincipalGuard(c.env, principal);
  if (row.revision !== expectedRevision || !['pending', 'awaiting_approval'].includes(row.status)) return conflict();
  if (decision === 'deny') {
    const result = await c.env.DB.prepare(`UPDATE connector_operations SET status='cancelled',revision=revision+1,updated_at=?,payload_expires_at=? WHERE id=? AND user_id=? AND revision=? AND status IN('pending','awaiting_approval') AND ${human.sql}`)
      .bind(now(), Date.now() + retentionMs, row.id, userId, expectedRevision, ...human.values).run();
    if (changes(result) !== 1) return conflict();
  } else {
    if (row.status !== 'awaiting_approval' || row.effect === 'read') return conflict();
    const context = await inspectRow(c.env, row), approvalId = id(), timestamp = now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO connector_approvals(id,operation_id,user_id,arguments_hash,action_fingerprint,destination_hash,versions_json,created_at,expires_at)
        SELECT ?,id,user_id,arguments_hash,action_fingerprint,destination_hash,versions_json,?,? FROM connector_operations
        WHERE id=? AND user_id=? AND revision=? AND status='awaiting_approval' AND ${context.guard.sql} AND ${human.sql}`)
        .bind(approvalId, timestamp, Date.now() + 600000, row.id, userId, expectedRevision, ...context.guard.values, ...human.values),
      c.env.DB.prepare(`UPDATE connector_operations SET approval_id=?,status='pending',revision=revision+1,updated_at=?
        WHERE id=? AND user_id=? AND revision=? AND status='awaiting_approval' AND EXISTS(SELECT 1 FROM connector_approvals WHERE id=? AND operation_id=connector_operations.id AND user_id=connector_operations.user_id)`)
        .bind(approvalId, timestamp, row.id, userId, expectedRevision, approvalId),
    ]);
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) return conflict();
  }
  return metadata(await ownedOperation(c.env, userId, row.id));
}

export async function claimConnectorOperation(env: Bindings, actor: ConnectorPrincipal, operationId: string, expectedRevision: number, descriptor: ConnectorTool) {
  connectorRevisionSchema.parse(expectedRevision);
  const { row } = await actorOperation(env, actor, operationId);
  if (row.revision !== expectedRevision || row.status !== 'pending') fail(409, row.status === 'awaiting_approval' ? 'approval_required' : 'revision_conflict', 'Operation is not ready to claim.');
  const context = await inspectRow(env, row);
  let args: unknown;
  try {
    const envelope = JSON.parse(await decrypt(env, row.encrypted_arguments ?? ''));
    if (envelope.operationId !== row.id || envelope.userId !== row.user_id || envelope.bindingId !== row.binding_id) throw new Error('Mismatched arguments');
    args = connectorOperationPrepareSchema.shape.arguments.parse(envelope.arguments);
    if (await connectorFingerprint(args) !== row.arguments_hash) throw new Error('Mismatched arguments');
  } catch { return fail(409, 'operation_payload_unavailable', 'Stored operation arguments cannot be used. Prepare a new operation.'); }
  const { tool, fingerprint } = await validateOperationTool(descriptor, args);
  if (tool.connectionId !== row.connection_id || tool.remoteName !== row.action || tool.effect !== row.effect || fingerprint !== row.action_fingerprint) fail(409, 'schema_changed', 'Tool definition changed. Prepare a new operation.');
  const leaseId = id(), timestamp = now();
  const approvalGuard = `EXISTS(SELECT 1 FROM connector_approvals a WHERE a.id=connector_operations.approval_id AND a.operation_id=connector_operations.id AND a.user_id=connector_operations.user_id AND a.consumed_at IS NULL AND a.expires_at>${operationClockSql} AND a.arguments_hash=connector_operations.arguments_hash AND a.action_fingerprint=connector_operations.action_fingerprint AND a.destination_hash=connector_operations.destination_hash AND a.versions_json=connector_operations.versions_json)`;
  const statements = [env.DB.prepare(`UPDATE connector_operations SET status='running',revision=revision+1,lease_id=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND user_id=? AND revision=? AND status='pending' AND ${context.guard.sql} AND (effect='read' OR ${approvalGuard})`)
    .bind(leaseId, Date.now() + 30000, timestamp, row.id, row.user_id, expectedRevision, ...context.guard.values)];
  if (row.effect !== 'read') statements.push(env.DB.prepare(`UPDATE connector_approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL
    AND EXISTS(SELECT 1 FROM connector_operations WHERE id=? AND user_id=? AND status='running' AND lease_id=? AND approval_id=connector_approvals.id)`)
    .bind(timestamp, row.approval_id, row.id, row.user_id, leaseId));
  const results = await env.DB.batch(statements);
  if (changes(results[0]) !== 1 || (row.effect !== 'read' && changes(results[1]) !== 1)) return conflict();
  // Dispatcher must use this restricted selection and recheck immediately before any external call.
  const claimed = await ownedOperation(env, row.user_id, row.id);
  if (claimed.status !== 'running' || claimed.lease_id !== leaseId) return conflict();
  return { operation: metadata(claimed), arguments: args, selection: context.selection, leaseId };
}

const finishSchema = z.strictObject({ status: z.enum(['succeeded', 'failed', 'outcome_unknown']), remoteIds: z.array(z.string().min(1).max(1024)).max(100).default([]), errorCode: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).optional() });
export async function finishConnectorOperation(env: Bindings, actor: ConnectorPrincipal, operationId: string, expectedRevision: number, leaseId: string, input: unknown) {
  connectorRevisionSchema.parse(expectedRevision); const value = finishSchema.parse(input);
  const { row } = await actorOperation(env, actor, operationId);
  if (row.revision !== expectedRevision || row.status !== 'running' || row.lease_id !== leaseId) return conflict();
  const context = await inspectRow(env, row);
  const result = await env.DB.prepare(`UPDATE connector_operations SET status=?,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,remote_ids_json=?,error_code=?,updated_at=?,payload_expires_at=?
    WHERE id=? AND user_id=? AND revision=? AND status='running' AND lease_id=? AND lease_expires_at>${operationClockSql} AND ${context.guard.sql}`)
    .bind(value.status, JSON.stringify(value.remoteIds), value.errorCode ?? null, now(), Date.now() + retentionMs, row.id, row.user_id, expectedRevision, leaseId, ...context.guard.values).run();
  if (changes(result) !== 1) return conflict();
  return metadata(await ownedOperation(env, row.user_id, row.id));
}

export async function cancelConnectorOperation(env: Bindings, actor: ConnectorPrincipal, operationId: string, expectedRevision: number) {
  connectorRevisionSchema.parse(expectedRevision);
  const { row, principal } = await actorOperation(env, actor, operationId, true), active = activePrincipalGuard(env, principal);
  const result = await env.DB.prepare(`UPDATE connector_operations SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE id=? AND user_id=? AND revision=? AND status IN('pending','awaiting_approval','running') AND ${active.sql}`)
    .bind(now(), Date.now() + retentionMs, row.id, row.user_id, expectedRevision, ...active.values).run();
  if (changes(result) !== 1) return conflict();
  return metadata(await ownedOperation(env, row.user_id, row.id));
}

/** Maintenance-only recovery never retries an external call whose outcome may have been lost. */
export async function recoverExpiredConnectorOperations(env: Bindings, userId: string) {
  const result = await env.DB.prepare(`UPDATE connector_operations SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,error_code='outcome_unknown',updated_at=?,payload_expires_at=?
    WHERE user_id=? AND status='running' AND lease_expires_at<=${operationClockSql}`)
    .bind(now(), Date.now() + retentionMs, userId).run();
  return changes(result);
}
