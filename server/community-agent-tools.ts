import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { communityEndpoints, communityEndpointPath, communitySchemas, type CommunityEndpoint } from '../src/shared/community-endpoints';
const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
const binaryLimit=12*1024*1024;
export function registerCommunityTools(server:McpServer,request:(method:string,path:string,body?:unknown)=>Promise<Response>) {
  server.registerTool('community_capabilities',{description:'Discover canonical Community schemas. Preflight is not consent: obtain explicit public/license confirmation before publishing. Binary transfers above 12 MiB use dsa community download/import.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>result({schemas:communitySchemas(),operations:communityEndpoints.map(({name,method,path,summary})=>({name,method,path,summary})),binaryLimitBytes:binaryLimit}));
  for(const endpoint of communityEndpoints as readonly CommunityEndpoint[]) {
    const parameters=Object.fromEntries([...endpoint.path.matchAll(/\{(\w+)\}/g)].map(match=>[match[1],z.string().min(1).max(200)]));
    const inputSchema={...parameters,...(endpoint.query?{query:endpoint.query.optional()}:{}),...(endpoint.body?{body:endpoint.body}:{}),...(endpoint.upload?{operationId:z.string().min(1).max(120),base64:z.string().min(1).max(16*1024*1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}:{})};
    server.registerTool(`community_${endpoint.name.replaceAll('-','_')}`,{description:endpoint.summary,inputSchema,annotations:{readOnlyHint:endpoint.method==='GET',...(endpoint.name==='unlist'?{destructiveHint:true}:{})}},async(args:Record<string,unknown>)=>{
      const path=communityEndpointPath(endpoint,args,args.query as Record<string,unknown>);
      let body:unknown=endpoint.body?.parse(args.body);
      if(endpoint.upload){const bytes=Buffer.from(String(args.base64),'base64');if(bytes.byteLength>binaryLimit)throw new Error('Use dsa community import for packages larger than 12 MiB.');const form=new FormData();form.set('operationId',String(args.operationId));form.set('file',new Blob([bytes],{type:'application/zip'}),'design.zip');body=form;}
      const response=await request(endpoint.method,path,body);
      if(response.headers.get('Content-Type')?.includes('json'))return {...result(await response.json()),...(!response.ok?{isError:true}:{})};
      if(!response.ok)return {isError:true,...result({error:{message:`Community request failed: ${response.status}`}})};
      const reader=response.body?.getReader();if(!reader)throw new Error('Community file has no response body.');
      const chunks:Uint8Array[]=[];let total=0;
      try{while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>binaryLimit){await reader.cancel();return {isError:true,...result({error:{code:'mcp_file_too_large',message:'Use dsa community download or preview --out for files larger than 12 MiB.'},path})};}chunks.push(chunk.value);}}finally{reader.releaseLock();}
      return {content:[{type:'resource' as const,resource:{uri:`studio://community${endpoint.path.replace(/\{(\w+)\}/g,(_,key)=>encodeURIComponent(String(args[key])))}`,mimeType:response.headers.get('Content-Type')??'application/octet-stream',blob:Buffer.concat(chunks).toString('base64')}}]};
    });
  }
}
