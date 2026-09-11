import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { githubUserCredential,githubRepositoryToken,githubHeaders } from './github-auth';
import { nativeJson } from './native-transport';
import { fail } from '../security';
export async function listGithubRepositories(env:Bindings,principal:ConnectorPrincipal,connectionId:string,page:number){
  await assertActiveConnectorPrincipal(env,principal);
  const stored=await githubUserCredential(env,principal.userId,connectionId),installationId=stored.connection.remote_identity?.match(/^github:\d+:([1-9]\d*)$/)?.[1];
  if(!installationId)fail(409,'needs_reauthorization','Reconnect GitHub.');
  const result=z.object({repositories:z.array(z.object({id:z.number().int().positive().safe(),full_name:z.string().max(300),default_branch:z.string().max(200)})).max(100)}).parse(await nativeJson(env,`https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`,{headers:githubHeaders(stored.credential.accessToken)}));
  await assertActiveConnectorPrincipal(env,principal);
  const current=await githubUserCredential(env,principal.userId,connectionId);if(current.connection.revision!==stored.connection.revision||current.row.credential_version!==stored.row.credential_version)fail(409,'revision_conflict','GitHub access changed during discovery.');
  return {repositories:result.repositories.map(repo=>({repositoryId:String(repo.id),name:repo.full_name,defaultBranch:repo.default_branch})),nextPage:result.repositories.length===100&&page<10?page+1:null};
}
export async function resolveGithubRef(env:Bindings,principal:ConnectorPrincipal,connectionId:string,repositoryId:string,ref:string){
  await assertActiveConnectorPrincipal(env,principal);const remote=await githubRepositoryToken(env,principal.userId,connectionId,repositoryId);
  const result=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)}).parse(await nativeJson(env,`https://api.github.com/repos/${remote.repository.full_name}/commits/${encodeURIComponent(ref)}`,{headers:githubHeaders(remote.token)},2097152));
  await assertActiveConnectorPrincipal(env,principal);const current=await githubUserCredential(env,principal.userId,connectionId);
  if(current.connection.revision!==remote.stored.connection.revision||current.row.credential_version!==remote.stored.row.credential_version)fail(409,'revision_conflict','GitHub access changed during resolution.');
  return {repositoryId,ref,commit:result.sha};
}
