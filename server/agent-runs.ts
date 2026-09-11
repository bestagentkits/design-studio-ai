import type { Context } from 'hono';
import type { Env } from './types';
import { agentRunAdvanceSchema, agentRunLimits, type AgentRun } from '../src/shared/agent-runs';
import { documentSchema } from '../src/shared/schema';
import { requestConnectorPrincipal } from './connection-policy';
import { runAuthority } from './agent-run-context';
import { ownedRun, openRun, runMetadata, claimRun, finishRun, interruptRun } from './agent-run-store';
import { prepareConnectorAction, executeConnectorAction } from './connector-action-dispatch';
import { readConnectorOperation } from './connector-operation-reads';
import { validateOperationTool } from './connector-operation-versions';
import { buildModelToolRequest, decodeModelToolTurn } from './provider-tool-messages';
import { limitedBytes } from './providers';
import { validateAssets } from './projects';
import { ApiError, fail, id } from './security';

export async function advanceAgentRun(c:Context<Env>,projectId:string,runId:string,input:unknown){
  const value=agentRunAdvanceSchema.parse(input),actor=requestConnectorPrincipal(c,projectId);
  const row=await ownedRun(c.env,actor,projectId,runId),run=runMetadata(row);
  if(run.revision!==value.expectedRevision||!['ready_to_continue','awaiting_approval'].includes(run.status))fail(409,'revision_conflict','Reload this run before continuing.');
  const payload=await openRun(c.env,row),authority=await runAuthority(c,run,payload.providerFingerprint);
  if(run.pendingOperationId){const pending=await readConnectorOperation(c.env,actor,run.pendingOperationId);if(pending.operation.status==='awaiting_approval'||pending.operation.errorCode==='input_required')return run;}
  const kind=payload.pendingCalls.length?'tool':'model',claim=await claimRun(c.env,row,authority.guard,kind),started=Date.now();
  const leaseGuard={sql:`EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND user_id=? AND revision=? AND lease_id=? AND status='running') AND (${authority.guard.sql})`,values:[row.id,row.user_id,claim.revision,claim.lease,...authority.guard.values]};
  const next={status:'ready_to_continue' as AgentRun['status'],modelTurns:run.modelTurns,toolCalls:run.toolCalls,activeMs:run.activeMs,pendingOperationId:null as string|null,proposalId:null as string|null};
  delete payload.errorCode;
  let dispatched=false,completed=false;
  try{
    if(run.activeMs>=agentRunLimits.activeMs||kind==='model'&&run.modelTurns>=agentRunLimits.modelTurns||kind==='tool'&&!run.pendingOperationId&&run.toolCalls>=agentRunLimits.toolCalls)fail(429,'run_budget_exhausted','Run budget reached. Review progress before starting a new run.');
    if(kind==='model'){
      const request=buildModelToolRequest(authority.config,{model:run.model,system:payload.system,prompt:payload.prompt,tools:payload.tools,exchanges:payload.exchanges});
      if(!await c.env.DB.prepare(`SELECT 1 WHERE ${leaseGuard.sql}`).bind(...leaseGuard.values).first())fail(409,'revision_conflict','Run authority changed before the model request.');
      dispatched=true;next.modelTurns++;
      const response=await fetch(request.url,{...request.init,redirect:'manual',signal:AbortSignal.timeout(28000)});
      if(!response.ok){completed=true;await response.body?.cancel();fail(502,'provider_error',`Provider returned HTTP ${response.status}; verify tool support, credentials and quota.`);}
      const bytes=await limitedBytes(response,1572864);completed=true;
      const turn=decodeModelToolTurn(authority.config.protocol,JSON.parse(new TextDecoder().decode(bytes)));
      if(turn.calls.length){
        if(next.toolCalls+turn.calls.length>agentRunLimits.toolCalls)fail(429,'run_budget_exhausted','The model requested more tools than this run permits.');
        payload.pendingCalls=turn.calls;payload.pendingTurn={turn,results:[]};
      }else{
        const document=documentSchema.parse(JSON.parse(turn.text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'')));
        if(document.id!==projectId||document.kind!==authority.project.kind)fail(502,'invalid_generation','Model changed document identity.');
        await validateAssets(c,document,projectId);payload.proposal=document;payload.exchanges.push({turn,results:[]});next.proposalId=id();next.status='succeeded';
      }
    }else{
      const call=payload.pendingCalls[0],tool=payload.tools.find(t=>t.name===call.name);
      if(!tool)fail(400,'invalid_tool_arguments','Model requested a tool that is not selected.');
      if(!run.pendingOperationId){
        const pin=run.pins.find(p=>p.bindingId===tool.bindingId)!;
        const prepared=await prepareConnectorAction(c.env,actor,projectId,{bindingId:tool.bindingId,action:tool.remoteName,arguments:call.arguments,idempotencyKey:`run_${run.id}_${run.toolCalls}`,expectedVersions:pin.versions},c);
        const expected=await validateOperationTool(tool.descriptor,call.arguments);
        if(prepared.actionFingerprint!==expected.fingerprint)fail(409,'schema_changed','Tool changed since the model saw its definition.');
        next.pendingOperationId=prepared.id;next.status='awaiting_approval';next.toolCalls++;
      }else{
        let detail=await readConnectorOperation(c.env,actor,run.pendingOperationId);
        if(detail.operation.status==='pending'){
          if(!await c.env.DB.prepare(`SELECT 1 WHERE ${leaseGuard.sql}`).bind(...leaseGuard.values).first())fail(409,'revision_conflict','Run authority changed before tool dispatch.');
          dispatched=true;
          await executeConnectorAction(c.env,actor,projectId,run.pendingOperationId,detail.operation.revision,leaseGuard);
          detail=await readConnectorOperation(c.env,actor,run.pendingOperationId);
        }
        if(detail.operation.errorCode==='input_required'){next.status='awaiting_approval';next.pendingOperationId=run.pendingOperationId;payload.errorCode='input_required';}
        else if(detail.operation.status==='outcome_unknown'||detail.operation.status==='running'){next.status='outcome_unknown';payload.errorCode='outcome_unknown';}
        else{
          if(!payload.pendingTurn)fail(409,'invalid_tool_sequence','The model call could not be recovered.');
          payload.pendingTurn.results.push({id:call.id,name:call.name,content:detail.result??{status:detail.operation.status,errorCode:detail.operation.errorCode},isError:detail.operation.status!=='succeeded'});
          payload.pendingCalls.shift();
          if(!payload.pendingCalls.length){payload.exchanges.push(payload.pendingTurn);payload.pendingTurn=null;}
        }
      }
    }
    await runAuthority(c,run,payload.providerFingerprint);
    next.activeMs=Math.min(agentRunLimits.activeMs,run.activeMs+Date.now()-started);
    await finishRun(c.env,row,claim,payload,next,authority.guard);
  }catch(error){
    if(!dispatched||completed){
      payload.errorCode=error instanceof ApiError?error.code:kind==='model'?'invalid_generation':'invalid_tool_arguments';
      try{
        await runAuthority(c,run,payload.providerFingerprint);
        await finishRun(c.env,row,claim,payload,{...next,status:'failed',activeMs:Math.min(agentRunLimits.activeMs,run.activeMs+Date.now()-started)},authority.guard);
        return runMetadata(await ownedRun(c.env,actor,projectId,runId));
      }catch{/* A lost lease or changed authority must retain uncertainty. */}
    }
    // Never automatically reissue a model/tool request after losing its checkpoint or authority.
    await interruptRun(c.env,row,claim);throw error;
  }
  return runMetadata(await ownedRun(c.env,actor,projectId,runId));
}
