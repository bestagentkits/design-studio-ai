import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, input } from './fixtures/mcp-tool-context';
import { prepareMcpToolOperation, executeMcpToolOperation } from '../server/connectors/mcp-tools';
import { readConnectorOperation } from '../server/connector-operation-reads';
import { ApiError } from '../server/security';
import { app } from '../server/index';
const failure = (code:string) => (error:unknown) => error instanceof ApiError && error.code === code;
test('real MCP execution requires approval, claims once and persists inert private output',async t=>{
  const f=await fixture(t),op=await f.prepare();
  await assert.rejects(executeMcpToolOperation(f.env,f.api,'alice-project',op.id,1),failure('approval_required'));
  assert.equal(f.methods.filter(x=>x==='tools/call').length,0);
  assert.equal((await f.decision(op.id)).status,200);
  const results=await Promise.allSettled([f.execute(op.id),f.execute(op.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
  const stored=await readConnectorOperation(f.env,f.api,op.id);
  assert.equal(stored.operation.status,'succeeded');assert.deepEqual(stored.result,{content:[{type:'text',text:'private remote result'}]});
  await assert.rejects(f.execute(op.id),failure('revision_conflict'));
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
});
for(const mode of ['error','drop','input'] as const)test(`MCP ${mode} is persisted without replay`,async t=>{
  const f=await fixture(t),id=await f.approve();f.state.mode=mode;
  const result=await f.execute(id);
  assert.equal(result.status,mode==='drop'?'outcome_unknown':'failed');
  const saved=await readConnectorOperation(f.env,f.api,id);
  if(mode==='input')assert.equal((saved.result as {requestState:string}).requestState,'private-continuation');
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
});
test('changed remote definition and revoked catalog authority prevent dispatch',async t=>{
  const f=await fixture(t),id=await f.approve();f.state.description='Changed action';
  await assert.rejects(f.execute(id),failure('schema_changed'));
  f.state.description='Reviewed remote action';f.state.hook=async method=>{if(method==='tools/list')await f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked' WHERE id='grant'").run();};
  await assert.rejects(f.execute(id),failure('missing_grant'));
  assert.equal(f.methods.filter(x=>x==='tools/call').length,0);
});
test('revocation during the RPC leaves an unknown outcome without releasing output',async t=>{
  const f=await fixture(t),id=await f.approve();
  f.state.hook=async method=>{if(method==='tools/call')await f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked' WHERE id='grant'").run();};
  await assert.rejects(f.execute(id));
  const saved=await readConnectorOperation(f.env,f.api,id);
  assert.equal(saved.operation.status,'outcome_unknown');assert.equal(saved.result,null);assert.equal(saved.payloadAvailable,false);
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
});

test('mounted operation routes enforce human decisions, project scope and recovery while disabled',async t=>{
  const f=await fixture(t);f.env.CONNECTORS_ENABLED='true';
  const request=(path:string,method='GET',body?:unknown,credential='alice-api',headers:Record<string,string>={})=>app.request(`https://studio.test/api/projects/${path}`,{
    method,headers:{Origin:'https://studio.test','Content-Type':'application/json',...(credential.endsWith('session')?{Cookie:`studio_session=${credential}`}:{Authorization:`Bearer ${credential}`}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  },f.env);
  const base='alice-project/connector-operations';
  const prepared=await request(base,'POST',input);assert.equal(prepared.status,201);
  const {operation}=await prepared.json() as {operation:{id:string}};
  const path=`${base}/${operation.id}`;
  assert.equal((await request(`${path}/decision`,'POST',{expectedRevision:1,decision:'approve'})).status,403);
  assert.equal((await request(`bob-project/connector-operations/${operation.id}`)).status,404);
  assert.equal((await request(path,'GET',undefined,'bob-session')).status,404);
  const list=await (await request(base)).json() as {operations:unknown[]};assert.equal(list.operations.length,1);
  assert.equal((await request(`${path}/decision`,'POST',{expectedRevision:1,decision:'approve'},'alice-session',{'X-Studio-Client':'webmcp'})).status,403);
  assert.equal((await request(`${path}/decision`,'POST',{expectedRevision:1,decision:'approve'},'alice-session')).status,200);
  assert.equal((await request(`${path}/execute`,'POST',{expectedRevision:2})).status,200);
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
  const second=await prepareMcpToolOperation(f.env,f.api,'alice-project',{...input,idempotencyKey:'mcp-operation-key-002'});
  f.env.CONNECTORS_ENABLED='false';
  assert.equal((await request(path)).status,200);
  assert.equal((await request(base,'POST',input)).status,503);
  assert.equal((await request(`${base}/${second.id}/execute`,'POST',{expectedRevision:1})).status,503);
  assert.equal((await request(`${base}/${second.id}/cancel`,'POST',{expectedRevision:1})).status,200);
  assert.equal(f.methods.filter(x=>x==='tools/call').length,1);
});

test('catalog routes separate human setup discovery from narrowed agent discovery',async t=>{
  const f=await fixture(t);f.env.CONNECTORS_ENABLED='true';
  const request=(path:string,credential='alice-session')=>app.request(`https://studio.test/api/${path}`,{method:'POST',headers:{Origin:'https://studio.test','Content-Type':'application/json',...(credential.endsWith('session')?{Cookie:`studio_session=${credential}`}:{Authorization:`Bearer ${credential}`})},body:'{}'},f.env);
  const setup=await request('connections/connection/capabilities');assert.equal(setup.status,200);
  assert.equal((await setup.json() as {tools:unknown[]}).tools.length,1);
  assert.equal((await request('connections/connection/capabilities','alice-api')).status,403);
  const path='projects/alice-project/connections/binding/capabilities';
  assert.equal((await request(path,'alice-api')).status,403);
  await f.db.prepare(`UPDATE connection_agent_grants SET capabilities_json='["discover"]',selection_json='{"adapter":"mcp","tools":[],"resources":[]}' WHERE id='grant'`).run();
  const filtered=await request(path,'alice-api');assert.equal(filtered.status,200);
  assert.deepEqual((await filtered.json() as {tools:unknown[]}).tools,[]);
  f.state.hook=async method=>{if(method==='tools/list')await f.db.prepare("UPDATE connections SET status='disconnected',revision=revision+1 WHERE id='connection'").run();};
  assert.equal((await request('connections/connection/capabilities')).status,409);
});
