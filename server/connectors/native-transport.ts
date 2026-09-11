import type { Bindings } from '../types';
import { limitedBytes } from '../providers';
import { fail } from '../security';
const origins=new Set(['https://oauth2.googleapis.com','https://openidconnect.googleapis.com','https://www.googleapis.com','https://slides.googleapis.com','https://api.github.com','https://github.com']);
/** Native adapters choose fixed provider endpoints; remote responses never supply follow-up URLs. */
export async function nativeRequest(env:Bindings,url:string,init:RequestInit={}){
  const target=new URL(url);
  if(!origins.has(target.origin)||target.username||target.password||target.hash)fail(400,'unsafe_destination','Native connector endpoint is not allowed.');
  if(!env.CONNECTOR_FETCH)fail(503,'connector_unconfigured','Connector transport is unavailable.');
  const response=await env.CONNECTOR_FETCH(target,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'unsafe_destination','Provider redirects are not accepted.');}
  if(!response.ok){await response.body?.cancel();fail(response.status===401||response.status===403?409:502,response.status===401||response.status===403?'needs_reauthorization':'provider_error',`The provider returned HTTP ${response.status}.`);}
  return response;
}
export async function nativeJson(env:Bindings,url:string,init:RequestInit={},limit=262144){
  const response=await nativeRequest(env,url,init);
  try{return JSON.parse(new TextDecoder().decode(await limitedBytes(response,limit))) as unknown;}
  catch{fail(502,'invalid_provider_response','The provider response could not be read.');}
}
