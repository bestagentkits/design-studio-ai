import { compactConnectorGuard } from './connector-sql-guard';
import type { Context } from 'hono';
import type { Env } from './types';
import type { AgentRun } from '../src/shared/agent-runs';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { authorizeConnectorBinding, requestConnectorPrincipal } from './connection-policy';
import { connectorBindingAuthority } from './connector-binding-authority';
import { activePrincipalGuard } from './connector-principal-guard';
import { providerConfig } from './provider-connections';
import { connectorFingerprint } from './connector-fingerprints';
import { projectRow } from './projects';
import { scopeSchema, type DesignBrief } from '../src/shared/brief';
import { fail } from './security';

export async function runProjectContext(c:Context<Env>,projectId:string,documentRevision:number,briefRevision:number){
  const project=await projectRow(c,projectId);
  const saved=await c.env.DB.prepare('SELECT brief,revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(projectId,project.user_id).first<{brief:string;revision:number}>();
  if(project.revision!==documentRevision||saved?.revision!==briefRevision)fail(409,'revision_conflict','Project or brief changed. Start a new run with the reviewed versions.');
  const brief=JSON.parse(saved.brief) as DesignBrief;
  if(brief.status!=='approved'||!brief.scope||!brief.approvedAt)fail(409,'brief_not_approved','Approve the project brief before starting a connector run.');
  scopeSchema.parse(brief.scope);
  return {project,brief,briefJson:saved.brief};
}
export async function runProviderContext(c:Context<Env>,provider:string){
  const config=await providerConfig(c,provider);
  const fingerprint=await connectorFingerprint({provider:config.provider,key:config.encrypted_key,base:config.base_url,protocol:config.protocol,model:config.model,auth:config.authMethod,header:config.authHeader??null});
  return {config,fingerprint};
}
export async function runAuthority(c:Context<Env>,run:AgentRun,providerFingerprint:string){
  const principal=requestConnectorPrincipal(c,run.projectId);
  if(await connectorFingerprint(principal)!==await connectorFingerprint(run.principal))fail(403,'missing_grant','Resume with the identity that started this run.');
  const first=run.pins[0].versions;
  const context=await runProjectContext(c,run.projectId,first.documentRevision,first.briefRevision);
  const provider=await runProviderContext(c,run.provider);
  if(provider.fingerprint!==providerFingerprint)fail(409,'revision_conflict','The selected AI provider configuration changed. Start a new run.');
  const active=activePrincipalGuard(c.env,principal),guards=[active.sql],values=[...active.values];
  const add=(sql:string,args:unknown[])=>{guards.push(sql);values.push(...args);};
  add('EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND revision=?)',[run.projectId,principal.userId,first.documentRevision]);
  add('EXISTS(SELECT 1 FROM design_briefs WHERE project_id=? AND user_id=? AND revision=? AND brief=?)',[run.projectId,principal.userId,first.briefRevision,context.briefJson]);
  add('EXISTS(SELECT 1 FROM providers WHERE user_id=? AND provider=? AND encrypted_key=? AND base_url=? AND model=? AND COALESCE(protocol,?)=? AND auth_method IS ? AND auth_header IS ?)',[principal.userId,run.provider,provider.config.encrypted_key,provider.config.base_url,provider.config.model,provider.config.protocol,provider.config.protocol,provider.config.auth_method,provider.config.auth_header]);
  for(const pin of run.pins){
    const selected=await authorizeConnectorBinding(c.env,principal,pin.bindingId,'run');
    const auth=await connectorBindingAuthority(c.env,principal,pin.bindingId,'run',undefined,run.projectId,selected.selection.adapter);
    const credential=await c.env.DB.prepare('SELECT credential_version FROM connection_credentials WHERE connection_id=? AND user_id=?').bind(auth.connection.id,principal.userId).first<{credential_version:number}>();
    if(auth.binding.policy_revision!==pin.versions.policyRevision||auth.connection.revision!==pin.versions.connectionRevision||(auth.connection.auth_mode==='anonymous'?1:credential?.credential_version)!==pin.versions.credentialVersion)fail(409,'revision_conflict','Connection or grant changed. Start a new run.');
    add(auth.guard.sql,auth.guard.values);
  }
  const sources=await c.env.DB.prepare('SELECT id,binding_id,remote_identity FROM project_source_snapshots WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND project_id=?').bind(JSON.stringify(first.sourceSnapshotIds),principal.userId,run.projectId).all<{id:string;binding_id:string|null;remote_identity:string}>();
  if(sources.results.length!==first.sourceSnapshotIds.length)fail(409,'revision_conflict','Selected source is no longer available.');
  for(const source of sources.results){
    if(!source.binding_id||!run.pins.some(pin=>pin.bindingId===source.binding_id))fail(403,'missing_grant','Selected source is outside the run bindings.');
    const selected=await authorizeConnectorBinding(c.env,principal,source.binding_id,'read_source',source.remote_identity);
    if(selected.selection.adapter==='google-drive'&&!selected.selection.fileIds.includes(source.remote_identity))fail(403,'missing_grant','Source file is outside this agent’s selection.');
    const sourceAuth=await connectorBindingAuthority(c.env,principal,source.binding_id,'read_source',source.remote_identity,run.projectId,selected.selection.adapter);
    add(sourceAuth.guard.sql,sourceAuth.guard.values);
  }
  add('NOT EXISTS(SELECT 1 FROM json_each(?) s WHERE NOT EXISTS(SELECT 1 FROM project_source_snapshots p WHERE p.id=s.value AND p.user_id=? AND p.project_id=? AND p.status=\'available\'))',[JSON.stringify(first.sourceSnapshotIds),principal.userId,run.projectId]);
  return {...context,...provider,principal,guard:compactConnectorGuard({sql:guards.map(g=>`(${g})`).join(' AND '),values})};
}
