import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setup } from './fixtures/connector-operation-context';
import { createConnection } from '../server/connection-store';
import { startGithubAuthorization,finishGithubAuthorization } from '../server/connectors/github-auth';
import { createDocument } from '../src/shared/catalog';
import { builtStaticAssets } from './built-static-assets';
import { gitBlobSha } from '../server/connectors/github-export-artifact';
import { app } from '../server/index';
import JSZip from 'jszip';

test('React GitHub export stages real files, rejects stale bases, and reconciles a lost PR response without another write',async t=>{
  const f=await setup(t),keys=generateKeyPairSync('rsa',{modulusLength:2048}),baseCommit='a'.repeat(40),baseTree='b'.repeat(40),newTree='c'.repeat(40),newCommit='d'.repeat(40);
  Object.assign(f.env,{CONNECTORS_ENABLED:'true',GITHUB_CONNECTOR_CLIENT_ID:'client',GITHUB_CONNECTOR_CLIENT_SECRET:'secret',GITHUB_CONNECTOR_APP_ID:'42',GITHUB_CONNECTOR_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),GITHUB_CONNECTOR_WEBHOOK_SECRET:'isolated-test-webhook-secret',ASSETS:builtStaticAssets});
  await f.db.prepare('UPDATE projects SET document=? WHERE id=?').bind(JSON.stringify(createDocument('web')),'alice-project').run();
  const blobs=new Map<string,Buffer>(),requests:{method:string;path:string;body:any}[]=[];let moved=false,loseResponse=true,branch='',pull:any;
  const server=createServer(async(req,res)=>{try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks).toString(),body=raw.startsWith('{')?JSON.parse(raw):{};
    requests.push({method:req.method!,path:req.url!,body});const path=req.url!;let result:unknown;
    if(path==='/login/oauth/access_token')result={access_token:'test-user-access',token_type:'bearer',expires_in:28800};
    else if(path==='/user')result={id:99};
    else if(path.startsWith('/user/installations?'))result={installations:[{id:7,app_id:42,suspended_at:null}]};
    else if(path.startsWith('/user/installations/7/repositories'))result={repositories:[{id:11,full_name:'example/selected',default_branch:'main',permissions:{push:true}}]};
    else if(path==='/app/installations/7/access_tokens'){assert.deepEqual(body.repository_ids,[11]);result={token:'installation-access',expires_at:new Date(Date.now()+3600000).toISOString(),permissions:body.permissions};}
    else if(path.includes('/git/ref/heads/main'))result={object:{sha:moved?'e'.repeat(40):baseCommit}};
    else if(path.endsWith(`/git/commits/${baseCommit}`))result={sha:baseCommit,tree:{sha:baseTree}};
    else if(path.endsWith(`/git/commits/${newCommit}`))result={sha:newCommit,tree:{sha:newTree},parents:[{sha:baseCommit}]};
    else if(path.includes('/git/trees/')&&req.method==='GET')result={truncated:false,tree:[{path:'unrelated.txt',mode:'100644',type:'blob',sha:'f'.repeat(40)}]};
    else if(path.endsWith('/git/blobs')){const bytes=Buffer.from(body.content,'base64'),sha=await gitBlobSha(bytes);blobs.set(sha,bytes);result={sha};}
    else if(path.endsWith('/git/trees')){assert.equal(body.base_tree,baseTree);assert.ok(body.tree.length>5);assert.ok(body.tree.every((entry:any)=>entry.path.startsWith('prototype/')&&entry.sha&&entry.mode==='100644'));result={sha:newTree};}
    else if(path.endsWith('/git/commits')){assert.deepEqual(body.parents,[baseCommit]);assert.equal(body.tree,newTree);result={sha:newCommit};}
    else if(path.endsWith('/git/refs')){assert.match(body.ref,/^refs\/heads\/studio\/export-/);assert.equal(body.sha,newCommit);branch=body.ref.slice('refs/heads/'.length);result={ref:body.ref,object:{sha:newCommit}};}
    else if(path.endsWith('/pulls')&&req.method==='POST'){assert.equal(body.base,'main');assert.equal(body.head,branch);pull={number:1,html_url:'https://github.com/example/selected/pull/1',head:{sha:newCommit,ref:branch,repo:{id:11}},base:{ref:'main',repo:{id:11}}};if(loseResponse){res.destroy();return;}result=pull;}
    else if(path.includes('/pulls?'))result=pull?[pull]:[];
    else throw new Error(`Unexpected request ${req.method} ${path}`);
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
  }catch(error){res.writeHead(500).end(JSON.stringify({error:String(error)}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  f.env.CONNECTOR_FETCH=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);assert.equal(request.redirect,'manual');assert.ok(['github.com','api.github.com'].includes(url.hostname));return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${url.pathname}${url.search}`,{method:request.method,headers:request.headers,body:request.body,duplex:'half',signal:request.signal} as RequestInit);};
  const connection=await createConnection(f.env,'alice',{displayName:'GitHub',config:{adapter:'github',authMode:'oauth'}}),start=await startGithubAuthorization(f.env,f.session,connection.id,1,'7');
  await finishGithubAuthorization(f.env,f.session,{state:new URL(start.authorizationUrl).searchParams.get('state')!,code:'test-code'});
  await f.insert('project_connection_bindings',{id:'github-destination',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'destination',selection_json:JSON.stringify({adapter:'github',repositoryId:'11',commit:baseCommit,paths:['prototype']}),created_at:f.timestamp,updated_at:f.timestamp});
  const request=(path:string,body?:unknown)=>app.request(`https://studio.test/api/projects/alice-project/${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:'studio_session=alice-session',Origin:'https://studio.test','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
  const catalog=await (await request('connections/github-destination/capabilities',{})).json() as any;assert.equal(catalog.tools[0].remoteName,'create_react_pull_request');
  const input={bindingId:'github-destination',action:'create_react_pull_request',arguments:{baseBranch:'main',directory:'prototype',title:'Review React prototype'},expectedVersions:catalog.versions,idempotencyKey:'github-export-test'};
  moved=true;assert.equal((await request('connector-operations',input)).status,409);moved=false;
  const prepared=await request('connector-operations',input);assert.equal(prepared.status,201,await prepared.clone().text());const {operation}=await prepared.json() as any;
  const artifact=await request(`connector-operations/${operation.id}/artifact`);assert.equal(artifact.status,200);const archive=await JSZip.loadAsync(await artifact.arrayBuffer());assert.ok(archive.file('package.json'));assert.ok(archive.file('document.json'));
  const detail=await (await request(`connector-operations/${operation.id}`)).json() as any;assert.ok(detail.result.review.files.some((file:any)=>file.path==='prototype/document.json'));assert.deepEqual(detail.result.review.deletions,[]);
  const approved=await request(`connector-operations/${operation.id}/decision`,{expectedRevision:operation.revision,decision:'approve'});assert.equal(approved.status,200,await approved.clone().text());
  const executed=await request(`connector-operations/${operation.id}/execute`,{expectedRevision:2});assert.equal(executed.status,200,await executed.clone().text());const unknown=(await executed.json() as any).operation;assert.equal(unknown.status,'outcome_unknown');assert.ok(unknown.remoteIds.includes(`commit:${newCommit}`));
  const writes=()=>requests.filter(req=>req.method==='POST'&&req.path.startsWith('/repos/')).length,count=writes();
  assert.equal((await request(`connector-operations/${operation.id}/execute`,{expectedRevision:unknown.revision})).status,409);assert.equal(writes(),count);
  const reconciled=await request(`connector-operations/${operation.id}/reconcile`,{expectedRevision:unknown.revision});assert.equal(reconciled.status,200,await reconciled.clone().text());assert.equal((await reconciled.json() as any).operation.status,'succeeded');assert.equal(writes(),count);
  assert.ok(!requests.some(req=>['PATCH','PUT','DELETE'].includes(req.method)));assert.equal(requests.filter(req=>req.path.endsWith('/pulls')&&req.method==='POST').length,1);
  assert.ok([...blobs.values()].some(bytes=>bytes.toString().includes('studio-react-prototype')));
  const payload=JSON.stringify({action:'suspend',installation:{id:7}}),signature='sha256='+createHmac('sha256',f.env.GITHUB_CONNECTOR_WEBHOOK_SECRET!).update(payload).digest('hex');
  const webhook=(sig:string)=>app.request('https://studio.test/api/connectors/github/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sig,'X-GitHub-Delivery':'test-delivery','X-GitHub-Event':'installation'},body:payload},f.env);
  assert.equal((await webhook('sha256='+'0'.repeat(64))).status,401);assert.equal((await webhook(signature)).status,200);assert.equal((await webhook(signature)).status,200);
  assert.equal((await f.db.prepare('SELECT status FROM connections WHERE id=?').bind(connection.id).first<any>()).status,'disconnected');
  assert.equal(await f.db.prepare('SELECT 1 FROM connection_credentials WHERE connection_id=?').bind(connection.id).first(),null);
});
