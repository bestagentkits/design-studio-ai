import { validateAssets } from './projects';
import { Hono } from 'hono';
import type { Env } from './types';
import { connectorIdSchema } from '../src/shared/connector-values';
import { agentRunAdvanceSchema } from '../src/shared/agent-runs';
import { requestConnectorPrincipal, principalColumns, assertActiveConnectorPrincipal } from './connection-policy';
import { activePrincipalGuard } from './connector-principal-guard';
import { ownedRun, runMetadata, openRun, type RunRow } from './agent-run-store';
import { startAgentRun } from './agent-run-start';
import { advanceAgentRun } from './agent-runs';
import { runAuthority } from './agent-run-context';
import { cancelConnectorOperation } from './connector-operations';
import { projectRow } from './projects';
import { ApiError, fail, now } from './security';
export const agentRunRoutes=new Hono<Env>();
agentRunRoutes.get('/:id/runs',async c=>{
  const project=await projectRow(c,connectorIdSchema.parse(c.req.param('id'))),actor=requestConnectorPrincipal(c,project.id),identity=principalColumns(actor);
  await assertActiveConnectorPrincipal(c.env,actor);
  const filter=actor.kind==='session'?'':' AND principal_kind=? AND principal_id=? AND principal_client_id IS ?';
  const rows=await c.env.DB.prepare(`SELECT * FROM agent_runs WHERE project_id=? AND user_id=?${filter} ORDER BY created_at DESC,id DESC LIMIT 51`)
    .bind(project.id,actor.userId,...(actor.kind==='session'?[]:[identity.kind,identity.id,identity.clientId])).all<RunRow>();
  return c.json({runs:rows.results.slice(0,50).map(runMetadata),truncated:rows.results.length>50});
});
agentRunRoutes.post('/:id/runs',async c=>c.json({run:await startAgentRun(c,connectorIdSchema.parse(c.req.param('id')),await c.req.json())},201));
agentRunRoutes.post('/:id/runs/:runId/advance',async c=>c.json({run:await advanceAgentRun(c,connectorIdSchema.parse(c.req.param('id')),connectorIdSchema.parse(c.req.param('runId')),await c.req.json())}));
agentRunRoutes.get('/:id/runs/:runId',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),actor=requestConnectorPrincipal(c,projectId);
  const row=await ownedRun(c.env,actor,projectId,connectorIdSchema.parse(c.req.param('runId')),true),run=runMetadata(row);
  const steps=await c.env.DB.prepare('SELECT id,sequence,kind,status,operation_id AS operationId,created_at AS createdAt,updated_at AS updatedAt FROM run_steps WHERE run_id=? AND user_id=? ORDER BY sequence').bind(row.id,actor.userId).all();
  try{
    const payload=await openRun(c.env,row);
    if(actor.kind!=='session')await runAuthority(c,run,payload.providerFingerprint);
    await assertActiveConnectorPrincipal(c.env,actor);
    const current=await ownedRun(c.env,actor,projectId,row.id,true);
    if(current.revision!==row.revision||current.encrypted_payload!==row.encrypted_payload)fail(409,'revision_conflict','Run changed while reading.');
    return c.json({run,steps:steps.results,payloadAvailable:true,proposal:payload.proposal??null,errorCode:payload.errorCode??null,usage:[...payload.exchanges.map(e=>e.turn.usage),...(payload.pendingTurn?[payload.pendingTurn.turn.usage]:[])],pendingCalls:payload.pendingCalls});
  }catch(error){
    if(!(error instanceof ApiError&&[403,404,409].includes(error.status)))throw error;
    return c.json({run,steps:steps.results,payloadAvailable:false,proposal:null,errorCode:error.code,usage:[],pendingCalls:[]});
  }
});
agentRunRoutes.post('/:id/runs/:runId/cancel',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),actor=requestConnectorPrincipal(c,projectId),body=agentRunAdvanceSchema.parse(await c.req.json());
  const row=await ownedRun(c.env,actor,projectId,connectorIdSchema.parse(c.req.param('runId')),true),active=activePrincipalGuard(c.env,actor);
  const result=await c.env.DB.prepare(`UPDATE agent_runs SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=?
    WHERE id=? AND user_id=? AND revision=? AND status IN('running','ready_to_continue','awaiting_approval','needs_reauthorization') AND (${active.sql})`).bind(now(),Date.now()+7*86400000,row.id,actor.userId,body.expectedRevision,...active.values).run();
  if(result.meta.changes!==1)fail(409,'revision_conflict','Run changed before cancellation.');
  await c.env.DB.prepare("UPDATE run_steps SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE run_id=? AND user_id=? AND status IN('pending','running')").bind(now(),row.id,actor.userId).run();
  if(row.pending_operation_id){
    const op=await c.env.DB.prepare('SELECT revision,status FROM connector_operations WHERE id=? AND user_id=?').bind(row.pending_operation_id,actor.userId).first<{revision:number;status:string}>();
    if(op&&['pending','awaiting_approval','running'].includes(op.status)){
      try{await cancelConnectorOperation(c.env,actor,row.pending_operation_id,op.revision);}
      catch(error){if(!(error instanceof ApiError&&error.code==='revision_conflict'))throw error;}
    }
  }
  return c.json({run:runMetadata(await ownedRun(c.env,actor,projectId,row.id,true))});
});

agentRunRoutes.get('/:id/runs/:runId/proposal',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),actor=requestConnectorPrincipal(c,projectId);
  const row=await ownedRun(c.env,actor,projectId,connectorIdSchema.parse(c.req.param('runId'))),run=runMetadata(row),payload=await openRun(c.env,row);
  if(run.status!=='succeeded'||!payload.proposal)fail(409,'proposal_unavailable','This run has no completed proposal.');
  const authority=await runAuthority(c,run,payload.providerFingerprint);
  await validateAssets(c,payload.proposal,projectId);
  if(!await c.env.DB.prepare(`SELECT 1 FROM agent_runs WHERE id=? AND revision=? AND encrypted_payload=? AND (${authority.guard.sql})`).bind(row.id,row.revision,row.encrypted_payload,...authority.guard.values).first())fail(409,'revision_conflict','Run or project changed before proposal delivery.');
  return c.json({document:payload.proposal,expectedDocumentRevision:run.pins[0].versions.documentRevision,expectedBriefRevision:run.pins[0].versions.briefRevision});
});
