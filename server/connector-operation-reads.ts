import { operationArgumentsHash, dispatchContextSchema } from './connector-dispatch-context';
import type { Bindings } from './types';
import { boundedConnectorJson, connectorPrincipalSchema, type ConnectorPrincipal } from '../src/shared/connector-values';
import { connectorOperationPrepareSchema } from '../src/shared/connector-operations';
import { assertActiveConnectorPrincipal, authorizeConnectorBinding, principalColumns } from './connection-policy';
import { connectorOperationMetadata } from './connector-operations';
import { ownedOperation, sameOperationPrincipal, type OperationRow } from './connector-operation-versions';
import { connectorFingerprint } from './connector-fingerprints';
import { ApiError, decrypt, fail } from './security';

/** Read-only: inspecting an operation never claims, retries, or advances remote work. */
export async function readConnectorOperation(env: Bindings, actor: ConnectorPrincipal, operationId: string) {
  const principal = connectorPrincipalSchema.parse(actor);
  await assertActiveConnectorPrincipal(env, principal);
  const row = await ownedOperation(env, principal.userId, operationId);
  if (principal.kind !== 'session' && !sameOperationPrincipal(row, principal)) fail(403, 'missing_grant', 'This operation belongs to a different principal.');
  const operation = connectorOperationMetadata(row);
  let payloadAvailable = Boolean(row.encrypted_arguments);
  if (principal.kind !== 'session') {
    try {
      const auth = await authorizeConnectorBinding(env, principal, row.binding_id, row.effect === 'read' ? 'execute_read' : 'prepare_write', row.action);
      if (auth.binding.policy_revision !== operation.versions.policyRevision) payloadAvailable = false;
    } catch (error) {
      if (!(error instanceof ApiError && [403,404,409].includes(error.status))) throw error;
      payloadAvailable = false;
    }
  }
  if (row.payload_expires_at !== null && row.payload_expires_at <= Date.now()) payloadAvailable = false;
  if (!payloadAvailable) return { operation, bindingId: row.binding_id, payloadAvailable: false, arguments: null, result: null, description: null, destination: null };
  const decode = async (encrypted: string) => {
    const envelope = JSON.parse(await decrypt(env, encrypted));
    if (envelope.operationId !== row.id || envelope.userId !== row.user_id) fail(409, 'operation_payload_unavailable', 'Operation payload cannot be verified.');
    return envelope;
  };
  const storedArguments = await decode(row.encrypted_arguments!);
  const args = connectorOperationPrepareSchema.shape.arguments.parse(storedArguments.arguments);
  const dispatchContext=storedArguments.dispatchContext===undefined?undefined:dispatchContextSchema.parse(storedArguments.dispatchContext);
  if (storedArguments.bindingId !== row.binding_id || await operationArgumentsHash(args,dispatchContext) !== row.arguments_hash)
    fail(409, 'operation_payload_unavailable', 'Operation arguments cannot be verified.');
  const result = row.encrypted_result ? boundedConnectorJson(1048576).parse((await decode(row.encrypted_result)).result) : null;
  // Session/token revocation while decrypting must not release private content.
  await assertActiveConnectorPrincipal(env, principal);
  const current = await ownedOperation(env, principal.userId, operationId);
  if (current.revision !== row.revision || current.encrypted_arguments !== row.encrypted_arguments || current.encrypted_result !== row.encrypted_result)
    fail(409, 'revision_conflict', 'Operation changed while reading its payload.');
  if (principal.kind !== 'session') {
    const auth = await authorizeConnectorBinding(env, principal, row.binding_id, row.effect === 'read' ? 'execute_read' : 'prepare_write', row.action);
    if (auth.binding.policy_revision !== operation.versions.policyRevision)
      fail(409, 'revision_conflict', 'Connection policy changed while reading the payload.');
  }
  return { operation, bindingId: row.binding_id, payloadAvailable: true, arguments: args, continuation:dispatchContext??null, result, description: storedArguments.description ?? null, destination: storedArguments.destination ?? null };
}

export async function listConnectorOperations(env: Bindings, actor: ConnectorPrincipal, projectId: string) {
  const principal = connectorPrincipalSchema.parse(actor);
  await assertActiveConnectorPrincipal(env, principal);
  if (!await env.DB.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').bind(projectId,principal.userId).first()) fail(404,'not_found','Project not found.');
  const identity = principalColumns(principal);
  const columns = 'id,user_id,project_id,connection_id,binding_id,principal_kind,principal_id,principal_client_id,idempotency_key,revision,status,action,effect,arguments_hash,action_fingerprint,destination_hash,versions_json,approval_id,lease_id,lease_expires_at,remote_ids_json,error_code,created_at,updated_at,payload_expires_at';
  const filter = principal.kind === 'session' ? '' : ' AND principal_kind=? AND principal_id=? AND principal_client_id IS ?';
  const rows = await env.DB.prepare(`SELECT ${columns} FROM connector_operations WHERE user_id=? AND project_id=?${filter} ORDER BY created_at DESC,id DESC LIMIT 51`)
    .bind(principal.userId,projectId,...(principal.kind==='session'?[]:[identity.kind,identity.id,identity.clientId])).all<OperationRow>();
  return {operations:rows.results.slice(0,50).map(connectorOperationMetadata),truncated:rows.results.length>50};
}
