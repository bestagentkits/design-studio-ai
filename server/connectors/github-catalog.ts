import { githubExportTool } from './github-export';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { connectorBindingAuthority } from '../connector-binding-authority';
import { githubRepositoryToken } from './github-auth';
import { connectorVersionPinsSchema } from '../../src/shared/connector-operations';
import { connectorFingerprint } from '../connector-fingerprints';
import { fail } from '../security';
export async function githubBindingAuthority(env:Bindings,principal:ConnectorPrincipal,bindingId:string,capability:'discover'|'prepare_write',projectId?:string){
  const initial=await connectorBindingAuthority(env,principal,bindingId,capability,undefined,projectId,'github');
  if(initial.selection.adapter!=='github')fail(403,'missing_grant','Select a repository binding.');
  const remote=await githubRepositoryToken(env,principal.userId,initial.connection.id,initial.selection.repositoryId,capability==='prepare_write');
  await initial.recheck();return {...initial,remote};
}
export async function discoverGithubCatalog(env:Bindings,principal:ConnectorPrincipal,bindingId:string){
  const auth=await githubBindingAuthority(env,principal,bindingId,'discover');
  if(auth.selection.adapter!=='github')fail(403,'missing_grant','Select a repository binding.');
  const project=await env.DB.prepare('SELECT revision FROM projects WHERE id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  const brief=await env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  await auth.recheck();
  const catalog={tools:auth.binding.role==='destination'?[{...await githubExportTool(auth.connection.id),schemaSupported:true,id:'create_react_pull_request'}]:[],resources:auth.selection.paths.map(path=>({uri:path,name:path,commit:auth.selection.adapter==='github'?auth.selection.commit:''})),templates:[]};
  return {...catalog,versions:connectorVersionPinsSchema.parse({connectionRevision:auth.connection.revision,credentialVersion:auth.remote.stored.row.credential_version,policyRevision:auth.binding.policy_revision,documentRevision:project?.revision,briefRevision:brief?.revision??0,sourceSnapshotIds:[]}),fingerprint:await connectorFingerprint(catalog)};
}
