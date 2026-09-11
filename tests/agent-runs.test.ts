import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fixture } from './fixtures/mcp-tool-context';
import { app } from '../server/index';
import { createDocument } from '../src/shared/catalog';
import { encrypt } from '../server/security';
async function setup(t:TestContext){
  const f=await fixture(t);f.env.CONNECTORS_ENABLED='true';
  const document=createDocument('web','Run project');document.id='alice-project';
  await f.db.prepare('UPDATE projects SET document=? WHERE id=?').bind(JSON.stringify(document),document.id).run();
  const brief={projectId:document.id,revision:1,request:'Refine page',status:'approved',message:'',questions:[],answers:{},scope:{objective:'Refine page',audience:'Readers',direction:'Clear',deliverables:['Page'],constraints:[],acceptanceCriteria:['Readable']},approvedAt:f.timestamp,updatedAt:f.timestamp};
  await f.insert('design_briefs',{project_id:document.id,user_id:'alice',revision:1,brief:JSON.stringify(brief),updated_at:f.timestamp});
  await f.db.prepare(`UPDATE connection_agent_grants SET capabilities_json='["discover","prepare_write","run"]'`).run();
  await f.insert('providers',{user_id:'alice',provider:'openai',encrypted_key:await encrypt(f.env,'isolated-key'),base_url:'https://api.openai.com/v1',model:'test-model'});
  const modelState={invalidDocument:false,reject:false};
  let calls=0;const requests:Record<string,unknown>[]=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);calls++;
    if(modelState.reject){res.writeHead(429).end();return;}
    const message=modelState.invalidDocument?{role:'assistant',content:'not a document'}:calls===1?{role:'assistant',content:null,tool_calls:[{id:'call-one',type:'function',function:{name:body.tools[0].function.name,arguments:'{"text":"reviewed payload"}'}}]}:{role:'assistant',content:JSON.stringify(document)};
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{finish_reason:calls===1&&!modelState.invalidDocument?'tool_calls':'stop',message}],usage:{prompt_tokens:20,completion_tokens:10}}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    if(String(input)==='https://api.openai.com/v1/chat/completions')return original(`http://127.0.0.1:${(server.address() as AddressInfo).port}`,init);
    return original(input,init);
  };
  t.after(async()=>{globalThis.fetch=original;const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed;});
  const base='/api/projects/alice-project/runs';
  const request=(path='',method='GET',body?:unknown,credential='alice-api')=>app.request('https://studio.test'+base+path,{method,headers:{Origin:'https://studio.test','Content-Type':'application/json',...(credential.endsWith('session')?{Cookie:`studio_session=${credential}`}:{Authorization:`Bearer ${credential}`})},...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
  const start=async()=>{const response=await request('','POST',{prompt:'Refine the page using the selected tool',provider:'openai',bindingIds:['binding'],sourceSnapshotIds:[],expectedDocumentRevision:1,expectedBriefRevision:1,idempotencyKey:'isolated-run-start'});assert.equal(response.status,201,await response.clone().text());return (await response.json() as {run:{id:string;revision:number;status:string;pendingOperationId:string|null}}).run;};
  const advance=async(run:{id:string;revision:number})=>{const response=await request(`/${run.id}/advance`,'POST',{expectedRevision:run.revision});assert.equal(response.status,200,await response.clone().text());return (await response.json() as {run:{id:string;revision:number;status:string;pendingOperationId:string|null}}).run;};
  return {...f,toolRequests:f.calls,modelState,document,request,start,advance,requests,calls:()=>calls};
}
test('persisted runs pause for exact human approval, continue once and return an unsaved validated proposal',async t=>{
  const f=await setup(t);let run=await f.start();assert.equal(f.calls(),0);
  const again=await f.start();assert.equal(again.id,run.id);
  assert.equal((await f.request(`/${run.id}`)).status,200);assert.equal(f.calls(),0);
  run=await f.advance(run);assert.equal(f.calls(),1);assert.equal(run.status,'ready_to_continue');
  run=await f.advance(run);assert.equal(run.status,'awaiting_approval');assert.ok(run.pendingOperationId);assert.equal(f.methods.filter(m=>m==='tools/call').length,0);
  const paused=await f.advance(run);assert.equal(paused.revision,run.revision);
  assert.equal((await f.decision(run.pendingOperationId!)).status,200);
  run=await f.advance(run);assert.equal(f.methods.filter(m=>m==='tools/call').length,1);
  run=await f.advance(run);assert.equal(run.status,'succeeded');assert.equal(f.calls(),2);
  const detail=await (await f.request(`/${run.id}`)).json() as {proposal:{id:string};steps:unknown[]};assert.equal(detail.proposal.id,f.document.id);assert.equal(detail.steps.length,4);
  assert.equal((await f.db.prepare('SELECT revision FROM projects WHERE id=?').bind(f.document.id).first<{revision:number}>())!.revision,1);
  const messages=f.requests[1].messages as {role:string;tool_call_id?:string}[];assert.equal(messages.at(-1)?.tool_call_id,'call-one');
  assert.equal((await f.request(`/${run.id}/proposal`)).status,200);
  await f.db.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').bind(f.document.id).run();
  assert.equal((await f.request(`/${run.id}/proposal`)).status,409);
  assert.equal(f.calls(),2);
});
test('concurrent advance cannot issue the same model request twice and stale project blocks further work',async t=>{
  const f=await setup(t),run=await f.start();
  const results=await Promise.all([f.request(`/${run.id}/advance`,'POST',{expectedRevision:1}),f.request(`/${run.id}/advance`,'POST',{expectedRevision:1})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls(),1);
  const saved=await (await f.request(`/${run.id}`)).json() as {run:{revision:number}};
  await f.db.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').bind(f.document.id).run();
  assert.equal((await f.request(`/${run.id}/advance`,'POST',{expectedRevision:saved.run.revision})).status,409);assert.equal(f.calls(),1);
});
test('revoking grants prevents run continuation and private result access, while human cancellation remains available',async t=>{
  const f=await setup(t);let run=await f.start();run=await f.advance(run);run=await f.advance(run);
  await f.db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked'").run();
  assert.equal((await f.request(`/${run.id}/advance`,'POST',{expectedRevision:run.revision})).status,403);
  const privateRead=await (await f.request(`/${run.id}`)).json() as {payloadAvailable:boolean};assert.equal(privateRead.payloadAvailable,false);
  f.env.CONNECTORS_ENABLED='false';assert.equal((await f.request(`/${run.id}/cancel`,'POST',{expectedRevision:run.revision},'alice-session')).status,200);
  assert.equal(f.methods.filter(m=>m==='tools/call').length,0);
});

test('cancelling during tool discovery prevents dispatch even after the run step was claimed',async t=>{
  const f=await setup(t);let run=await f.start();run=await f.advance(run);run=await f.advance(run);
  await f.decision(run.pendingOperationId!);
  f.state.hook=async method=>{if(method==='tools/list')await f.db.prepare("UPDATE agent_runs SET status='cancelled',revision=revision+1,lease_id=NULL,lease_expires_at=NULL WHERE id=?").bind(run.id).run();};
  assert.equal((await f.request(`/${run.id}/advance`,'POST',{expectedRevision:run.revision})).status,409);
  assert.equal(f.methods.filter(m=>m==='tools/call').length,0);
});
test('expired run leases are recovered as unknown and cannot silently retry a model request',async t=>{
  const f=await setup(t),run=await f.start();
  await f.db.prepare("UPDATE agent_runs SET status='running',lease_id='lost-worker',lease_expires_at=0 WHERE id=?").bind(run.id).run();
  const read=await (await f.request(`/${run.id}`)).json() as {run:{status:string;revision:number}};
  assert.equal(read.run.status,'outcome_unknown');
  assert.equal((await f.request(`/${run.id}/advance`,'POST',{expectedRevision:read.run.revision})).status,409);assert.equal(f.calls(),0);
});

test('twenty selected bindings keep atomic run guards within D1 parameter limits',async t=>{
  const f=await setup(t),bindingIds=['binding'];
  for(let i=1;i<20;i++){
    const id=`binding-${i}`;bindingIds.push(id);
    await f.insert('project_connection_bindings',{id,user_id:'alice',project_id:'alice-project',connection_id:'connection',role:'tool',selection_json:JSON.stringify({adapter:'mcp',tools:['action'],resources:[]}),created_at:f.timestamp,updated_at:f.timestamp});
  }
  const prepare=f.db.prepare.bind(f.db);let maximum=0;
  f.db.prepare=(sql:string)=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...args:unknown[])=>{maximum=Math.max(maximum,args.length);assert.ok(args.length<=100,`D1 parameter count ${args.length}`);return bind(...args);};return statement;};
  const response=await f.request('','POST',{prompt:'Use selected tools',provider:'openai',bindingIds,sourceSnapshotIds:[],expectedDocumentRevision:1,expectedBriefRevision:1,idempotencyKey:'twenty-binding-run'});
  assert.equal(response.status,201,await response.clone().text());assert.ok(maximum<100);
});

test('input-required tools pause the run without feeding a replay request to the model',async t=>{
  const f=await setup(t);let run=await f.start();run=await f.advance(run);run=await f.advance(run);
  await f.decision(run.pendingOperationId!);f.state.mode='input';
  run=await f.advance(run);assert.equal(run.status,'awaiting_approval');assert.ok(run.pendingOperationId);
  const paused=await f.advance(run);assert.equal(paused.revision,run.revision);
  assert.equal(f.methods.filter(m=>m==='tools/call').length,1);assert.equal(f.calls(),1);
});

test('completed invalid model responses are failed rather than unknown',async t=>{
  const f=await setup(t);const run=await f.start();f.modelState.invalidDocument=true;
  const done=await f.advance(run);assert.equal(done.status,'failed');assert.equal(f.calls(),1);
  const detail=await (await f.request(`/${run.id}`)).json() as {errorCode:string;run:{modelTurns:number}};
  assert.equal(detail.errorCode,'invalid_generation');assert.equal(detail.run.modelTurns,1);
  assert.equal((await f.request(`/${run.id}/advance`,'POST',{expectedRevision:done.revision})).status,409);
});

test('human continuation preserves opaque state and requires a fresh one-use approval',async t=>{
  const f=await setup(t);let run=await f.start();run=await f.advance(run);run=await f.advance(run);
  await f.decision(run.pendingOperationId!);f.state.mode='input';run=await f.advance(run);
  const parentId=run.pendingOperationId;
  const parent=await f.db.prepare('SELECT revision FROM connector_operations WHERE id=?').bind(parentId).first<{revision:number}>();
  const path=`https://studio.test/api/projects/alice-project/connector-operations/${run.pendingOperationId}/continuation`;
  const send=(auth:Record<string,string>,responses:unknown={})=>app.request(path,{method:'POST',headers:{Origin:'https://studio.test','Content-Type':'application/json',...auth},body:JSON.stringify({expectedRevision:parent!.revision,inputResponses:responses})},f.env);
  assert.equal((await send({Authorization:'Bearer alice-api'})).status,403);
  const response=await send({Cookie:'studio_session=alice-session'});assert.equal(response.status,201,await response.clone().text());
  const child=(await response.json() as {operation:{id:string;status:string}}).operation;assert.equal(child.status,'awaiting_approval');
  const read=await (await f.request(`/${run.id}`)).json() as {run:typeof run};run=read.run;assert.equal(run.pendingOperationId,child.id);
  const paused=await f.advance(run);assert.equal(paused.revision,run.revision);
  await f.decision(child.id);f.state.mode='success';run=await f.advance(run);
  assert.equal(f.methods.filter(method=>method==='tools/call').length,2);
  assert.equal(f.toolRequests[1].requestState,'private-continuation');assert.deepEqual(f.toolRequests[1].inputResponses,{});
  const stored=await f.db.prepare('SELECT COUNT(*) AS count FROM connector_operations WHERE parent_operation_id=?').bind(parentId).first<{count:number}>();
  assert.equal(stored!.count,1);
});

test('explicit model HTTP rejection records a failed step without retry',async t=>{
  const f=await setup(t),run=await f.start();f.modelState.reject=true;
  const done=await f.advance(run);assert.equal(done.status,'failed');assert.equal(f.calls(),1);
  const detail=await (await f.request(`/${run.id}`)).json() as {errorCode:string};assert.equal(detail.errorCode,'provider_error');
});
