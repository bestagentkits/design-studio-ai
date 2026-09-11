import { z } from 'zod';
import type { Context } from 'hono';
import type { Env } from '../types';
import { boundedConnectorJson, connectorRevisionSchema } from '../../src/shared/connector-values';
import { interactiveConnectionOwner } from '../connection-policy';
import { activePrincipalGuard } from '../connector-principal-guard';
import { ownedOperation, operationPrincipal, validateOperationTool } from '../connector-operation-versions';
import { readConnectorOperation } from '../connector-operation-reads';
import { prepareConnectorOperation } from '../connector-operations';
import { validateConnectorArguments } from '../connector-schema-validation';
import { mcpBindingAuthority } from './mcp-resources';
import { withMcpClient } from './mcp-client';
import { readMcpCatalog } from './mcp-catalog';
import { selectedTool } from './mcp-tools';
import { fail, now } from '../security';
export const mcpContinuationSchema=z.strictObject({expectedRevision:connectorRevisionSchema,inputResponses:boundedConnectorJson(16000)});
const pauseSchema=z.object({resultType:z.literal('input_required'),requestState:z.string().max(16000).optional(),inputRequests:z.record(z.string(),z.object({method:z.string(),params:z.record(z.string(),z.unknown()).optional()})).optional()});
const responseSchema=z.strictObject({action:z.enum(['accept','decline','cancel']),content:boundedConnectorJson(12000).optional()});
/** A person supplies responses; the server never fulfils sampling or roots requests implicitly. */
export async function prepareMcpContinuation(c:Context<Env>,projectId:string,operationId:string,input:unknown){
  const userId=interactiveConnectionOwner(c),human=c.get('principal')!,value=mcpContinuationSchema.parse(input);
  const parent=await ownedOperation(c.env,userId,operationId);
  if(parent.project_id!==projectId)fail(404,'operation_not_found','Operation not found.');
  if(parent.revision!==value.expectedRevision||parent.status!=='failed'||parent.error_code!=='input_required')fail(409,'revision_conflict','This operation is not waiting for input.');
  const detail=await readConnectorOperation(c.env,human,operationId);
  if(!detail.payloadAvailable)fail(409,'operation_payload_unavailable','The continuation has expired.');
  const pause=pauseSchema.parse(detail.result),responses=z.record(z.string(),responseSchema).parse(value.inputResponses),requests=pause.inputRequests??{};
  if(Object.keys(responses).length!==Object.keys(requests).length||Object.keys(responses).some(key=>!Object.hasOwn(requests,key)))fail(400,'invalid_input','Respond to exactly the requested input IDs.');
  for(const [key,request] of Object.entries(requests)){
    if(request.method!=='elicitation/create')fail(422,'unsupported_input','Sampling and roots requests cannot be fulfilled through this form.');
    const response=responses[key];
    if(response.action==='accept'&&request.params?.mode!=='url')validateConnectorArguments(request.params?.requestedSchema,response.content??{});
    if(response.action!=='accept'&&response.content!==undefined)fail(400,'invalid_input','Declined or cancelled input must not contain content.');
  }
  const ancestry=await c.env.DB.prepare(`WITH RECURSIVE ancestors(id,parent_operation_id,depth) AS (
    SELECT id,parent_operation_id,1 FROM connector_operations WHERE id=? AND user_id=? UNION ALL
    SELECT p.id,p.parent_operation_id,a.depth+1 FROM connector_operations p JOIN ancestors a ON p.id=a.parent_operation_id WHERE a.depth<12
  ) SELECT MAX(depth) AS depth FROM ancestors`).bind(parent.id,userId).first<{depth:number}>();
  if((ancestry?.depth??0)>=12)fail(429,'run_budget_exhausted','Continuation limit reached. Inspect the remote action before starting new work.');
  const actor=operationPrincipal(parent),auth=await mcpBindingAuthority(c.env,actor,parent.binding_id,'prepare_write',parent.action,projectId);
  const tool=await withMcpClient(c.env,auth.connection,auth.credential,async scope=>{await auth.recheck();return selectedTool((await readMcpCatalog(scope)).tools,parent.action);});
  await auth.recheck();
  if((await validateOperationTool(tool,detail.arguments)).fingerprint!==parent.action_fingerprint)fail(409,'schema_changed','The tool changed; this continuation cannot be resumed.');
  const humanGuard=activePrincipalGuard(c.env,human);
  const runBudget=await c.env.DB.prepare("SELECT tool_calls FROM agent_runs WHERE user_id=? AND project_id=? AND pending_operation_id=? AND status='awaiting_approval' AND tool_calls<12").bind(userId,projectId,parent.id).first<{tool_calls:number}>();
  if(runBudget&&runBudget.tool_calls>=12)fail(429,'run_budget_exhausted','The run has reached its tool-call budget.');
  humanGuard.sql+=" AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE user_id=? AND project_id=? AND pending_operation_id=? AND status='awaiting_approval' AND tool_calls>=12)";
  humanGuard.values.push(userId,projectId,parent.id);
  const operation=await prepareConnectorOperation(c.env,actor,{bindingId:parent.binding_id,action:parent.action,arguments:detail.arguments,expectedVersions:JSON.parse(parent.versions_json),idempotencyKey:`continue_${parent.id}`},tool,{
    context:{kind:'mcp-continuation',...(pause.requestState===undefined?{}:{requestState:pause.requestState}),inputResponses:responses},parentId:parent.id,parentRevision:parent.revision,guard:humanGuard,
  });
  // Link a paused run to this exact newly reviewed continuation; cancelled runs stay cancelled.
  await c.env.DB.prepare("UPDATE agent_runs SET pending_operation_id=?,tool_calls=tool_calls+1,revision=revision+1,updated_at=? WHERE user_id=? AND project_id=? AND pending_operation_id=? AND status='awaiting_approval' AND tool_calls<12")
    .bind(operation.id,now(),userId,projectId,parent.id).run();
  return operation;
}
