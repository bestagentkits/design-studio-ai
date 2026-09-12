import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { communityEndpoints, communityEndpointPath, communitySchemas, type CommunityEndpoint } from '../src/shared/community-endpoints';
import { registerCommunityTools } from '../server/community-agent-tools';
import { registerCommunityBrowserTools } from '../src/app/browser-community-tools';
import { registerCommunityCommands } from '../packages/cli/src/community-commands';
import { Client } from '../packages/cli/src/client';
import { buildCommunityPackage, readCommunityPackage } from '../src/shared/community-package';
import { createDocument } from '../src/shared/catalog';

type BrowserTool = Parameters<Parameters<typeof registerCommunityBrowserTools>[0]['registerTool']>[0];
function browserTools() {
  const tools = new Map<string,BrowserTool>();
  const unregister = registerCommunityBrowserTools({registerTool:tool=>tools.set(tool.name,tool),unregisterTool:name=>{tools.delete(name);}});
  return {tools,unregister};
}
const content = (result: unknown) => JSON.parse((result as {content:{text:string}[]}).content[0].text);
const publishBody = {projectId:'project',expectedProjectRevision:1,title:'Design',description:'',tags:[],formats:[],operationId:'publish-op',digest:'a'.repeat(64),license:'CC-BY-4.0',acceptLicense:true,confirmPublic:true};
// The published inventory must stay pinned to these exact named operations, not to a recomputed map.
const expectedCommunitySchemaKeys=['POST /api/community/preflight','POST /api/community/listings','POST /api/community/listings/{id}/releases','POST /api/community/listings/{id}/unlist','POST /api/community/listings/{id}/remix','PUT /api/community/me/profile','POST /api/community/me/profile/generate','POST /api/community/metadata/generate','POST /api/community/listings/{id}/reports','POST /api/community/moderation/reports/{id}/resolve','POST /api/community/moderation/collections','PUT /api/community/moderation/collections/{id}'];
function pinCapabilitySchemas(schemas:Record<string,{type?:string;required?:string[];additionalProperties?:boolean;properties?:Record<string,unknown>}>) {
  assert.deepEqual(Object.keys(schemas).sort(),[...expectedCommunitySchemaKeys].sort());
  const publish=schemas['POST /api/community/listings'];
  assert.equal(publish.type,'object');assert.equal(publish.additionalProperties,false);
  for(const field of ['projectId','expectedProjectRevision','title','operationId','digest','license','acceptLicense','confirmPublic']) assert.ok(publish.required?.includes(field),`publish schema must require ${field}`);
  assert.equal(publish.required?.includes('description'),false,'defaulted presentation fields stay optional');
  const preflight=schemas['POST /api/community/preflight'];
  assert.equal(preflight.additionalProperties,false);
  for(const field of ['projectId','expectedProjectRevision','title']) assert.ok(preflight.required?.includes(field),`preflight schema must require ${field}`);
}

test('WebMCP discovers every shared endpoint with compact metadata and exact canonical request schemas', async () => {
  const {tools,unregister}=browserTools();
  const metadata=[...tools.values()].map(({execute,...tool})=>tool);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata))<32000);
  for(const tool of metadata) assert.ok(Buffer.byteLength(JSON.stringify(tool))<4096,tool.name);
  assert.equal(tools.size,communityEndpoints.length+1);
  const capabilities=content(await tools.get('studio_community_capabilities')!.execute({}));
  pinCapabilitySchemas(capabilities.schemas); assert.equal(capabilities.importLimitBytes,12*1024*1024);
  for(const endpoint of communityEndpoints) {
    const tool=tools.get(`studio_community_${endpoint.name.replaceAll('-','_')}`)!;
    assert.ok(tool,endpoint.name); assert.equal(tool.annotations?.readOnlyHint,endpoint.method==='GET');
    assert.ok(!/auth|token|provider/i.test(tool.name));
  }
  unregister(); assert.equal(tools.size,0);
});

test('WebMCP validates consent, revisions, nested formats, query scope and imports before transport', async t => {
  const {tools,unregister}=browserTools(), calls:{path:string;init?:RequestInit}[]=[];
  t.mock.method(globalThis,'fetch',async(path:string,init?:RequestInit)=>{calls.push({path,init});return Response.json({ok:true});});
  const publish=tools.get('studio_community_publish')!;
  for(const body of [{...publishBody,confirmPublic:false},{...publishBody,acceptLicense:false},{...publishBody,expectedProjectRevision:0},{...publishBody,formats:[{format:'fake'}]}]) await assert.rejects(publish.execute({body}));
  const missingRequired:Record<string,unknown>={...publishBody};delete missingRequired.projectId;
  await assert.rejects(publish.execute({body:missingRequired}));
  await assert.rejects(publish.execute({body:{...publishBody,unexpectedField:true}}));
  const search=tools.get('studio_community_search')!;
  await assert.rejects(search.execute({query:{q:'x'.repeat(201)}}));
  await assert.rejects(search.execute({query:{privateProjectId:'private'}}));
  await assert.rejects(tools.get('studio_community_import')!.execute({operationId:'import-op',base64:'not-valid!'}));
  await assert.rejects(tools.get('studio_community_import')!.execute({operationId:'import-op',base64:'A'.repeat(16*1024*1024+4)}));
  assert.equal(calls.length,0);
  await publish.execute({body:publishBody});
  assert.equal(calls[0].path,'/api/community/listings'); assert.equal(calls[0].init?.method,'POST'); assert.equal(calls[0].init?.credentials,'same-origin');
  assert.equal(new Headers(calls[0].init?.headers).get('X-Studio-Client'),'webmcp');
  const posted=JSON.parse(String(calls[0].init?.body)); assert.equal(posted.confirmPublic,true); assert.equal(posted.expectedProjectRevision,1);
  await search.execute({query:{q:'public & title',kind:'slides',tags:'calm,editorial',limit:'12'}});
  const url=new URL(calls[1].path,'https://studio.test');assert.equal(url.searchParams.get('q'),'public & title');assert.equal(url.searchParams.get('tags'),'calm,editorial');
  assert.equal(url.searchParams.has('privateProjectId'),false);unregister();
});

test('WebMCP previews expose sandbox instructions and API errors retain failure status', async t => {
  const {tools,unregister}=browserTools();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{code:'forbidden',message:'Operator required'}},{status:403});});
  const preview=content(await tools.get('studio_community_preview')!.execute({parameters:{id:'listing',version:'2'}}));
  assert.equal(preview.previewUrl,'/api/community/listings/listing/versions/2/preview');assert.equal(preview.sandbox,'allow-scripts');assert.equal(calls,0);
  const result=await tools.get('studio_community_reports')!.execute({}) as {isError:boolean};
  assert.equal(result.isError,true);assert.equal(content(result).error.code,'forbidden');assert.equal(calls,1);unregister();
});

type McpTool = {definition:{inputSchema:Record<string,z.ZodType>;annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean}};execute:(args:Record<string,unknown>)=>Promise<unknown>};
function mcpTools(request:Parameters<typeof registerCommunityTools>[1]) {
  const tools=new Map<string,McpTool>();
  const registry={registerTool:(name:string,definition:McpTool['definition'],execute:McpTool['execute'])=>{tools.set(name,{definition,execute});}};
  registerCommunityTools(registry as unknown as McpServer,request);return tools;
}

test('MCP shares schemas, validates publishing and transfers package bytes with a bounded multipart envelope', async () => {
  const requests:{method:string;path:string;body?:unknown}[]=[];
  const tools=mcpTools(async(method,path,body)=>{requests.push({method,path,body});return Response.json({ok:true});});
  assert.equal(tools.size,communityEndpoints.length+1);pinCapabilitySchemas(content(await tools.get('community_capabilities')!.execute({})).schemas);
  assert.equal(tools.get('community_unlist')!.definition.annotations?.destructiveHint,true);
  await assert.rejects(tools.get('community_publish')!.execute({body:{...publishBody,confirmPublic:false}}));assert.equal(requests.length,0);
  const missingRequired:Record<string,unknown>={...publishBody};delete missingRequired.projectId;
  await assert.rejects(tools.get('community_publish')!.execute({body:missingRequired}));
  await assert.rejects(tools.get('community_publish')!.execute({body:{...publishBody,unexpectedField:true}}));
  assert.equal(requests.length,0);
  const document=createDocument();document.pages[0].nodes=[];
  const bytes=await buildCommunityPackage(document,[],{title:'Transfer test',creator:{handle:'unit',displayName:'Unit'},license:'CC-BY-4.0'});
  const input={operationId:'import-op',base64:Buffer.from(bytes).toString('base64')}, tool=tools.get('community_import')!;
  // The MCP SDK applies registered input schemas before invoking the callback.
  const parsed=z.object(tool.definition.inputSchema).parse(input);await tool.execute(parsed);
  assert.equal(requests[0].path,'/api/community/imports');assert.equal(requests[0].method,'POST');
  const form=requests[0].body as FormData;assert.equal(form.get('operationId'),'import-op');const file=form.get('file') as File;
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);assert.equal((await readCommunityPackage(new Uint8Array(await file.arrayBuffer()))).document.name,document.name);
  assert.throws(()=>z.object(tool.definition.inputSchema).parse({operationId:'x',base64:'%bad'}));
});

test('MCP cancels oversized binary streams and returns an actionable CLI fallback', async () => {
  let cancelled=false;
  const tools=mcpTools(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8*1024*1024));controller.enqueue(new Uint8Array(8*1024*1024));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/zip'}}));
  const result=await tools.get('community_download')!.execute({id:'listing',version:'1',fileId:'file'}) as {isError:boolean};
  assert.equal(result.isError,true);assert.equal(cancelled,true);const error=content(result);assert.equal(error.error.code,'mcp_file_too_large');assert.match(error.error.message,/dsa community/);assert.equal(error.path,'/api/community/listings/listing/versions/1/files/file');
});

test('shared endpoint serialization encodes selectors and validates public query keys', () => {
  const download=communityEndpoints.find(e=>e.name==='download')!;
  assert.equal(communityEndpointPath(download,{id:'id /?',version:2,fileId:'file#'}),'/api/community/listings/id%20%2F%3F/versions/2/files/file%23');
  assert.throws(()=>communityEndpointPath(download,{id:'x'}),/Missing path parameter/);
  assert.throws(()=>communityEndpointPath(communityEndpoints.find(e=>e.name==='search')!,{}, {sort:'private'}));
  for(const endpoint of communityEndpoints as readonly CommunityEndpoint[]) if(endpoint.body) assert.ok(communitySchemas()[`${endpoint.method} /api/community${endpoint.path}`]);
});

test('CLI sends real multipart ZIP bytes and normalized filters over a local HTTP transport', async t => {
  const directory=await mkdtemp(join(tmpdir(),'community-cli-parity-'));
  const requests:{method:string;url:string;authorization:string|undefined;form?:FormData}[]=[];
  // This HTTP endpoint captures serialization only; it does not simulate publication or import success.
  const server=createServer(async(req,res)=>{
    try {
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const request={method:req.method!,url:req.url!,authorization:req.headers.authorization,form:undefined as FormData|undefined};
      if(req.method==='POST')request.form=await new Request('http://localhost'+req.url,{method:'POST',headers:{'Content-Type':String(req.headers['content-type'])},body:Buffer.concat(chunks)}).formData();
      requests.push(request);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({received:true}));
    } catch(error){res.writeHead(500);res.end(String(error));}
  });
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready));
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const {Command}=createRequire(new URL('../packages/cli/package.json',import.meta.url))('commander');
  const stdout:string[]=[];t.mock.method(process.stdout,'write',(chunk:unknown)=>{stdout.push(String(chunk));return true;});
  const run=async(args:string[],token='transport-token')=>{const program=new Command();program.exitOverride();registerCommunityCommands(program,()=>new Client({url:base,apiKey:token}));await program.parseAsync(['node','dsa','community',...args]);};
  try {
    await run(['search','--q','motion & slides','--kind','video','--tags','calm,blue','--limit','7','--sort','newest']);
    const search=new URL(requests[0].url,base);assert.equal(search.pathname,'/api/community/listings');assert.equal(search.searchParams.get('q'),'motion & slides');assert.equal(search.searchParams.get('limit'),'7');assert.equal(search.searchParams.get('tags'),'calm,blue');
    const document=createDocument();document.pages[0].nodes=[];const bytes=await buildCommunityPackage(document,[],{title:'Portable',creator:{handle:'test',displayName:'Test'},license:'CC-BY-4.0'}), path=join(directory,'portable.zip');await writeFile(path,bytes);
    await run(['import','--file',path,'--operation-id','cli-import-op']);
    assert.equal(requests[1].method,'POST');assert.equal(requests[1].url,'/api/community/imports');assert.equal(requests[1].form?.get('operationId'),'cli-import-op');assert.equal(requests[1].authorization,'Bearer transport-token');
    const uploaded=requests[1].form!.get('file') as File;assert.equal(uploaded.type,'application/zip');assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),bytes);await readCommunityPackage(new Uint8Array(await uploaded.arrayBuffer()));
    await assert.rejects(run(['my-listings'],''),/API token/);assert.equal(requests.length,2);
    await assert.rejects(run(['search','--limit','999']),/48/);assert.equal(requests.length,2);
    assert.ok(stdout.every(line=>!line.includes('transport-token')));
  } finally {
    await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});
  }
});
