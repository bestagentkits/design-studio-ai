import { mcpAuthorizationOptionsSchema } from '../../src/shared/connector-management';
import { z } from 'zod';
import { discoverOAuthServerInfo, startAuthorization, exchangeAuthorization, refreshAuthorization, registerClient, type OAuthTokens, type OAuthClientInformationMixed } from '@modelcontextprotocol/client';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { assertActiveConnectorPrincipal } from '../connection-policy';
import { ownedConnection, restartConnectionAuthorization } from '../connection-store';
import { createConnectorAuthState, consumeConnectorAuthState } from '../connector-auth-states';
import { readConnectorCredential, claimCredentialRefresh, finishCredentialRefresh, abandonCredentialRefresh, type ConnectorCredential } from '../connector-credentials';
import { fail, hash } from '../security';
import { validateConnectorUrl } from '../connector-network-policy';
import { mcpResourceMatchesEndpoint } from './mcp-auth-resource';
import { withMcpAuthFetch } from './mcp-auth-transport';
import { sealMcpContext, openMcpContext, storeMcpAuthorization, type McpAuthContext } from './mcp-auth-context';

export { mcpAuthorizationOptionsSchema } from '../../src/shared/connector-management';
export type McpAuthorizationOptions = z.input<typeof mcpAuthorizationOptionsSchema>;
function publicUrl(value:string) { try { return validateConnectorUrl(value).href; } catch { return fail(400,'unsafe_destination','OAuth requires a public HTTPS destination.'); } }
function tokensToCredential(tokens:OAuthTokens,context:McpAuthContext) {
  if (tokens.token_type.toLowerCase() !== 'bearer' || !tokens.access_token || tokens.access_token.length>16384 || /[\r\n]/.test(tokens.access_token)
    || (tokens.refresh_token !== undefined && (!tokens.refresh_token || tokens.refresh_token.length>16384))) fail(400,'invalid_credentials','OAuth returned unsupported credentials.');
  const expiresAt = tokens.expires_in === undefined ? null : Date.now()+tokens.expires_in*1000;
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt<=Date.now())) fail(400,'invalid_expiry','OAuth returned an invalid expiry.');
  const credential:ConnectorCredential = {accessToken:tokens.access_token,tokenType:'Bearer',resource:context.resource,issuer:context.issuer,clientId:context.client.client_id,
    ...(tokens.refresh_token ? {refreshToken:tokens.refresh_token}:{}),...(context.client.client_secret ? {clientSecret:context.client.client_secret}:{})};
  return {credential,expiresAt};
}
function checkClient(client:OAuthClientInformationMixed,context:McpAuthContext) {
  const method=('token_endpoint_auth_method' in client ? client.token_endpoint_auth_method : undefined) ?? (client.client_secret ? 'client_secret_basic':'none');
  if (!['none','client_secret_basic','client_secret_post'].includes(method) || !client.client_id || client.client_id.length>2048 || (client.client_secret?.length ?? 0)>16384
    || (method!=='none' && !client.client_secret) || (method==='none' && client.client_secret)
    || (context.metadata.token_endpoint_auth_methods_supported && !context.metadata.token_endpoint_auth_methods_supported.includes(method))) fail(400,'unsupported_auth','OAuth client authentication is unsupported.');
}
/** Human setup only. Discovery never sends credentials and all SDK HTTP uses the guarded transport. */
export async function startMcpAuthorization(env:Bindings,principal:ConnectorPrincipal,connectionId:string,expectedRevision:number,input:McpAuthorizationOptions) {
  if (principal.kind!=='session') fail(403,'human_action_required','A signed-in person must authorize this connection.');
  await assertActiveConnectorPrincipal(env,principal);
  const options=mcpAuthorizationOptionsSchema.parse(input), connection=await ownedConnection(env,principal.userId,connectionId);
  if (connection.adapter!=='mcp' || connection.auth_mode!=='oauth' || !connection.endpoint) fail(400,'unsupported_auth','An OAuth MCP connection is required.');
  if(connection.revision!==expectedRevision) fail(409,'revision_conflict','Connection changed.');
  let callback:string; try { callback=new URL(env.APP_URL!).origin+'/api/connectors/mcp/callback'; } catch { return fail(503,'connector_unconfigured','Application URL is unavailable.'); }
  const endpoint=publicUrl(connection.endpoint);
  return withMcpAuthFetch(env,async fetchFn=>{
    const info=await discoverOAuthServerInfo(endpoint,{fetchFn}), metadata=info.authorizationServerMetadata;
    if (!metadata || metadata.issuer!==info.authorizationServerUrl || (options.profile==='modern' && !info.resourceMetadata)) fail(400,'unsupported_auth','Verified OAuth metadata is required.');
    const issuer=publicUrl(metadata.issuer), resource=publicUrl(info.resourceMetadata?.resource ?? endpoint);
    if (issuer!==metadata.issuer || !mcpResourceMatchesEndpoint(resource,endpoint)) fail(400,'resource_mismatch','OAuth metadata does not match the configured resource.');
    publicUrl(metadata.authorization_endpoint); publicUrl(metadata.token_endpoint);
    let client:OAuthClientInformationMixed;
    if(options.client && options.clientMetadataUrl) fail(400,'invalid_input','Select one OAuth client registration.');
    if(options.client) client={client_id:options.client.clientId,...(options.client.clientSecret?{client_secret:options.client.clientSecret}:{}),token_endpoint_auth_method:options.client.authMethod};
    else if(options.clientMetadataUrl) {
      const url=publicUrl(options.clientMetadataUrl);
      if(new URL(url).origin!==new URL(callback).origin || !metadata.client_id_metadata_document_supported) fail(400,'unsupported_auth','This server does not support the application client metadata document.');
      client={client_id:url,token_endpoint_auth_method:'none'};
    } else {
      if(options.profile!=='legacy' || !metadata.registration_endpoint) fail(400,'client_registration_required','Provide an OAuth client registration or supported metadata document.');
      publicUrl(metadata.registration_endpoint);
      client=await registerClient(issuer,{metadata,clientMetadata:{client_name:'Design Studio AI',redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},scope:options.scope,fetchFn});
    }
    const context:McpAuthContext={issuer,resource,endpoint,metadata,client,profile:options.profile,...(options.scope?{scope:options.scope}:{})}; checkClient(client,context);
    const authorization=await startAuthorization(issuer,{metadata,clientInformation:client,redirectUrl:callback,scope:options.scope,resource:new URL(resource)});
    await assertActiveConnectorPrincipal(env,principal);
    const restarted=await restartConnectionAuthorization(env,principal.userId,connectionId,expectedRevision);
    const state=await createConnectorAuthState(env,principal,connectionId,restarted.revision,{issuer,resource,callback,verifier:authorization.codeVerifier});
    const stateHash=await hash(state), encrypted=await sealMcpContext(env,principal.userId,connectionId,context,stateHash);
    await env.DB.prepare('INSERT INTO connection_mcp_oauth_setups(state_hash,encrypted_context) VALUES(?,?)').bind(stateHash,encrypted).run();
    authorization.authorizationUrl.searchParams.set('state',state);
    return {authorizationUrl:authorization.authorizationUrl.href,connectionId,revision:restarted.revision};
  });
}
export async function finishMcpAuthorization(env:Bindings,principal:ConnectorPrincipal,input:{state:string;code?:string;issuer?:string;denial?:string}) {
  const state=await consumeConnectorAuthState(env,principal,input.state,'mcp'), stateHash=await hash(input.state);
  const row=await env.DB.prepare('DELETE FROM connection_mcp_oauth_setups WHERE state_hash=? RETURNING encrypted_context').bind(stateHash).first<{encrypted_context:string}>();
  if(!row) fail(400,'invalid_state','OAuth setup is unavailable.');
  const context=await openMcpContext(env,principal.userId,state.connectionId,row.encrypted_context,stateHash);
  if(input.denial) fail(400,'authorization_denied','Authorization was denied.');
  if(!input.code || input.code.length>4096 || context.issuer!==state.issuer || context.resource!==state.resource || (input.issuer!==undefined && input.issuer!==context.issuer)) fail(400,'invalid_callback','OAuth callback does not match its authorization.');
  return withMcpAuthFetch(env,async fetchFn=>{
    const tokens=await exchangeAuthorization(context.issuer,{metadata:context.metadata,clientInformation:context.client,authorizationCode:input.code!,iss:input.issuer,codeVerifier:state.verifier,redirectUri:state.callback,resource:new URL(context.resource),fetchFn});
    const {credential,expiresAt}=tokensToCredential(tokens,context);
    const scopes=z.array(z.string().min(1).max(300)).max(100).parse((tokens.scope ?? context.scope ?? '').split(' ').filter(Boolean));
    const credentialVersion=await storeMcpAuthorization(env,principal.userId,state.connectionId,state.connectionRevision,credential,expiresAt,context,principal.kind==='session' ? principal.sessionId : '');
    return {connectionId:state.connectionId,expectedRevision:state.connectionRevision,credentialVersion,issuer:context.issuer,resource:context.resource,remoteIdentity:null,scopes,authorizationVerified:true as const};
  });
}
/** Trusted service call after binding authorization; no retry after a potentially rotating request. */
export async function refreshMcpAuthorization(env:Bindings,userId:string,connectionId:string,expectedRevision:number) {
  const {row,credential,connection}=await readConnectorCredential(env,userId,connectionId);
  const stored=await env.DB.prepare('SELECT encrypted_context FROM connection_mcp_oauth_clients WHERE connection_id=? AND user_id=?').bind(connectionId,userId).first<{encrypted_context:string}>();
  if(!stored || !credential.refreshToken || connection.adapter!=='mcp' || connection.auth_mode!=='oauth') fail(409,'needs_reauthorization','Restart OAuth authorization.');
  const context=await openMcpContext(env,userId,connectionId,stored.encrypted_context);
  if(context.endpoint!==publicUrl(connection.endpoint ?? '') || context.resource!==credential.resource || context.issuer!==credential.issuer || context.client.client_id!==credential.clientId || context.client.client_secret!==credential.clientSecret) fail(409,'needs_reauthorization','OAuth credential context changed.');
  const lease=await claimCredentialRefresh(env,userId,connectionId,expectedRevision,row.credential_version);
  try {
    const tokens=await withMcpAuthFetch(env,fetchFn=>refreshAuthorization(context.issuer,{metadata:context.metadata,clientInformation:context.client,refreshToken:credential.refreshToken!,resource:new URL(context.resource),fetchFn}));
    // A server may renew access without rotating its refresh token.
    const next=tokensToCredential({...tokens,refresh_token:tokens.refresh_token ?? credential.refreshToken},context);
    await finishCredentialRefresh(env,userId,connectionId,expectedRevision,row.credential_version,lease,next.credential,next.expiresAt);
  } catch(error) { await abandonCredentialRefresh(env,userId,connectionId,expectedRevision,row.credential_version,lease); throw error; }
}
