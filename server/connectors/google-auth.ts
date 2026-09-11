import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { ownedConnection,restartConnectionAuthorization } from '../connection-store';
import { createConnectorAuthState,consumeConnectorAuthState } from '../connector-auth-states';
import { readConnectorCredential,claimCredentialRefresh,finishCredentialRefresh,abandonCredentialRefresh,type ConnectorCredential } from '../connector-credentials';
import { activateNativeAuthorization } from './native-authorization';
import { nativeJson } from './native-transport';
import { fail,secret } from '../security';
const issuer='https://accounts.google.com',resource='https://www.googleapis.com/drive/v3';
export const googleDriveScope='https://www.googleapis.com/auth/drive.file';
const requestedScopes=['openid','email',googleDriveScope];
const tokenSchema=z.object({access_token:z.string().min(1).max(16384).refine(value=>!/[\r\n]/.test(value)),refresh_token:z.string().min(1).max(16384).optional(),token_type:z.string().refine(value=>value.toLowerCase()==='bearer'),expires_in:z.number().int().min(1).max(86400),scope:z.string().max(16000).optional()});
function settings(env:Bindings){
  const clientId=env.GOOGLE_CONNECTOR_CLIENT_ID,clientSecret=env.GOOGLE_CONNECTOR_CLIENT_SECRET;
  if(!clientId||!clientSecret||!env.APP_URL)fail(503,'connector_unconfigured','Configure the separate Google connector OAuth client.');
  const app=new URL(env.APP_URL);if(app.protocol!=='https:')fail(503,'connector_unconfigured','Google connector OAuth requires a canonical HTTPS app URL.');
  return {clientId,clientSecret,callback:app.origin+'/api/connectors/google-drive/callback'};
}
function scopes(value:string|undefined){
  const values=(value??'').split(' ').filter(Boolean);
  if(!values.includes(googleDriveScope))fail(403,'missing_scope','Google did not grant access to selected Drive files.');
  const allowed=new Set([...requestedScopes,'https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile']);
  if(values.some(scope=>!allowed.has(scope)))fail(403,'unsupported_scope','Use a dedicated Google connector client with only selected-file access.');
  return values;
}
export async function startGoogleAuthorization(env:Bindings,principal:ConnectorPrincipal,connectionId:string,revision:number){
  if(principal.kind!=='session')fail(403,'human_action_required','Sign in to connect Google Drive.');
  await assertActiveConnectorPrincipal(env,principal);
  const config=settings(env),connection=await ownedConnection(env,principal.userId,connectionId);
  if(connection.adapter!=='google-drive'||connection.revision!==revision)fail(409,'revision_conflict','Reload the Google connection.');
  const restarted=await restartConnectionAuthorization(env,principal.userId,connectionId,revision),verifier=secret();
  const state=await createConnectorAuthState(env,principal,connectionId,restarted.revision,{issuer,resource,callback:config.callback,verifier});
  const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',scope:requestedScopes.join(' '),access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return {authorizationUrl:url.href,connectionId,revision:restarted.revision};
}
export async function finishGoogleAuthorization(env:Bindings,principal:ConnectorPrincipal,input:{state:string;code?:string;error?:string}){
  const config=settings(env),state=await consumeConnectorAuthState(env,principal,input.state,'google-drive');
  if(input.error)fail(400,'authorization_denied','Google authorization was denied.');
  if(state.issuer!==issuer||state.resource!==resource||state.callback!==config.callback||!input.code||input.code.length>4096)fail(400,'invalid_callback','Google callback does not match its saved authorization.');
  const tokens=tokenSchema.parse(await nativeJson(env,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:input.code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.callback,code_verifier:state.verifier})}));
  const granted=scopes(tokens.scope);
  if(!tokens.refresh_token)fail(409,'needs_reauthorization','Google did not provide offline access. Reconnect and grant consent.');
  const account=z.object({sub:z.string().regex(/^[0-9]{1,128}$/)}).parse(await nativeJson(env,'https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`}}));
  const credential:ConnectorCredential={accessToken:tokens.access_token,refreshToken:tokens.refresh_token,tokenType:'Bearer',issuer,resource,clientId:config.clientId,clientSecret:config.clientSecret};
  return activateNativeAuthorization(env,principal,state.connectionId,state.connectionRevision,'google-drive',`google:${account.sub}`,granted,credential,Date.now()+tokens.expires_in*1000);
}
/** Call only after current principal/binding authorization. A rotating refresh is never retried after uncertainty. */
export async function googleCredential(env:Bindings,userId:string,connectionId:string){
  let stored=await readConnectorCredential(env,userId,connectionId);
  if(stored.connection.adapter!=='google-drive'||stored.connection.status!=='connected'||stored.credential.resource!==resource||stored.credential.issuer!==issuer)fail(409,'needs_reauthorization','Reconnect this Google account.');
  if(stored.row.refresh_lease_id)fail(409,'refresh_in_progress','Google access is refreshing. Reload its status.');
  if(stored.row.expires_at!==null&&stored.row.expires_at>Date.now()+60000)return stored;
  const credential=stored.credential;
  if(!credential.refreshToken||!credential.clientId||!credential.clientSecret)fail(409,'needs_reauthorization','Reconnect Google offline access.');
  const lease=await claimCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version);
  try{
    const tokens=tokenSchema.parse(await nativeJson(env,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credential.refreshToken,client_id:credential.clientId,client_secret:credential.clientSecret})}));
    if(tokens.scope)scopes(tokens.scope);
    await finishCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version,lease,{...credential,accessToken:tokens.access_token,refreshToken:tokens.refresh_token??credential.refreshToken},Date.now()+tokens.expires_in*1000);
  }catch(error){await abandonCredentialRefresh(env,userId,connectionId,stored.connection.revision,stored.row.credential_version,lease);throw error;}
  stored=await readConnectorCredential(env,userId,connectionId);return stored;
}
