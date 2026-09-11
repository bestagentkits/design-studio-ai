import { chromium } from '@playwright/test';
import { builtStaticAssets } from './built-static-assets';
import JSZip from 'jszip';
import { extractSourcePdf } from '../server/connectors/google-content';
import { createDocument } from '../src/shared/catalog';
import { importGoogleSource } from '../server/connectors/google-drive';
import assert from 'node:assert/strict';
import { test,type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setup } from './fixtures/connector-operation-context';
import { startGoogleAuthorization,finishGoogleAuthorization,googleCredential,googleDriveScope } from '../server/connectors/google-auth';
import { createConnection,disconnectConnection } from '../server/connection-store';
import { readConnectorCredential } from '../server/connector-credentials';
import { app } from '../server/index';
async function googleFixture(t:TestContext){
  const f=await setup(t),calls:{path:string;form:URLSearchParams}[]=[],state={deny:false,rotate:false,fileVersion:1,mutate:false,failPopulation:false,loseUploadResponse:false,corruptRemote:false},uploads:Buffer[]=[];let remoteUpload:{metadata:any;bytes:Buffer}|undefined;
  f.env.GOOGLE_CONNECTOR_CLIENT_ID='test-client';f.env.GOOGLE_CONNECTOR_CLIENT_SECRET='test-client-secret';f.env.GOOGLE_PICKER_API_KEY='test-public-picker-key';f.env.GOOGLE_PICKER_APP_ID='123';f.env.CONNECTORS_ENABLED='true';
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const form=new URLSearchParams(Buffer.concat(chunks).toString());calls.push({path:req.url!,form});
    if(req.url?.startsWith('/drive/v3/files/generateIds')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ids:['reserved-export']}));return;}
    if(req.url?.startsWith('/upload/drive/')){
      const raw=Buffer.concat(chunks);uploads.push(raw);const boundary=String(req.headers['content-type']).split('boundary=')[1];
      const metaStart=raw.indexOf('\r\n\r\n')+4,metaEnd=raw.indexOf(`\r\n--${boundary}`,metaStart),dataStart=raw.indexOf('\r\n\r\n',metaEnd)+4,dataEnd=raw.lastIndexOf(`\r\n--${boundary}--`);
      remoteUpload={metadata:JSON.parse(raw.subarray(metaStart,metaEnd).toString()),bytes:raw.subarray(dataStart,dataEnd)};
      if(state.loseUploadResponse){res.destroy();return;}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:'reserved-export'}));return;
    }
    if(req.url?.startsWith('/drive/v3/files/reserved-export')&&remoteUpload){
      if(req.url.includes('alt=media'))res.writeHead(200).end(state.corruptRemote?Buffer.from('changed'):remoteUpload.bytes);
      else res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(remoteUpload.metadata));return;
    }
    if(req.url==='/v1/presentations'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({presentationId:'created-presentation'}));return;}
    if(req.url?.includes(':batchUpdate')){if(state.failPopulation){res.writeHead(500).end();return;}res.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}
    if(req.url?.includes('/drive/v3/files/chosen-folder')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:'chosen-folder',name:'Exports',mimeType:'application/vnd.google-apps.folder',version:'1',capabilities:{canAddChildren:true}}));return;}
    if(state.deny){res.writeHead(401).end();return;}
    if(req.url?.includes('alt=media')){if(state.mutate)state.fileVersion++;res.writeHead(200,{'Content-Type':'text/plain'}).end('Selected source text');return;}
    const value=req.url?.startsWith('/drive/')?{id:'selected-file',name:'source.txt',mimeType:'text/plain',version:String(state.fileVersion),size:'20',capabilities:{canDownload:true}}:req.url==='/token'?{access_token:state.rotate?'rotated-access':'initial-access',refresh_token:state.rotate?'rotated-refresh':'initial-refresh',token_type:'Bearer',expires_in:3600,scope:`openid email ${googleDriveScope}`}:{sub:'123456789'};
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  f.env.CONNECTOR_FETCH=async(input,init)=>{const request=new Request(input,init);assert.ok(['oauth2.googleapis.com','openidconnect.googleapis.com','www.googleapis.com','slides.googleapis.com'].includes(new URL(request.url).hostname));assert.equal(request.redirect,'manual');return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${new URL(request.url).pathname}${new URL(request.url).search}`,{method:request.method,headers:request.headers,body:request.body,duplex:'half',signal:request.signal} as RequestInit);};
  const connection=await createConnection(f.env,'alice',{displayName:'Selected Drive',config:{adapter:'google-drive',authMode:'oauth'}});
  const start=()=>startGoogleAuthorization(f.env,f.session,connection.id,connection.revision);
  const connect=async()=>{const started=await start();return finishGoogleAuthorization(f.env,f.session,{state:new URL(started.authorizationUrl).searchParams.get('state')!,code:'one-use-code'});};
  return {...f,connection,calls,state,start,connect,uploads};
}
test('Google authorization binds session, verifier and account identity while encrypting offline credentials',async t=>{
  const f=await googleFixture(t),started=await f.start(),url=new URL(started.authorizationUrl),state=url.searchParams.get('state')!;
  assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),`openid email ${googleDriveScope}`);assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  await assert.rejects(()=>finishGoogleAuthorization(f.env,f.api,{state,code:'code'}));assert.equal(f.calls.length,0);
  const connection=await finishGoogleAuthorization(f.env,f.session,{state,code:'code'});assert.equal(connection.status,'connected');assert.equal(connection.remoteIdentity,'google:123456789');
  assert.equal(f.calls[0].form.get('redirect_uri'),'https://studio.test/api/connectors/google-drive/callback');assert.equal(f.calls[0].form.get('code_verifier')!.length,43);
  const stored=await readConnectorCredential(f.env,'alice',connection.id);assert.equal(stored.credential.refreshToken,'initial-refresh');assert.ok(!stored.row.encrypted_payload.includes('initial-refresh'));assert.ok(!JSON.stringify(connection).includes('initial-access'));
  await assert.rejects(()=>finishGoogleAuthorization(f.env,f.session,{state,code:'code'}));assert.equal(f.calls.length,2);
});
test('Google refresh rotates once and picker access is human-only and disabled after disconnect',async t=>{
  const f=await googleFixture(t),connection=await f.connect();
  await f.db.prepare('UPDATE connection_credentials SET expires_at=0 WHERE connection_id=?').bind(connection.id).run();f.state.rotate=true;
  const results=await Promise.allSettled([googleCredential(f.env,'alice',connection.id),googleCredential(f.env,'alice',connection.id)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(f.calls.filter(call=>call.form.get('grant_type')==='refresh_token').length,1);
  const request=(token:boolean)=>app.request('https://studio.test/api/connectors/google-drive/picker',{method:'POST',headers:{Origin:'https://studio.test','Content-Type':'application/json',...(token?{Authorization:'Bearer alice-api'}:{Cookie:'studio_session=alice-session'})},body:JSON.stringify({connectionId:connection.id})},f.env);
  assert.equal((await request(true)).status,403);
  const picker=await request(false);assert.equal(picker.status,200);assert.equal(picker.headers.get('cache-control'),'no-store');const body=await picker.json() as any;assert.equal(body.accessToken,'rotated-access');assert.equal(body.refreshToken,undefined);assert.equal(body.scope,googleDriveScope);
  await disconnectConnection(f.env,'alice',connection.id,connection.revision);assert.equal((await request(false)).status,409);
});

test('Drive ingestion pins an accessible selected file version and rejects grant expansion or changing content',async t=>{
  const f=await googleFixture(t),connection=await f.connect();
  await f.insert('project_connection_bindings',{id:'drive-source',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'source',selection_json:JSON.stringify({adapter:'google-drive',fileIds:['selected-file']}),created_at:f.timestamp,updated_at:f.timestamp});
  const source=await importGoogleSource(f.env,f.session,'alice-project','drive-source','selected-file');assert.equal(source.remoteVersion,'1');assert.equal(source.mimeType,'text/plain');assert.equal(source.bytes,20);
  const before=f.calls.length;await assert.rejects(()=>importGoogleSource(f.env,f.session,'alice-project','drive-source','unselected-file'));assert.equal(f.calls.length,before);
  await assert.rejects(()=>importGoogleSource(f.env,f.api,'alice-project','drive-source','selected-file'));assert.equal(f.calls.length,before);
  f.state.mutate=true;await assert.rejects(()=>importGoogleSource(f.env,f.session,'alice-project','drive-source','selected-file'),(error:any)=>error.code==='source_changed');
  const count=await f.db.prepare('SELECT COUNT(*) AS count FROM project_source_snapshots WHERE binding_id=?').bind('drive-source').first<{count:number}>();assert.equal(count!.count,1);
});

test('Drive catalog and snapshot downloads retain the exact per-agent file selection',async t=>{
  const f=await googleFixture(t),connection=await f.connect();
  await f.insert('project_connection_bindings',{id:'drive-source',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'source',selection_json:JSON.stringify({adapter:'google-drive',fileIds:['selected-file','another-file']}),created_at:f.timestamp,updated_at:f.timestamp});
  const source=await importGoogleSource(f.env,f.session,'alice-project','drive-source','selected-file');
  await f.insert('connection_agent_grants',{id:'drive-grant',user_id:'alice',project_id:'alice-project',connection_id:connection.id,principal_kind:'api',principal_id:'api-id',capabilities_json:'["discover","read_source","run"]',selection_json:JSON.stringify({adapter:'google-drive',fileIds:['another-file']}),created_at:f.timestamp,expires_at:Date.now()+3600000});
  const request=(path:string,method='GET')=>app.request(`https://studio.test/api/projects/alice-project/${path}`,{method,headers:{Authorization:'Bearer alice-api',Origin:'https://studio.test'}},f.env);
  assert.equal((await request(`sources/${source.id}`)).status,403);
  assert.deepEqual((await (await request('sources')).json() as any).sources,[]);
  await f.db.prepare('UPDATE connection_agent_grants SET selection_json=? WHERE id=?').bind(JSON.stringify({adapter:'google-drive',fileIds:['selected-file']}),'drive-grant').run();
  const catalog=await request('connections/drive-source/capabilities','POST');assert.equal(catalog.status,200);
  const value=await catalog.json() as any;assert.deepEqual(value.resources.map((r:any)=>r.fileId),['selected-file']);assert.deepEqual(value.tools,[]);
  assert.equal(await (await request(`sources/${source.id}`)).text(),'Selected source text');
  await f.db.prepare('UPDATE connection_agent_grants SET revoked_at=? WHERE id=?').bind(f.timestamp,'drive-grant').run();
  assert.equal((await request(`sources/${source.id}`)).status,403);
});

for(const partial of [false,true])test(`connected Slides requires approval and retains identity on ${partial?'partial failure':'success'}`,async t=>{
  const f=await googleFixture(t),connection=await f.connect();f.state.failPopulation=partial;
  const document=createDocument('slides','Exported slides');document.id='alice-project';
  await f.db.prepare('UPDATE projects SET document=? WHERE id=?').bind(JSON.stringify(document),document.id).run();
  await f.insert('project_connection_bindings',{id:'drive-destination',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'destination',selection_json:JSON.stringify({adapter:'google-drive',fileIds:[],destinationFolderId:'chosen-folder'}),created_at:f.timestamp,updated_at:f.timestamp});
  const request=(path:string,body:unknown)=>app.request(`https://studio.test/api/projects/alice-project/${path}`,{method:'POST',headers:{Cookie:'studio_session=alice-session',Origin:'https://studio.test','Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
  const catalog=await (await request('connections/drive-destination/capabilities',{})).json() as any;
  const prepared=await request('connector-operations',{bindingId:'drive-destination',action:'create_google_slides',arguments:{title:'Reviewed slides',folderId:'chosen-folder'},expectedVersions:catalog.versions,idempotencyKey:'isolated-slides-export'});
  assert.equal(prepared.status,201,await prepared.clone().text());const operation=(await prepared.json() as any).operation;
  assert.equal((await request(`connector-operations/${operation.id}/execute`,{expectedRevision:1})).status,409);
  assert.equal(f.calls.filter(call=>call.path==='/v1/presentations').length,0);
  const approval=await request(`connector-operations/${operation.id}/decision`,{expectedRevision:1,decision:'approve'});assert.equal(approval.status,200);
  const approved=(await approval.json() as any).operation;
  const result=await request(`connector-operations/${operation.id}/execute`,{expectedRevision:approved.revision});assert.equal(result.status,200,await result.clone().text());
  const finished=(await result.json() as any).operation;assert.equal(finished.status,partial?'outcome_unknown':'succeeded');assert.deepEqual(finished.remoteIds,['created-presentation']);
  assert.equal((await request(`connector-operations/${operation.id}/execute`,{expectedRevision:finished.revision})).status,409);
  assert.equal(f.calls.filter(call=>call.path==='/v1/presentations').length,1);
  const stored=await f.db.prepare('SELECT remote_ids_json FROM connector_operations WHERE id=?').bind(operation.id).first<{remote_ids_json:string}>();assert.equal(stored!.remote_ids_json,'["created-presentation"]');
});

for(const format of ['pdf','pptx'] as const)test(`Drive upload stages and sends actual ${format} bytes only after approval`,{timeout:60000},async t=>{
  const f=await googleFixture(t),connection=await f.connect();
  f.env.EXPORT_BROWSER=()=>chromium.launch();f.env.ASSETS=builtStaticAssets;f.state.loseUploadResponse=format==='pptx';
  const document=createDocument('slides','Upload source');document.id='alice-project';document.theme.fonts={heading:'Arial',body:'Arial'};
  await f.db.prepare('UPDATE projects SET document=? WHERE id=?').bind(JSON.stringify(document),document.id).run();
  await f.insert('project_connection_bindings',{id:'drive-destination',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'destination',selection_json:JSON.stringify({adapter:'google-drive',fileIds:[],destinationFolderId:'chosen-folder'}),created_at:f.timestamp,updated_at:f.timestamp});
  const request=(path:string,body:unknown)=>app.request(`https://studio.test/api/projects/alice-project/${path}`,{method:'POST',headers:{Cookie:'studio_session=alice-session',Origin:'https://studio.test','Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
  const catalog=await (await request('connections/drive-destination/capabilities',{})).json() as any;
  const input={bindingId:'drive-destination',action:'upload_drive_export',arguments:{filename:`reviewed.${format}`,format,folderId:'chosen-folder'},expectedVersions:catalog.versions,idempotencyKey:'isolated-binary-export'};
  const response=await request('connector-operations',input);assert.equal(response.status,201,await response.clone().text());const operation=(await response.json() as any).operation;
  assert.equal(f.uploads.length,0);
  const artifact=await f.db.prepare('SELECT object_key,bytes FROM connector_export_artifacts WHERE operation_id=?').bind(operation.id).first<{object_key:string;bytes:number}>();assert.ok(artifact);
  const object=await f.env.ASSETS_BUCKET.get(artifact.object_key);const bytes=Buffer.from(await object!.arrayBuffer());assert.equal(bytes.length,artifact.bytes);
  const download=await app.request(`https://studio.test/api/projects/alice-project/connector-operations/${operation.id}/artifact`,{headers:{Cookie:'studio_session=alice-session'}},f.env);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  if(format==='pdf'){assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok((await extractSourcePdf(new Uint8Array(bytes))).byteLength>0);}
  else{const zip=await JSZip.loadAsync(bytes);assert.ok(zip.file('ppt/presentation.xml'));assert.ok(zip.file('ppt/slides/slide1.xml'));}
  const duplicate=await request('connector-operations',input);assert.equal((await duplicate.json() as any).operation.id,operation.id);assert.equal(f.calls.filter(call=>call.path.includes('generateIds')).length,1);
  const approval=await request(`connector-operations/${operation.id}/decision`,{expectedRevision:operation.revision,decision:'approve'});const approved=(await approval.json() as any).operation;
  const result=await request(`connector-operations/${operation.id}/execute`,{expectedRevision:approved.revision});assert.equal(result.status,200,await result.clone().text());const finished=(await result.json() as any).operation;assert.equal(finished.status,format==='pptx'?'outcome_unknown':'succeeded');
  if(format==='pptx'){
    f.state.corruptRemote=true;assert.equal((await request(`connector-operations/${operation.id}/reconcile`,{expectedRevision:finished.revision})).status,409);
    f.state.corruptRemote=false;const reconciled=await request(`connector-operations/${operation.id}/reconcile`,{expectedRevision:finished.revision});assert.equal(reconciled.status,200,await reconciled.clone().text());assert.equal((await reconciled.json() as any).operation.status,'succeeded');
  }
  assert.equal(f.uploads.length,1);assert.ok(f.uploads[0].includes(bytes));assert.ok(f.uploads[0].includes(Buffer.from('"parents":["chosen-folder"]')));
  await f.db.prepare('UPDATE connector_operations SET encrypted_arguments=NULL WHERE id=?').bind(operation.id).run();
  assert.equal(await f.db.prepare('SELECT 1 FROM connector_export_artifacts WHERE operation_id=?').bind(operation.id).first(),null);
  assert.ok(await f.db.prepare("SELECT 1 FROM connector_object_cleanup WHERE object_key=? AND state='deleting'").bind(artifact.object_key).first());
});
