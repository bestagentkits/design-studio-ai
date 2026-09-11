import type { Bindings } from '../types';
import { boundedConnectorJson, type ConnectorPrincipal } from '../../src/shared/connector-values';
import { connectorOperationPrepareSchema } from '../../src/shared/connector-operations';
import { prepareConnectorOperation, claimConnectorOperation, finishConnectorOperation, markConnectorOperationUncertain } from '../connector-operations';
import { ownedOperation, inspectOperationVersions, operationClockSql } from '../connector-operation-versions';
import { ApiError, fail } from '../security';
import { withMcpClient } from './mcp-client';
import { readMcpCatalog, type McpCatalogTool } from './mcp-catalog';
import { decodeMcpContent } from './mcp-content';
import { mcpBindingAuthority } from './mcp-resources';

export function selectedTool(tools: McpCatalogTool[], name: string) {
  const tool = tools.find(item => item.remoteName === name);
  if (!tool) return fail(409, 'schema_changed', 'The selected tool is no longer advertised.');
  if (!tool.schemaSupported) fail(422, 'unsupported_schema', 'The tool schema is outside the supported validation profile.');
  const { id, schemaSupported, ...descriptor } = tool;
  return descriptor;
}
export async function prepareMcpToolOperation(env: Bindings, principal: ConnectorPrincipal, projectId: string, input: unknown) {
  const value = connectorOperationPrepareSchema.parse(input);
  const auth = await mcpBindingAuthority(env, principal, value.bindingId, 'prepare_write', value.action, projectId);
  return withMcpClient(env, auth.connection, auth.credential, async scope => {
    await auth.recheck();
    const tool = selectedTool((await readMcpCatalog(scope)).tools, value.action);
    await auth.recheck();
    return prepareConnectorOperation(env, principal, value, tool);
  });
}

/** One low-level RPC per claimed operation. SDK convenience helpers must not replay a write. */
export async function executeMcpToolOperation(env: Bindings, principal: ConnectorPrincipal, projectId: string, operationId: string, expectedRevision: number, trustedGuard?: {sql:string;values:unknown[]}) {
  const row = await ownedOperation(env, principal.userId, operationId);
  if (row.project_id !== projectId) fail(404, 'operation_not_found', 'Operation not found in this project.');
  const auth = await mcpBindingAuthority(env, principal, row.binding_id, 'prepare_write', row.action, projectId);
  let lease: { revision: number; leaseId: string } | undefined;
  try { return await withMcpClient(env, auth.connection, auth.credential, async scope => {
    await auth.recheck();
    const descriptor = selectedTool((await readMcpCatalog(scope)).tools, row.action);
    await auth.recheck();
    const claimed = await claimConnectorOperation(env, principal, row.id, expectedRevision, descriptor);
    lease = {revision:claimed.operation.revision,leaseId:claimed.leaseId};
    const context = await inspectOperationVersions(env, principal, row.binding_id, claimed.operation.versions, descriptor.effect, descriptor.remoteName);
    await auth.recheck();
    const current = await env.DB.prepare(`SELECT 1 FROM connector_operations WHERE id=? AND user_id=? AND revision=? AND status='running'
      AND lease_id=? AND lease_expires_at>${operationClockSql} AND ${context.guard.sql}${trustedGuard ? ` AND (${trustedGuard.sql})` : ''}`)
      .bind(row.id, principal.userId, claimed.operation.revision, claimed.leaseId, ...context.guard.values, ...(trustedGuard?.values ?? [])).first();
    if (!current) fail(409, 'revision_conflict', 'Operation authorization changed before dispatch.');
    let outcome: unknown;
    try {
      const response = await scope.client.request({ method: 'tools/call', params: { name: row.action, arguments: claimed.arguments as Record<string, unknown>,...(claimed.dispatchContext?{requestState:claimed.dispatchContext.requestState,inputResponses:claimed.dispatchContext.inputResponses as Record<string,unknown>}: {}) } }, { ...scope.requestOptions, allowInputRequired: true });
      if (response.resultType === 'input_required') {
        // Persist opaque continuation as private data; only an explicit subsequent human action may resume it.
        outcome = {status:'failed',errorCode:'input_required',result:boundedConnectorJson(1048576).parse(response)};
      } else if ('isError' in response && response.isError) {
        let result:unknown;
        try{result=decodeMcpContent({...response,isError:false});}catch{/* Keep the explicit failure even when its explanatory content is unsupported. */}
        outcome = {status:'failed',errorCode:'remote_tool_error',...(result===undefined?{}:{result})};
      } else outcome = {status:'succeeded',result:decodeMcpContent(response)};
    } catch (error) {
      // A timeout, malformed result or connection failure cannot establish whether the remote write took effect.
      outcome = {status:'outcome_unknown',errorCode:error instanceof ApiError ? error.code : 'outcome_unknown'};
    }
    return finishConnectorOperation(env, principal, row.id, claimed.operation.revision, claimed.leaseId, outcome);
  }); } catch (error) {
    if (lease) await markConnectorOperationUncertain(env, principal.userId, row.id, lease.revision, lease.leaseId);
    throw error;
  }
}
