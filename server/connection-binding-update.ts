import type { Context } from 'hono';
import type { Env } from './types';
import { connectionBindingUpdateSchema } from '../src/shared/connector-management';
import { projectConnectionBindingSchema } from '../src/shared/connectors';
import { interactiveConnectionOwner,ownedBinding } from './connection-policy';
import { ownedConnection } from './connection-store';
import { canonicalConnectorJson } from './connector-fingerprints';
import { activePrincipalGuard } from './connector-principal-guard';
import { fail,now } from './security';
export async function updateProjectConnectionBinding(c:Context<Env>,bindingId:string,input:unknown){
  const userId=interactiveConnectionOwner(c),value=connectionBindingUpdateSchema.parse(input),binding=await ownedBinding(c.env,userId,bindingId),connection=await ownedConnection(c.env,userId,binding.connection_id);
  if(value.selection.adapter!==connection.adapter)fail(400,'invalid_selection','Selection must match this connection.');
  if(connection.status!=='connected')fail(409,'needs_reauthorization','Reconnect this account before changing its selection.');
  const active=activePrincipalGuard(c.env,c.get('principal')!),timestamp=now();
  const guard=`EXISTS(SELECT 1 FROM project_connection_bindings b JOIN connections c ON c.id=b.connection_id WHERE b.id=? AND b.user_id=? AND b.policy_revision=? AND b.disabled_at IS NULL AND c.revision=? AND c.status='connected') AND (${active.sql})`;
  const statement=(sql:string,values:unknown[])=>c.env.DB.prepare(sql).bind(...values,bindingId,userId,value.expectedPolicyRevision,connection.revision,...active.values);
  const result=await c.env.DB.batch([
    statement(`UPDATE connection_agent_grants SET revoked_at=? WHERE user_id=? AND project_id=? AND connection_id=? AND revoked_at IS NULL AND (${guard})`,[timestamp,userId,binding.project_id,connection.id]),
    statement(`UPDATE connector_operations SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE binding_id=? AND status IN('pending','awaiting_approval','running') AND (${guard})`,[timestamp,Date.now()+604800000,bindingId]),
    statement(`UPDATE agent_runs SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,payload_expires_at=? ,updated_at=? WHERE user_id=? AND status IN('ready_to_continue','running','awaiting_approval','needs_reauthorization') AND EXISTS(SELECT 1 FROM json_each(pins_json) WHERE json_extract(value,'$.bindingId')=?) AND (${guard})`,[Date.now()+604800000,timestamp,userId,bindingId]),
    statement(`UPDATE run_steps SET status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,revision=revision+1,lease_id=NULL,lease_expires_at=NULL,payload_expires_at=? ,updated_at=? WHERE user_id=? AND status IN('pending','running') AND run_id IN(SELECT r.id FROM agent_runs r,json_each(r.pins_json) WHERE json_extract(value,'$.bindingId')=?) AND (${guard})`,[Date.now()+604800000,timestamp,userId,bindingId]),
    statement(`UPDATE project_source_snapshots SET status='disconnected' WHERE binding_id=? AND user_id=? AND (${guard})`,[bindingId,userId]),
    statement(`UPDATE project_connection_bindings SET role=?,selection_json=?,policy_revision=policy_revision+1,updated_at=? WHERE id=? AND user_id=? AND (${guard})`,[value.role,canonicalConnectorJson(value.selection),timestamp,bindingId,userId]),
  ]) as {meta:{changes:number}}[];
  if(result.at(-1)?.meta.changes!==1)fail(409,'revision_conflict','Project selection changed. Reload before editing.');
  const current=await ownedBinding(c.env,userId,bindingId);
  return projectConnectionBindingSchema.parse({id:current.id,projectId:current.project_id,connectionId:current.connection_id,role:current.role,policyRevision:current.policy_revision,selection:JSON.parse(current.selection_json)});
}
