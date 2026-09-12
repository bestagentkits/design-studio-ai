import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import {app} from '../server/index';
import {processCommunityJob,reconcileCommunityStorage,independentCommunityDocument} from '../server/community-worker';
import {guardCommunityProjectDeletion} from '../server/community-publication';
import {SqliteDatabase,FileBucket} from '../server/node-adapters';
import {secret,ApiError} from '../server/security';
import {writeCommunityFile,communityChecksum,reserveCommunityStorage} from '../server/community-assets';
import {createDocument} from '../src/shared/catalog';
import {readCommunityPackage} from '../src/shared/community-package';
import {builtStaticAssets} from './built-static-assets';
import type {Bindings} from '../server/types';
import {documentSchema} from '../src/shared/schema';

test('independent documents remap navigation, toggles, timeline targets and shared scene rigs',()=>{
 const document=createDocument('web','Linked design'),second=createDocument('web','Second page').pages[0];second.id='second-page';document.pages.push(second);
 document.pages[0].nodes[0].interactions=[{trigger:'click',action:'navigate',target:second.id},{trigger:'click',action:'toggle',target:document.pages[0].nodes[1].id},{trigger:'click',action:'url',target:'https://example.com'}];
 const copy=independentCommunityDocument(document,'recipient');assert.equal(copy.pages[0].nodes[0].interactions![0].target,copy.pages[1].id);assert.equal(copy.pages[0].nodes[0].interactions![1].target,copy.pages[0].nodes[1].id);assert.equal(copy.pages[0].nodes[0].interactions![2].target,'https://example.com');documentSchema.parse(copy);
 const scene=createDocument('3d','Rig');const object=scene.pages[0].nodes.find(n=>n.type==='model3d')!;const linked=structuredClone(object);linked.id='linked-rig';linked.scene={...linked.scene,rigId:object.id};linked.data={...linked.data,rigSourceId:object.id};scene.pages[0].nodes.push(linked);const rigCopy=independentCommunityDocument(scene,'rig-recipient');const copiedRoot=rigCopy.pages[0].nodes.find(n=>n.name===object.name&&n.id!==rigCopy.pages[0].nodes.at(-1)!.id)!;assert.equal(rigCopy.pages[0].nodes.at(-1)!.scene!.rigId,copiedRoot.id);assert.equal(rigCopy.pages[0].nodes.at(-1)!.data!.rigSourceId,copiedRoot.id);
});

test('real Community publication produces portable files and independent remix/import with durable revocation', {timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'community-jobs-')),db=new SqliteDatabase(':memory:'),origin='https://community.test';
 const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),ASSETS:builtStaticAssets,APP_URL:origin,ENCRYPTION_KEY:secret(),ALLOW_REGISTRATION:'true',COMMUNITY_ENABLED:'true',EXPORT_BROWSER:()=>chromium.launch({headless:true})};
 let cookie='';const request=(path:string,method='GET',body?:unknown,auth=cookie)=>app.request(origin+path,{method,headers:{Origin:origin,Cookie:auth,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})},env);
 const json=async(response:Response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json() as Promise<any>;};
 try{
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
 const register=async(email:string)=>{const response=await request('/api/auth/register','POST',{email,password:secret()});assert.equal(response.status,201);const body=await response.json() as any;return {cookie:response.headers.get('set-cookie')!.split(';')[0],user:body.user};};
 const author=await register('author@community-jobs.test'),reader=await register('reader@community-jobs.test');cookie=author.cookie;
 await json(await request('/api/community/me/profile','PUT',{handle:'publisher',displayName:'Public Author',expectedProfileRevision:0}));
 const document=createDocument('web','Portable design');document.theme.fonts={heading:'Arial',body:'Arial'};
 let project=(await json(await request('/api/projects','POST',{name:document.name,kind:document.kind,document}),201)).project;
 const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),upload=new FormData();upload.set('file',new File([pixel],'private-filename.png',{type:'image/png'}));const asset=(await json(await request(`/api/projects/${project.id}/assets`,'POST',upload),201)).asset;
 project.document.assets.push(asset);project.document.pages[0].nodes.push({id:'public-image',type:'image',name:'Public image',x:20,y:20,width:40,height:40,src:asset.url},{id:'hidden-secret',type:'text',name:'Secret',x:0,y:0,width:40,height:40,text:'PRIVATE-HIDDEN-TEXT',visible:false});
 project=(await json(await request(`/api/projects/${project.id}/document`,'PUT',{document:project.document,expectedRevision:project.revision}))).project;
 const metadata={projectId:project.id,expectedProjectRevision:project.revision,title:'Đồ Án Shared',description:'Download and remix',tags:['minimal'],formats:[{format:'html'},{format:'pdf'}]};
 const preflight=(await json(await request('/api/community/preflight','POST',metadata))).preflight;
 assert.ok(!JSON.stringify(preflight.document).includes('PRIVATE-HIDDEN-TEXT'));
 const payload={...metadata,operationId:'publish-one',digest:preflight.digest,license:'CC-BY-4.0',acceptLicense:true,confirmPublic:true};
 const accepted=(await json(await request('/api/community/listings','POST',payload),202)).job;
 await db.prepare('DELETE FROM community_storage_reservations WHERE job_id=?').bind(accepted.id).run();
 const replay=(await json(await request('/api/community/listings','POST',payload),202)).job;assert.equal(replay.id,accepted.id);
 assert.equal((await request('/api/community/listings','POST',{...payload,title:'Different'})).status,409);
 assert.equal((await request('/api/community/jobs/publish-one','GET',undefined,reader.cookie)).status,404);
 assert.equal((await json(await request('/api/community/listings','GET',undefined,''))).listings.length,0);
 env.COMMUNITY_ENABLED='false';assert.equal(await processCommunityJob(env,accepted.id),false);env.COMMUNITY_ENABLED='true';
 await db.prepare("UPDATE community_jobs SET status='running',lease='test-active',lease_until=? WHERE id=?").bind(Date.now()+10000,accepted.id).run();assert.equal((await request(`/api/projects/${project.id}`,'DELETE')).status,409);await db.prepare("UPDATE community_jobs SET status='queued',lease=NULL,lease_until=0 WHERE id=?").bind(accepted.id).run();
 const originalBucket=env.ASSETS_BUCKET;let interruptedPdfChecksum='';
 env.ASSETS_BUCKET={get:originalBucket.get.bind(originalBucket),delete:originalBucket.delete.bind(originalBucket),put:async(key,bytes,options)=>{
  if(options?.httpMetadata?.contentType==='application/pdf'&&!interruptedPdfChecksum){interruptedPdfChecksum=await communityChecksum(new Uint8Array(bytes));await db.prepare("UPDATE community_jobs SET status='queued',lease=NULL,lease_until=0 WHERE id=?").bind(accepted.id).run();throw new ApiError(409,'lease_lost','Simulated interruption after PDF intent.');}
  return originalBucket.put(key,bytes,options);
 }};
 assert.equal(await processCommunityJob(env,accepted.id),false);assert.ok(interruptedPdfChecksum);assert.equal((await db.prepare("SELECT status FROM community_files WHERE job_id=? AND format='pdf'").bind(accepted.id).first<any>())!.status,'intent');
 env.ASSETS_BUCKET=originalBucket;await new Promise(resolve=>setTimeout(resolve,1200));
 await Promise.all([processCommunityJob(env,accepted.id),processCommunityJob(env,accepted.id)]);
 const completed=(await json(await request('/api/community/jobs/publish-one'))).job;assert.equal(completed.status,'succeeded',JSON.stringify(completed));
 const listing=(await json(await request(`/api/community/listings/${accepted.listingId}`,'GET',undefined,''))).listing;
 assert.ok(listing.formats.includes('package'));assert.ok(listing.formats.includes('html'));
 assert.notEqual(listing.files.find((f:any)=>f.format==='pdf').checksum,interruptedPdfChecksum,'The resumed real PDF has a different creation timestamp and safely replaces only an uncommitted intent');
 const cover=await request(listing.coverUrl,'GET',undefined,'');assert.equal(cover.status,200);assert.equal(Buffer.from(await cover.arrayBuffer()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const preview=await request(listing.previewUrl,'GET',undefined,'');assert.equal(preview.status,200);assert.equal(preview.headers.get('X-Frame-Options'),'SAMEORIGIN');assert.match(preview.headers.get('Content-Security-Policy')!,/sandbox allow-scripts/);
 const file=listing.files.find((f:any)=>f.format==='package');const packageResponse=await request(file.url,'GET',undefined,reader.cookie);assert.equal(packageResponse.status,200);const bytes=new Uint8Array(await packageResponse.arrayBuffer());const portable=await readCommunityPackage(bytes);assert.equal(portable.document.name,document.name);assert.equal(portable.assets.length,1);assert.deepEqual(Buffer.from(portable.assets[0].bytes),pixel);assert.ok(!Buffer.from(bytes).includes(Buffer.from('private-filename')));
 await request(file.url,'HEAD',undefined,reader.cookie);await request(file.url,'GET',undefined,reader.cookie);assert.equal((await db.prepare("SELECT COUNT(*) n FROM community_contributions WHERE action='download'").first<any>())!.n,1);
 cookie=reader.cookie;const remix=(await json(await request(`/api/community/listings/${listing.id}/remix`,'POST',{operationId:'remix-one',version:1}),202)).job;await processCommunityJob(env,remix.id);const remixed=(await json(await request('/api/community/jobs/remix-one'))).job;assert.equal(remixed.status,'succeeded',JSON.stringify(remixed));
 const target=(await json(await request(`/api/projects/${remixed.projectId}`))).project;assert.notEqual(target.id,project.id);assert.notEqual(target.document.pages[0].id,project.document.pages[0].id);
 const form=new FormData();form.set('operationId','import-one');form.set('file',new File([bytes],'studio-project.zip',{type:'application/zip'}));const bucket=env.ASSETS_BUCKET;env.ASSETS_BUCKET={...bucket,get:bucket.get.bind(bucket),delete:bucket.delete.bind(bucket),put:async()=>{throw new Error('Interrupted upload');}};assert.equal((await request('/api/community/imports','POST',form)).status,500);env.ASSETS_BUCKET=bucket;
 const imported=(await json(await request('/api/community/imports','POST',form),202)).job;await processCommunityJob(env,imported.id);assert.equal((await json(await request('/api/community/jobs/import-one'))).job.status,'succeeded');
 await db.prepare('INSERT INTO assets(id,user_id,project_id,name,mime_type,size,storage_key,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('quota-fixture',reader.user.id,target.id,'Quota fixture','image/png',8*1024**3,'test-only-quota',new Date().toISOString()).run();
 assert.equal((await request(`/api/community/listings/${listing.id}/remix`,'POST',{operationId:'quota-remix',version:1})).status,413);assert.equal((await json(await request('/api/community/jobs/quota-remix'))).job.status,'failed');await db.prepare('DELETE FROM assets WHERE id=?').bind('quota-fixture').run();
 cookie=author.cookie;await json(await request(`/api/community/listings/${listing.id}/unlist`,'POST',{operationId:'unlist-one',expectedListingRevision:listing.revision}));assert.equal((await request(file.url,'GET',undefined,'')).status,404);
 const owned=(await json(await request('/api/community/me/listings'))).listings.find((l:any)=>l.id===listing.id);const next=(await json(await request(`/api/community/listings/${listing.id}/releases`,'POST',{...payload,operationId:'expired-release',expectedListingRevision:owned.revision}),202)).job;
 await db.prepare("UPDATE community_jobs SET status='running',lease='expired',lease_until=0 WHERE id=?").bind(next.id).run();
 await json(await request(`/api/projects/${project.id}`,'DELETE'));
 const cleanup=(await db.prepare("SELECT id FROM community_jobs WHERE kind='cleanup' AND listing_id=?").bind(listing.id).first<any>())!;
 const storedBucket=env.ASSETS_BUCKET;env.ASSETS_BUCKET={get:storedBucket.get.bind(storedBucket),put:storedBucket.put.bind(storedBucket),delete:async()=>{throw new Error('Temporary storage deletion outage');}};
 assert.equal(await processCommunityJob(env,cleanup.id),false);assert.equal((await db.prepare('SELECT status FROM community_jobs WHERE id=?').bind(cleanup.id).first<any>())!.status,'queued');env.ASSETS_BUCKET=storedBucket;
 assert.equal(await processCommunityJob(env,cleanup.id),true);assert.equal(await processCommunityJob(env,next.id),true);await reconcileCommunityStorage(env);
 assert.equal((await json(await request('/api/community/jobs/expired-release'))).job.status,'failed');assert.equal((await request('/api/community/me/listings')).status,200);
 assert.equal((await request(`/api/projects/${remixed.projectId}`,'GET',undefined,reader.cookie)).status,200,'Committed remix survives source deletion');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM community_files WHERE listing_id=? AND status!=\'deleted\'').bind(listing.id).first<any>())!.n,0);
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

test('late bucket writes retain charges and cannot erase a replacement artifact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'community-write-fences-')),db=new SqliteDatabase(':memory:'),bucket=new FileBucket(join(directory,'assets'));
 const env:Bindings={DB:db,ASSETS_BUCKET:bucket,COMMUNITY_ENABLED:'true'};
 const time=new Date().toISOString(),document=createDocument('web','Write fence');
 try{
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
  await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind('writer','writer@fixture.test','Writer','unused-test-only',time).run();
  await db.prepare('INSERT INTO projects(id,user_id,name,kind,document,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('source','writer','Source','web',JSON.stringify(document),time,time).run();
  const makeJob=async(jobId:string,source:string|null)=>{await db.prepare("INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,source_project_id,input,status,lease,lease_until,created_at,updated_at) VALUES(?,'writer',?,'hash','publish',?,'{}','running','first-lease',?,?,?)").bind(jobId,jobId,source,Date.now()+300000,time,time).run();await reserveCommunityStorage(env,jobId,'writer',1000);};
  await makeJob('revoked-write','source');
  let release!:()=>void,entered!:()=>void,attemptKey='';const waitForPut=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  env.ASSETS_BUCKET={get:bucket.get.bind(bucket),delete:bucket.delete.bind(bucket),put:async(key,bytes,options)=>{attemptKey=key;entered();await hold;return bucket.put(key,bytes,options);}};
  const old=writeCommunityFile(env,{jobId:'revoked-write',userId:'writer',lease:'first-lease',fileId:'revoked-file',role:'download',format:'pdf',filename:'document.pdf',mimeType:'application/pdf',bytes:new Uint8Array([1,2,3])}).then(()=>null,error=>error);
  await waitForPut;await db.prepare('UPDATE community_jobs SET lease_until=0 WHERE id=?').bind('revoked-write').run();await guardCommunityProjectDeletion(env,'source','writer');await reconcileCommunityStorage(env);
  assert.equal((await db.prepare("SELECT SUM(size) n FROM community_files WHERE job_id=? AND status!='deleted'").bind('revoked-write').first<any>())!.n,3,'An unfinished put remains charged after logical deletion');
  release();assert.equal((await old).code,'lease_lost');await reconcileCommunityStorage(env);assert.equal(await bucket.get(attemptKey),null);assert.equal((await db.prepare("SELECT COALESCE(SUM(size),0) n FROM community_files WHERE job_id=? AND status!='deleted'").bind('revoked-write').first<any>())!.n,0);
  await bucket.put('community/crashed-attempt',new Uint8Array([7,8]));
  await db.prepare("INSERT INTO community_files(id,user_id,job_id,role,filename,mime_type,size,checksum,storage_key,status,write_token,write_until,created_at) VALUES('crashed-attempt','writer','revoked-write','input','__write_crashed','application/pdf',2,'fixture','community/crashed-attempt','intent','crashed-attempt',?,?)").bind(Date.now()+16*60000,time).run();
  await reconcileCommunityStorage(env);assert.ok(await bucket.get('community/crashed-attempt'),'A crashed write remains quarantined while it could still finish');
  await db.prepare("UPDATE community_files SET write_until=0 WHERE id='crashed-attempt'").run();await reconcileCommunityStorage(env);assert.equal(await bucket.get('community/crashed-attempt'),null,'Scheduled recovery deletes the quarantined attempt once its maximum writer lifetime has elapsed');
  env.ASSETS_BUCKET=bucket;await makeJob('replaced-write',null);
  let releaseOld!:()=>void,enteredOld!:()=>void,oldKey='';const waitOld=new Promise<void>(resolve=>{enteredOld=resolve;}),holdOld=new Promise<void>(resolve=>{releaseOld=resolve;});let firstPut=true;
  env.ASSETS_BUCKET={get:bucket.get.bind(bucket),delete:bucket.delete.bind(bucket),put:async(key,bytes,options)=>{if(firstPut){firstPut=false;oldKey=key;enteredOld();await holdOld;}return bucket.put(key,bytes,options);}};
  const loser=writeCommunityFile(env,{jobId:'replaced-write',userId:'writer',lease:'first-lease',fileId:'shared-file',role:'download',format:'pdf',filename:'document.pdf',mimeType:'application/pdf',bytes:new Uint8Array([1,2,3])}).then(()=>null,error=>error);
  await waitOld;await db.prepare("UPDATE community_jobs SET lease='winning-lease',lease_until=? WHERE id=?").bind(Date.now()+300000,'replaced-write').run();
  const winner=await writeCommunityFile(env,{jobId:'replaced-write',userId:'writer',lease:'winning-lease',fileId:'shared-file',role:'download',format:'pdf',filename:'document.pdf',mimeType:'application/pdf',bytes:new Uint8Array([4,5,6,7])});
  releaseOld();assert.equal((await loser).code,'lease_lost');assert.equal(await bucket.get(oldKey),null);assert.deepEqual(new Uint8Array(await (await bucket.get(winner.storage_key))!.arrayBuffer()),new Uint8Array([4,5,6,7]));
  assert.equal((await db.prepare("SELECT SUM(size) n FROM community_files WHERE job_id=? AND status!='deleted'").bind('replaced-write').first<any>())!.n,4);
  await assert.rejects(writeCommunityFile(env,{jobId:'replaced-write',userId:'writer',lease:'winning-lease',fileId:'shared-file',role:'download',format:'pdf',filename:'document.pdf',mimeType:'application/pdf',bytes:new Uint8Array([9])}),{code:'artifact_changed'});
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
