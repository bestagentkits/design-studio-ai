import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { authorizeConnectorBinding } from '../connection-policy';
import { connectorBindingAuthority } from '../connector-binding-authority';
import { githubHeaders,githubRepositoryToken } from './github-auth';
import { nativeJson } from './native-transport';
import { importProjectSource } from '../project-sources';
import { z } from 'zod';
import { fail } from '../security';
export function githubSourcePath(path:string){
  if(path.length>1024||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'||/^\.env(?:\.|$)|^\.git$|^\.ssh$|^\.npmrc$|^id_(?:rsa|ed25519|ecdsa)$|^credentials?$|^secrets?$/i.test(part))||/\.(pem|key|p12|pfx)$/i.test(path))fail(400,'unsafe_source','Choose an explicit non-secret repository file.');
  return path;
}
export async function importGithubSource(env:Bindings,principal:ConnectorPrincipal,projectId:string,bindingId:string,path:string){
  githubSourcePath(path);const selected=await authorizeConnectorBinding(env,principal,bindingId,'read_source',path);
  if(selected.binding.project_id!==projectId||selected.selection.adapter!=='github')fail(403,'missing_grant','Choose an authorized repository source.');
  const remote=await githubRepositoryToken(env,principal.userId,selected.connection.id,selected.selection.repositoryId);
  const auth=await connectorBindingAuthority(env,principal,bindingId,'read_source',path,projectId,'github');
  if(auth.selection.adapter!=='github'||auth.connection.revision!==selected.connection.revision||auth.binding.policy_revision!==selected.binding.policy_revision||auth.binding.selection_json!==selected.binding.selection_json||remote.stored.connection.revision!==auth.connection.revision)fail(409,'revision_conflict','Repository selection changed.');
  const {commit,repositoryId}=auth.selection,base=`https://api.github.com/repos/${remote.repository.full_name}`;
  await auth.recheck();
  const pinned=z.object({sha:z.literal(commit),tree:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)})}).parse(await nativeJson(env,`${base}/git/commits/${commit}`,{headers:githubHeaders(remote.token)}));
  let treeSha=pinned.tree.sha,expectedBlob='';const segments=path.split('/');
  for(let index=0;index<segments.length;index++){
    await auth.recheck();
    const tree=z.object({truncated:z.literal(false),tree:z.array(z.object({path:z.string(),mode:z.string(),type:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/)})).max(10000)}).parse(await nativeJson(env,`${base}/git/trees/${treeSha}`,{headers:githubHeaders(remote.token)},1048576));
    const entry=tree.tree.find(item=>item.path===segments[index]);if(!entry)fail(404,'source_unavailable','Selected repository path is unavailable.');
    if(index<segments.length-1){if(entry.type!=='tree'||entry.mode!=='040000')fail(422,'unsupported_content','Repository links and submodules are not followed.');treeSha=entry.sha;}
    else{if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode))fail(422,'unsupported_content','Repository links and submodules are not followed.');expectedBlob=entry.sha;}
  }
  const file=z.object({type:z.literal('file'),path:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/),encoding:z.literal('base64'),size:z.number().int().min(0).max(1048576),content:z.string().max(1500000),submodule_git_url:z.unknown().optional(),target:z.unknown().optional()}).parse(await nativeJson(env,`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`,{headers:githubHeaders(remote.token)},1600000));
  if(file.sha!==expectedBlob||file.path!==path||file.submodule_git_url||file.target)fail(422,'unsupported_content','Symlinks and submodules are not followed.');
  const bytes=new Uint8Array(Buffer.from(file.content.replace(/\s/g,''),'base64'));
  if(bytes.length!==file.size)fail(502,'invalid_provider_response','Repository file size does not match its response.');
  const blob=new Uint8Array(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),Buffer.from(bytes)]));
  const sha=Buffer.from(await crypto.subtle.digest('SHA-1',blob)).toString('hex');if(sha!==file.sha)fail(502,'invalid_provider_response','Repository blob integrity check failed.');
  const imageType:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'},mime=imageType[path.split('.').pop()?.toLowerCase()??''];
  if(!mime){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(422,'unsupported_content','Choose a UTF-8 source file.');}
  if(bytes.includes(0))fail(422,'unsupported_content','Binary repository content is not supported by text import.');}
  await auth.recheck();
  return importProjectSource(env,principal,projectId,bindingId,{selection:{adapter:'github',repositoryId,commit,paths:[path]},remoteIdentity:path,remoteVersion:`${commit}:${file.sha}`,mimeType:mime??(path.endsWith('.json')?'application/json':/\.md(?:own)?$/i.test(path)?'text/markdown':'text/plain'),extractionVersion:mime?'github-image-v1':'github-utf8-v1',bytes},auth.guard);
}
