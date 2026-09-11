import { z } from 'zod';
import { createPrivateKey,sign } from 'node:crypto';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { ownedConnection,restartConnectionAuthorization } from '../connection-store';
import { createConnectorAuthState,consumeConnectorAuthState } from '../connector-auth-states';
import { activateNativeAuthorization } from './native-authorization';
import { readConnectorCredential,claimCredentialRefresh,finishCredentialRefresh,abandonCredentialRefresh } from '../connector-credentials';
import { nativeJson } from './native-transport';
import { fail,secret } from '../security';
const numeric=z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value=>Number.isSafeInteger(Number(value)));
const tokens=z.object({access_token:z.string().min(1).max(16384),refresh_token:z.string().max(16384).optional(),expires_in:z.number().int().positive().max(28800).optional(),token_type:z.string().refine(value=>value.toLowerCase()==='bearer')});
export function githubHeaders(token:string){return {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Design-Studio-AI'};}
function settings(env:Bindings){
  if(!env.GITHUB_CONNECTOR_CLIENT_ID||!env.GITHUB_CONNECTOR_CLIENT_SECRET||!env.GITHUB_CONNECTOR_APP_ID||!env.GITHUB_CONNECTOR_PRIVATE_KEY||!env.APP_URL)fail(503,'connector_unconfigured','Configure the separate GitHub connector App.');
  const app=new URL(env.APP_URL);if(app.protocol!=='https:')fail(503,'connector_unconfigured','GitHub connector requires a canonical HTTPS application URL.');
  return {id:env.GITHUB_CONNECTOR_CLIENT_ID,secret:env.GITHUB_CONNECTOR_CLIENT_SECRET,appId:numeric.parse(env.GITHUB_CONNECTOR_APP_ID),key:env.GITHUB_CONNECTOR_PRIVATE_KEY,callback:app.origin+'/api/connectors/github/callback'};
}
export async function startGithubAuthorization(env:Bindings,principal:ConnectorPrincipal,connectionId:string,revision:number,installationId:string){
  if(principal.kind!=='session')fail(403,'human_action_required','Sign in to connect GitHub.');
  await assertActiveConnectorPrincipal(env,principal);const config=settings(env),connection=await ownedConnection(env,principal.userId,connectionId);
  if(connection.adapter!=='github'||connection.revision!==revision)fail(409,'revision_conflict','Reload the GitHub connection.');
  const restarted=await restartConnectionAuthorization(env,principal.userId,connectionId,revision),verifier=secret();
  const state=await createConnectorAuthState(env,principal,connectionId,restarted.revision,{issuer:'https://github.com',resource:`https://api.github.com/user/installations/${numeric.parse(installationId)}`,callback:config.callback,verifier});
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  return {connectionId,revision:restarted.revision,authorizationUrl:'https://github.com/login/oauth/authorize?'+new URLSearchParams({client_id:config.id,redirect_uri:config.callback,state,code_challenge:challenge,code_challenge_method:'S256'}).toString()};
}
export async function finishGithubAuthorization(env:Bindings,principal:ConnectorPrincipal,input:{state:string;code?:string;error?:string}){
  const config=settings(env),state=await consumeConnectorAuthState(env,principal,input.state,'github');
  const installationId=state.resource.match(/^https:\/\/api.github.com\/user\/installations\/([1-9][0-9]{0,15})$/)?.[1];
  if(input.error)fail(400,'authorization_denied','GitHub authorization was denied.');
  if(!installationId||state.issuer!=='https://github.com'||state.callback!==config.callback||!input.code||input.code.length>4096)fail(400,'invalid_callback','GitHub callback does not match its authorization.');
  const token=tokens.parse(await nativeJson(env,'https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.id,client_secret:config.secret,code:input.code,redirect_uri:config.callback,code_verifier:state.verifier})}));
  const user=z.object({id:z.number().int().positive().safe()}).parse(await nativeJson(env,'https://api.github.com/user',{headers:githubHeaders(token.access_token)}));
  let verified=false;
  for(let page=1;page<=10;page++){
    const result=z.object({installations:z.array(z.object({id:z.number().int().safe(),app_id:z.number().int().safe(),suspended_at:z.string().nullable()})).max(100)}).parse(await nativeJson(env,`https://api.github.com/user/installations?per_page=100&page=${page}`,{headers:githubHeaders(token.access_token)}));
    verified=result.installations.some(item=>String(item.id)===installationId&&String(item.app_id)===config.appId&&item.suspended_at===null);if(verified||result.installations.length<100)break;
  }
  if(!verified)fail(403,'missing_grant','This GitHub user cannot access the selected installation of this App.');
  return activateNativeAuthorization(env,principal,state.connectionId,state.connectionRevision,'github',`github:${user.id}:${installationId}`,['installation:selected'],{accessToken:token.access_token,refreshToken:token.refresh_token,tokenType:'Bearer',issuer:'https://github.com',resource:state.resource,clientId:config.id,clientSecret:config.secret},Date.now()+(token.expires_in??28800)*1000);
}
export async function githubUserCredential(env:Bindings,userId:string,connectionId:string){
  let stored=await readConnectorCredential(env,userId,connectionId);
  if(stored.connection.adapter!=='github'||stored.connection.status!=='connected'||stored.credential.issuer!=='https://github.com')fail(409,'needs_reauthorization','Reconnect this GitHub App.');
  if(stored.row.refresh_lease_id)fail(409,'refresh_in_progress','GitHub authorization is refreshing.');
  if(stored.row.expires_at&&stored.row.expires_at>Date.now()+60000)return stored;
  if(!stored.credential.refreshToken)fail(409,'needs_reauthorization','Reconnect expired GitHub access.');
  const lease=await claimCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version);
  try{
    const config=settings(env),token=tokens.parse(await nativeJson(env,'https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:stored.credential.refreshToken,client_id:config.id,client_secret:config.secret})}));
    await finishCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version,lease,{...stored.credential,accessToken:token.access_token,refreshToken:token.refresh_token??stored.credential.refreshToken},Date.now()+(token.expires_in??28800)*1000);
  }catch(error){await abandonCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version,lease);throw error;}
  return readConnectorCredential(env,userId,connectionId);
}
/** User repository access is checked before minting an installation token scoped to one repository. */
export async function githubRepositoryToken(env:Bindings,userId:string,connectionId:string,repositoryId:string,write=false){
  const stored=await githubUserCredential(env,userId,connectionId),config=settings(env);
  const installationId=stored.connection.remote_identity?.match(/^github:\d+:([1-9]\d*)$/)?.[1];if(!installationId)fail(409,'needs_reauthorization','Reconnect the selected GitHub installation.');
  numeric.parse(repositoryId);let repository:{id:number;full_name:string;default_branch:string;permissions?:{push?:boolean}}|undefined;
  for(let page=1;page<=10;page++){
    const result=z.object({repositories:z.array(z.object({id:z.number().int().safe(),full_name:z.string().regex(/^[\w.-]+\/[\w.-]+$/),default_branch:z.string().max(1024),permissions:z.object({push:z.boolean().optional()}).optional()})).max(100)}).parse(await nativeJson(env,`https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`,{headers:githubHeaders(stored.credential.accessToken)}));
    repository=result.repositories.find(item=>String(item.id)===repositoryId);if(repository||result.repositories.length<100)break;
  }
  if(!repository||write&&repository.permissions?.push!==true)fail(403,'missing_grant','The signed-in GitHub user cannot access this repository with the required permissions.');
  const now=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:config.appId});
  let jwt:string;try{jwt=payload+'.'+sign('RSA-SHA256',Buffer.from(payload),createPrivateKey(config.key)).toString('base64url');}catch{fail(503,'connector_unconfigured','GitHub App signing key could not be used.');}
  const token=z.object({token:z.string().min(1),expires_at:z.string(),permissions:z.object({contents:z.enum(['read','write']),pull_requests:z.enum(['read','write']).optional()})}).parse(await nativeJson(env,`https://api.github.com/app/installations/${installationId}/access_tokens`,{method:'POST',headers:githubHeaders(jwt!),body:JSON.stringify({repository_ids:[Number(repositoryId)],permissions:{contents:write?'write':'read',...(write?{pull_requests:'write'}:{})}})}));
  if(!Number.isFinite(Date.parse(token.expires_at))||Date.parse(token.expires_at)<=Date.now()||write&&(token.permissions.contents!=='write'||token.permissions.pull_requests!=='write'))fail(403,'missing_grant','GitHub did not grant the requested repository permission.');
  return {repository,token:token.token,stored};
}
