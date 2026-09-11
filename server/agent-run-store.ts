import type { Bindings } from './types';
import { agentRunSchema, type AgentRun } from '../src/shared/agent-runs';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { boundedConnectorJson } from '../src/shared/connector-values';
import { principalColumns, assertActiveConnectorPrincipal } from './connection-policy';
import { activePrincipalGuard, operationClockSql } from './connector-principal-guard';
import { canonicalConnectorJson } from './connector-fingerprints';
import { encrypt, decrypt, fail, now, id } from './security';
import type { ModelExchange, ModelTool, ModelCall } from './provider-tool-messages';
import type { ConnectorTool } from '../src/shared/connectors';
import type { DesignDocument } from '../src/shared/schema';
export interface RunPayload {
  inputHash:string;providerFingerprint:string;system:string;prompt:string;
  tools:(ModelTool&{bindingId:string;remoteName:string;descriptor:ConnectorTool})[];
  exchanges:ModelExchange[];pendingCalls:ModelCall[];pendingTurn:ModelExchange|null;
  proposal?:DesignDocument;errorCode?:string;
}
export interface RunRow {
  id:string;user_id:string;project_id:string;principal_kind:ConnectorPrincipal['kind'];principal_id:string;principal_client_id:string|null;
  revision:number;status:AgentRun['status'];provider:AgentRun['provider'];model:string;pins_json:string;model_turns:number;tool_calls:number;active_ms:number;
  pending_operation_id:string|null;proposal_id:string|null;lease_id:string|null;lease_expires_at:number|null;created_at:string;updated_at:string;
  encrypted_payload:string|null;payload_expires_at:number|null;
}
export function runMetadata(row:RunRow):AgentRun {
  const principal:ConnectorPrincipal=row.principal_kind==='session'?{kind:'session',userId:row.user_id,sessionId:row.principal_id}:
    row.principal_kind==='api'?{kind:'api',userId:row.user_id,tokenId:row.principal_id}:
    row.principal_kind==='oauth'?{kind:'oauth',userId:row.user_id,clientId:row.principal_client_id!,familyId:row.principal_id}:
    {kind:'webmcp',userId:row.user_id,projectId:row.project_id,grantId:row.principal_id};
  return agentRunSchema.parse({id:row.id,projectId:row.project_id,principal,revision:row.revision,status:row.status,provider:row.provider,model:row.model,pins:JSON.parse(row.pins_json),modelTurns:row.model_turns,toolCalls:row.tool_calls,activeMs:row.active_ms,pendingOperationId:row.pending_operation_id,proposalId:row.proposal_id,leaseId:row.lease_id,leaseExpiresAt:row.lease_expires_at===null?null:new Date(row.lease_expires_at).toISOString(),createdAt:row.created_at,updatedAt:row.updated_at});
}
export async function ownedRun(env:Bindings,principal:ConnectorPrincipal,projectId:string,runId:string,allowHuman=false){
  await assertActiveConnectorPrincipal(env,principal);
  const row=await env.DB.prepare('SELECT * FROM agent_runs WHERE id=? AND user_id=? AND project_id=?').bind(runId,principal.userId,projectId).first<RunRow>();
  if(!row)fail(404,'run_not_found','Run not found.');
  if(!(allowHuman&&principal.kind==='session')&&canonicalConnectorJson(principalColumns(principal))!==canonicalConnectorJson(principalColumns(runMetadata(row).principal)))fail(403,'missing_grant','This run belongs to a different agent identity.');
  return row;
}
export async function sealRun(env:Bindings,userId:string,runId:string,payload:RunPayload){
  // Keep the encrypted row below D1's row limit, including metadata and pins.
  boundedConnectorJson(786432).parse(payload);
  return encrypt(env,canonicalConnectorJson({userId,runId,payload}));
}
export async function openRun(env:Bindings,row:RunRow):Promise<RunPayload>{
  if(!row.encrypted_payload||row.payload_expires_at!==null&&row.payload_expires_at<=Date.now())fail(409,'run_payload_unavailable','Private run content has expired or was revoked.');
  const data=JSON.parse(await decrypt(env,row.encrypted_payload));
  if(data.userId!==row.user_id||data.runId!==row.id)fail(409,'run_payload_unavailable','Run content could not be verified.');
  boundedConnectorJson(786432).parse(data.payload);return data.payload;
}
export async function claimRun(env:Bindings,row:RunRow,guard:{sql:string;values:unknown[]},kind:'model'|'tool'){
  const lease=id(),stepId=id(),timestamp=now();
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE agent_runs SET status='running',revision=revision+1,lease_id=?,lease_expires_at=?,updated_at=? WHERE id=? AND user_id=? AND revision=? AND status IN('ready_to_continue','awaiting_approval') AND (${guard.sql})`)
      .bind(lease,Date.now()+35000,timestamp,row.id,row.user_id,row.revision,...guard.values),
    env.DB.prepare(`INSERT INTO run_steps(id,run_id,user_id,project_id,sequence,kind,status,operation_id,lease_id,lease_expires_at,created_at,updated_at)
      SELECT ?,id,user_id,project_id,COALESCE((SELECT MAX(sequence) FROM run_steps WHERE run_id=agent_runs.id),0)+1,?,'running',pending_operation_id,lease_id,lease_expires_at,?,? FROM agent_runs WHERE id=? AND user_id=? AND lease_id=? AND status='running'`)
      .bind(stepId,kind,timestamp,timestamp,row.id,row.user_id,lease),
  ]) as {meta:{changes:number}}[];
  if(result[0].meta.changes!==1||result[1].meta.changes!==1)fail(409,'revision_conflict','Another request advanced this run. Reload its status.');
  return {lease,stepId,revision:row.revision+1};
}
export async function finishRun(env:Bindings,row:RunRow,claim:{lease:string;stepId:string;revision:number},payload:RunPayload,next:{status:AgentRun['status'];pendingOperationId?:string|null;proposalId?:string|null;modelTurns:number;toolCalls:number;activeMs:number},guard:{sql:string;values:unknown[]}){
  const encrypted=await sealRun(env,row.user_id,row.id,payload),timestamp=now(),expires=Date.now()+7*86400000;
  const stepStatus=next.status==='outcome_unknown'?'outcome_unknown':next.status==='failed'?'failed':next.status==='awaiting_approval'?'pending':'succeeded';
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE agent_runs SET status=?,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,encrypted_payload=?,pending_operation_id=?,proposal_id=?,model_turns=?,tool_calls=?,active_ms=?,payload_expires_at=?,updated_at=?
      WHERE id=? AND user_id=? AND revision=? AND lease_id=? AND status='running' AND lease_expires_at>${operationClockSql} AND (${guard.sql})`)
      .bind(next.status,encrypted,next.pendingOperationId??null,next.proposalId??null,next.modelTurns,next.toolCalls,next.activeMs,expires,timestamp,row.id,row.user_id,claim.revision,claim.lease,...guard.values),
    env.DB.prepare(`UPDATE run_steps SET status=?,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,operation_id=?,updated_at=? WHERE id=? AND run_id=? AND lease_id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND revision=? AND status=?)`)
      .bind(stepStatus,next.pendingOperationId??row.pending_operation_id,timestamp,claim.stepId,row.id,claim.lease,row.id,claim.revision+1,next.status),
  ]) as {meta:{changes:number}}[];
  if(result[0].meta.changes!==1||result[1].meta.changes!==1)fail(409,'revision_conflict','Run authority changed while processing its result.');
}
export async function interruptRun(env:Bindings,row:RunRow,claim:{lease:string;stepId:string;revision:number}){
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_runs SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE id=? AND user_id=? AND revision=? AND lease_id=?")
      .bind(now(),Date.now()+7*86400000,row.id,row.user_id,claim.revision,claim.lease),
    env.DB.prepare("UPDATE run_steps SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND run_id=? AND lease_id=?")
      .bind(now(),claim.stepId,row.id,claim.lease),
  ]);
}
