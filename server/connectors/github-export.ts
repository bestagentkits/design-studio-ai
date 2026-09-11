import { z } from 'zod';
import type { Context } from 'hono';
import type { Bindings,Env } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { connectorToolSchema } from '../../src/shared/connectors';
import { connectorOperationPrepareSchema } from '../../src/shared/connector-operations';
import { connectorFingerprint } from '../connector-fingerprints';
import { githubBindingAuthority } from './github-catalog';
import { githubHeaders } from './github-auth';
import { githubExportArguments,stageGithubExport,preparedGithubFiles,githubBase,gitSha } from './github-export-artifact';
import { prepareConnectorOperation,claimConnectorOperation,finishConnectorOperation,markConnectorOperationUncertain } from '../connector-operations';
import { ownedOperation,inspectOperationVersions,operationClockSql } from '../connector-operation-versions';
import { nativeJson } from './native-transport';
import { fail } from '../security';
export async function githubExportTool(connectionId:string){
  const definition={remoteName:'create_react_pull_request',description:'Export actual React project files into the selected repository directory, on a new operation-specific branch and pull request. Inspect the prepared ZIP and file diff before approving. Never merges, force-pushes, edits workflows or deletes unrelated files.',inputSchema:z.toJSONSchema(githubExportArguments),effect:'write' as const};
  return connectorToolSchema.parse({...definition,connectionId,fingerprint:await connectorFingerprint(definition)});
}
export async function prepareGithubExport(env:Bindings,principal:ConnectorPrincipal,projectId:string,input:unknown,c?:Context<Env>){
  const value=connectorOperationPrepareSchema.parse(input),args=githubExportArguments.parse(value.arguments);
  if(value.action!=='create_react_pull_request')fail(400,'unsupported_action','Choose the React pull request action.');
  const auth=await githubBindingAuthority(env,principal,value.bindingId,'prepare_write',projectId);
  if(auth.selection.adapter!=='github'||auth.binding.role!=='destination'||!auth.selection.paths.includes(args.directory))fail(403,'missing_grant','Choose an explicitly selected export directory.');
  if(!c)fail(503,'renderer_not_configured','React export context is unavailable.');
  const operation=await prepareConnectorOperation(env,principal,value,await githubExportTool(auth.connection.id));
  await stageGithubExport(c,operation,args,auth.remote,auth.selection.commit);return operation;
}
export async function executeGithubExport(env:Bindings,principal:ConnectorPrincipal,projectId:string,operationId:string,expectedRevision:number,trustedGuard?:{sql:string;values:unknown[]}){
  const row=await ownedOperation(env,principal.userId,operationId);
  if(row.project_id!==projectId||row.action!=='create_react_pull_request')fail(404,'operation_not_found','React export operation not found.');
  const auth=await githubBindingAuthority(env,principal,row.binding_id,'prepare_write',projectId),descriptor=await githubExportTool(auth.connection.id);
  const claimed=await claimConnectorOperation(env,principal,operationId,expectedRevision,descriptor),revision=claimed.operation.revision,lease=claimed.leaseId;
  const remoteIds:string[]=[];let dispatched=false;
  try{
    const args=githubExportArguments.parse(claimed.arguments);
    if(auth.selection.adapter!=='github'||auth.binding.role!=='destination'||!auth.selection.paths.includes(args.directory))fail(403,'missing_grant','Export directory is no longer authorized.');
    const prepared=await preparedGithubFiles(env,row.id,args.directory),base=`https://api.github.com/repos/${auth.remote.repository.full_name}`,headers=githubHeaders(auth.remote.token);
    const authority=await inspectOperationVersions(env,principal,row.binding_id,claimed.operation.versions,'write',row.action);
    const guard=async()=>{
      await auth.recheck();
      if(!await env.DB.prepare(`SELECT 1 FROM connector_operations WHERE id=? AND user_id=? AND revision=? AND status='running' AND lease_id=? AND lease_expires_at>${operationClockSql} AND (${authority.guard.sql})${trustedGuard?` AND (${trustedGuard.sql})`:''}`).bind(row.id,principal.userId,revision,lease,...authority.guard.values,...(trustedGuard?.values??[])).first())fail(409,'revision_conflict','Export authority changed before dispatch.');
    };
    const remember=async(value:string)=>{remoteIds.push(value);await env.DB.prepare("UPDATE connector_operations SET remote_ids_json=? WHERE id=? AND user_id=?").bind(JSON.stringify(remoteIds),row.id,principal.userId).run();};
    const post=async(path:string,body:unknown)=>{await guard();dispatched=true;return nativeJson(env,base+path,{method:'POST',headers,body:JSON.stringify(body)},2097152);};
    await guard();const baseTree=await githubBase(env,base,auth.remote.token,args.baseBranch,auth.selection.commit);
    await remember(`branch:${prepared.artifact.remote_id}`);
    const entries=[];
    for(const file of prepared.files){
      const blob=z.object({sha:gitSha}).parse(await post('/git/blobs',{content:Buffer.from(file.bytes).toString('base64'),encoding:'base64'}));
      if(blob.sha!==file.sha)fail(502,'invalid_provider_response','GitHub blob hash differs from reviewed content.');
      entries.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
    }
    const tree=z.object({sha:gitSha}).parse(await post('/git/trees',{base_tree:baseTree,tree:entries}));await remember(`tree:${tree.sha}`);
    const commit=z.object({sha:gitSha}).parse(await post('/git/commits',{message:`${args.title}\n\nStudio operation: ${row.id}`,tree:tree.sha,parents:[auth.selection.commit]}));await remember(`commit:${commit.sha}`);
    await guard();await githubBase(env,base,auth.remote.token,args.baseBranch,auth.selection.commit);
    const branch=z.object({ref:z.string(),object:z.object({sha:gitSha})}).parse(await post('/git/refs',{ref:`refs/heads/${prepared.artifact.remote_id}`,sha:commit.sha}));
    if(branch.ref!==`refs/heads/${prepared.artifact.remote_id}`||branch.object.sha!==commit.sha)fail(502,'invalid_provider_response','GitHub branch does not match this export.');
    await guard();await githubBase(env,base,auth.remote.token,args.baseBranch,auth.selection.commit);
    const pr=z.object({number:z.number().int().positive(),html_url:z.string().url(),head:z.object({sha:gitSha,ref:z.string()}),base:z.object({ref:z.string()})}).parse(await post('/pulls',{title:args.title,head:prepared.artifact.remote_id,base:args.baseBranch,body:`React design export from Studio.\n\nOperation: ${row.id}\nArchive SHA-256: ${prepared.artifact.content_hash}\nReviewed base: ${auth.selection.commit}` }));
    await remember(`pr:${pr.number}`);
    if(pr.head.sha!==commit.sha||pr.head.ref!==prepared.artifact.remote_id||pr.base.ref!==args.baseBranch)fail(502,'invalid_provider_response','GitHub pull request differs from the approved export.');
    return await finishConnectorOperation(env,principal,row.id,revision,lease,{status:'succeeded',remoteIds,result:{repository:auth.remote.repository.full_name,branch:prepared.artifact.remote_id,commit:commit.sha,pullRequest:pr.number,url:pr.html_url,archiveSha256:prepared.artifact.content_hash}});
  }catch(error){try{return await finishConnectorOperation(env,principal,row.id,revision,lease,{status:dispatched?'outcome_unknown':'failed',remoteIds,errorCode:dispatched?'partial_repository_export':'destination_unavailable'});}catch{await markConnectorOperationUncertain(env,principal.userId,row.id,revision,lease);throw error;}}
}
