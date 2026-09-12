import { z } from 'zod';
import { communityEndpoints, communityEndpointPath, communitySchemas, type CommunityEndpoint } from '../shared/community-endpoints';
interface Tool {name:string;description:string;inputSchema:Record<string,unknown>;annotations?:Record<string,boolean>;execute:(args:Record<string,unknown>)=>Promise<unknown>}
interface Context {registerTool:(tool:Tool)=>void;unregisterTool?:(name:string)=>void}
const result=(value:unknown)=>({content:[{type:'text',text:JSON.stringify(value)}]});
export function registerCommunityBrowserTools(context:Context) {
  const tools:Tool[]=[{name:'studio_community_capabilities',description:'Discover full Community input schemas and operation inventory. Publish only after the person approves the preflight projection, disclosure and license.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:async()=>result({schemas:communitySchemas(),operations:communityEndpoints.map(({name,method,path,summary})=>({name,method,path,summary})),importLimitBytes:12*1024*1024})}];
  for(const endpoint of communityEndpoints as readonly CommunityEndpoint[]) {
    tools.push({name:`studio_community_${endpoint.name.replaceAll('-','_')}`,description:endpoint.summary+'. Discover full schemas with studio_community_capabilities.',annotations:{readOnlyHint:endpoint.method==='GET'},inputSchema:{type:'object',properties:{parameters:{type:'object',additionalProperties:{type:'string'}},query:{type:'object',additionalProperties:{type:'string'}},...(endpoint.body?{body:{type:'object'}}:{}),...(endpoint.upload?{operationId:{type:'string'},base64:{type:'string',maxLength:16*1024*1024}}:{})}},execute:async args=>{
      const path=communityEndpointPath(endpoint,args.parameters as Record<string,unknown>,args.query as Record<string,unknown>);
      // An opaque sandbox cannot inherit the page's session. Preview URLs must be
      // rendered by the app's sandboxed preview component, never navigated as HTML.
      if(endpoint.binary&&endpoint.path.endsWith('/preview'))return result({previewUrl:path,sandbox:'allow-scripts',requiresSameOriginFrame:true});
      let body:BodyInit|undefined;
      if(endpoint.upload){const input=z.object({operationId:z.string().min(1).max(120),base64:z.string().min(1).max(16*1024*1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}).parse(args);const bytes=Uint8Array.from(atob(input.base64),char=>char.charCodeAt(0));const form=new FormData();form.set('operationId',input.operationId);form.set('file',new Blob([bytes],{type:'application/zip'}),'design.zip');body=form;}
      else if(endpoint.body)body=JSON.stringify(endpoint.body.parse(args.body));
      const response=await fetch(path,{method:endpoint.method,credentials:'same-origin',headers:{'X-Studio-Client':'webmcp',...(!endpoint.upload&&body?{'Content-Type':'application/json'}:{})},body});
      if(response.headers.get('Content-Type')?.includes('json'))return {...result(await response.json()),...(!response.ok?{isError:true}:{})};
      if(!response.ok)throw new Error(`Community request failed: ${response.status}`);
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')??'')?.[1]??'community-design';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      return result({downloaded:true,bytes:blob.size,mimeType:blob.type,filename:a.download});
    }});
  }
  tools.forEach(tool=>context.registerTool(tool));
  return()=>tools.forEach(tool=>context.unregisterTool?.(tool.name));
}
