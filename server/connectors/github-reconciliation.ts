import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { readConnectorOperation } from '../connector-operation-reads';
import { ownedOperation } from '../connector-operation-versions';
import { connectorOperationMetadata } from '../connector-operations';
import { githubBindingAuthority } from './github-catalog';
import { githubExportArguments,gitSha } from './github-export-artifact';
import { readExportArtifact } from './google-export-artifacts';
import { githubHeaders } from './github-auth';
import { nativeJson } from './native-transport';
import { fail,now,encrypt } from '../security';
/** Verify a known commit and PR; never replay writes, move a ref, merge, or delete partial artifacts. */
export async function reconcileGithubExport(env:Bindings,principal:ConnectorPrincipal,projectId:string,operationId:string,revision:number){
  const detail=await readConnectorOperation(env,principal,operationId),row=await ownedOperation(env,principal.userId,operationId);
  if(row.project_id!==projectId||row.action!=='create_react_pull_request')fail(404,'operation_not_found','Export operation not found.');
  if(row.revision!==revision||row.status!=='outcome_unknown'||!detail.payloadAvailable)fail(409,'revision_conflict','Only uncertain retained exports can be reconciled.');
  const args=githubExportArguments.parse(detail.arguments),auth=await githubBindingAuthority(env,principal,row.binding_id,'prepare_write',projectId);
  if(auth.selection.adapter!=='github'||!auth.selection.paths.includes(args.directory))fail(403,'missing_grant','Export destination is no longer authorized.');
  const {artifact}=await readExportArtifact(env,row.id),ids=z.array(z.string()).parse(JSON.parse(row.remote_ids_json)),commit=ids.find(id=>id.startsWith('commit:'))?.slice(7),tree=ids.find(id=>id.startsWith('tree:'))?.slice(5);
  if(!commit||!tree)fail(409,'outcome_unknown','No completed commit was recorded. Inspect the partial remote IDs; no write was retried.');
  const base=`https://api.github.com/repos/${auth.remote.repository.full_name}`,headers=githubHeaders(auth.remote.token);
  await auth.recheck();
  const saved=z.object({sha:gitSha,tree:z.object({sha:gitSha}),parents:z.array(z.object({sha:gitSha}))}).parse(await nativeJson(env,`${base}/git/commits/${gitSha.parse(commit)}`,{headers}));
  if(saved.sha!==commit||saved.tree.sha!==tree||saved.parents.length!==1||saved.parents[0].sha!==auth.selection.commit)fail(409,'outcome_unknown','Remote commit does not match the reviewed base and tree.');
  await auth.recheck();
  const owner=auth.remote.repository.full_name.split('/')[0],query=new URLSearchParams({state:'all',head:`${owner}:${artifact.remote_id}`,base:args.baseBranch,per_page:'100'});
  const pulls=z.array(z.object({number:z.number().int().positive(),html_url:z.string().url(),head:z.object({sha:gitSha,ref:z.string(),repo:z.object({id:z.number().int().safe()}).nullable()}),base:z.object({ref:z.string(),repo:z.object({id:z.number().int().safe()})})})).max(100).parse(await nativeJson(env,`${base}/pulls?${query}`,{headers},2097152));
  const repositoryId=auth.selection.repositoryId;
  const matching=pulls.filter(pr=>pr.head.sha===commit&&pr.head.ref===artifact.remote_id&&pr.base.ref===args.baseBranch&&String(pr.head.repo?.id)===repositoryId&&String(pr.base.repo.id)===repositoryId);
  if(matching.length!==1)fail(409,'outcome_unknown','A unique matching pull request was not found. Inspect the recorded branch and commit; no write was retried.');
  const pr=matching[0],result=await encrypt(env,JSON.stringify({operationId:row.id,userId:principal.userId,result:{repository:auth.remote.repository.full_name,branch:artifact.remote_id,commit,pullRequest:pr.number,url:pr.html_url,archiveSha256:artifact.content_hash}}));
  await auth.recheck();
  const update=await env.DB.prepare(`UPDATE connector_operations SET status='succeeded',revision=revision+1,error_code=NULL,encrypted_result=?,remote_ids_json=?,updated_at=? WHERE id=? AND user_id=? AND revision=? AND status='outcome_unknown' AND encrypted_arguments=? AND (${auth.guard.sql})`).bind(result,JSON.stringify([...ids.filter(id=>!id.startsWith('pr:')),`pr:${pr.number}`]),now(),row.id,principal.userId,revision,row.encrypted_arguments,...auth.guard.values).run();
  if(update.meta.changes!==1)fail(409,'revision_conflict','Operation changed during reconciliation.');
  return connectorOperationMetadata(await ownedOperation(env,principal.userId,row.id));
}
