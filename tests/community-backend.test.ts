import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {app} from '../server/index';
import {SqliteDatabase,FileBucket} from '../server/node-adapters';
import {secret,now} from '../server/security';
import {communityProfileSchema,communityPublishSchema} from '../src/shared/community';
import {communityFtsQuery,normalizeCommunityText} from '../src/shared/community-search';
import {createDocument} from '../src/shared/catalog';
import type {Bindings} from '../server/types';
import {reconcileCommunityStorage} from '../server/community-worker';
import {reserveCommunityStorage,writeCommunityFile} from '../server/community-assets';

test('Community schemas normalize Vietnamese and reject ambiguous approval and profiles',()=>{
 assert.equal(normalizeCommunityText('Đồ Án Thiết Kế'),'do an thiet ke');
 assert.equal(communityFtsQuery('"OR" * Đồ (NOT)'), '"or"* AND "do"* AND "not"*');
 assert.equal(communityProfileSchema.safeParse({handle:'admin',displayName:'Public',expectedProfileRevision:0}).success,false);
 assert.equal(communityPublishSchema.safeParse({projectId:'abc',expectedProjectRevision:1,title:'A',operationId:'op',digest:'a'.repeat(32),license:'CC-BY-4.0',acceptLicense:true,confirmPublic:false}).success,false);
});
test('Community migration, live search, profile privacy, idempotent engagement and moderation use real SQLite',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'community-backend-')),db=new SqliteDatabase(':memory:'),origin='https://community.test';
 const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),APP_URL:origin,ENCRYPTION_KEY:secret(),ALLOW_REGISTRATION:'true',COMMUNITY_ENABLED:'true'};
 let cookie='';const request=(path:string,method='GET',body?:unknown,auth=cookie)=>app.request(origin+path,{method,headers:{Origin:origin,Cookie:auth,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
 const json=async(response:Response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json() as Promise<any>;};
 try{
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
 const register=async(email:string)=>{const response=await request('/api/auth/register','POST',{email,password:secret()});assert.equal(response.status,201);const body=await response.json() as any;return {cookie:response.headers.get('set-cookie')!.split(';')[0],user:body.user};};
 const author=await register('author@community.test'),reader=await register('reader@community.test');cookie=author.cookie;
 await json(await request('/api/community/me/profile','PUT',{handle:'designer',displayName:'Đồ Án',bio:'Public bio',expectedProfileRevision:0}));
 assert.equal((await request('/api/community/me/profile','PUT',{handle:'designer-two',displayName:'Stale',expectedProfileRevision:0})).status,409);
 const profile=await json(await request('/api/community/me/profile'));assert.equal(profile.profile.revision,1);assert.ok(!JSON.stringify(profile).includes('author@'));
 const time=now(),document=createDocument('web','Public example');
 await db.prepare('INSERT INTO community_listings(id,user_id,created_at,updated_at) VALUES(?,?,?,?)').bind('listed-design',author.user.id,time,time).run();
 await db.prepare("INSERT INTO community_versions(listing_id,version,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,status,created_at) VALUES(?,1,?,'Thiết Kế Đồ Án','A public design','web','[\"minimal\"]','{}','thiet ke do an','{}','CC-BY-4.0',1,'checksum','ready',?)").bind('listed-design',JSON.stringify(document),time).run();
 await db.prepare('UPDATE community_listings SET current_version=1,owner_available=1,first_published_at=? WHERE id=?').bind(time,'listed-design').run();
 await db.prepare("INSERT INTO community_versions(listing_id,version,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,status,created_at) SELECT listing_id,2,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,'failed',created_at FROM community_versions WHERE listing_id=? AND version=1").bind('listed-design').run();
 await db.prepare("INSERT INTO community_versions(listing_id,version,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,status,created_at) SELECT listing_id,3,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,'ready',created_at FROM community_versions WHERE listing_id=? AND version=1").bind('listed-design').run();
 await reconcileCommunityStorage(env);assert.equal((await db.prepare('SELECT status FROM community_versions WHERE listing_id=? AND version=1').bind('listed-design').first<any>())!.status,'ready','A failed version does not evict the previous successful version');
 const list=await json(await request('/api/community/listings?q=do%20an&sort=relevance','GET',undefined,''));assert.equal(list.listings.length,1);assert.equal(list.listings[0].title,'Thiết Kế Đồ Án');assert.ok(!JSON.stringify(list).includes('sourceProjectId'));
 assert.equal((await json(await request('/api/community/listings?q=private-secret','GET',undefined,''))).listings.length,0);
 cookie=reader.cookie;await json(await request('/api/community/listings/listed-design/bookmark','PUT'));await json(await request('/api/community/listings/listed-design/bookmark','PUT'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM community_bookmarks').first<any>())!.n,1);
 const report=(await json(await request('/api/community/listings/listed-design/reports','POST',{operationId:'report-one',version:1,reason:'privacy',message:'Please review this design.'}),201)).report;
 assert.equal((await request('/api/community/moderation/reports')).status,403);env.COMMUNITY_ADMIN_IDS=reader.user.id;
 const detail=(await json(await request(`/api/community/moderation/reports/${report.id}`))).report;
 await json(await request(`/api/community/moderation/reports/${report.id}/resolve`,'POST',{operationId:'hide-one',expectedReportRevision:detail.revision,expectedListingRevision:detail.listingRevision,action:'hide',reason:'Review needed.'}));
 assert.equal((await request('/api/community/listings/listed-design','GET',undefined,'')).status,404);
 assert.equal((await json(await request('/api/community/listings','GET',undefined,''))).listings.length,0);
 await db.prepare('UPDATE community_listings SET owner_available=0,revision=revision+1 WHERE id=?').bind('listed-design').run();
 const hidden=(await json(await request(`/api/community/moderation/reports/${report.id}`))).report;
 await json(await request(`/api/community/moderation/reports/${report.id}/resolve`,'POST',{operationId:'restore-one',expectedReportRevision:hidden.revision,expectedListingRevision:hidden.listingRevision,action:'restore',reason:'Issue resolved.'}));
 assert.equal((await request('/api/community/listings/listed-design','GET',undefined,'')).status,404,'Moderator restore cannot undo owner unlist');
 assert.equal((await json(await request('/api/community/me/bookmarks'))).listings.length,0);
 env.COMMUNITY_ENABLED='false';assert.equal((await request('/api/community/listings','GET',undefined,'')).status,503);
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

test('a lost promotion response preserves committed artifact bytes and exact retry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'community-promotion-response-')),db=new SqliteDatabase(':memory:'),bucket=new FileBucket(join(directory,'assets'));
 const env:Bindings={DB:db,ASSETS_BUCKET:bucket,COMMUNITY_ENABLED:'true'},time=now();
 try{
  for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
  await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind('writer','promotion@fixture.test','Writer','unused-test-only',time).run();
  await db.prepare('INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,input,status,lease,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind('promotion-job','writer','promotion-operation','hash','publish','{}','running','writer-lease',Date.now()+300000,time,time).run();
  await reserveCommunityStorage(env,'promotion-job','writer',100);
  const bytes=new Uint8Array([37,80,68,70,45,49,46,55]),input={jobId:'promotion-job',userId:'writer',lease:'writer-lease',fileId:'promotion-file',role:'download' as const,format:'pdf' as const,filename:'document.pdf',mimeType:'application/pdf',bytes};
  const originalBatch=db.batch.bind(db);let batches=0;
  db.batch=async statements=>{
   const result=await originalBatch(statements);
   if(++batches===2)throw new Error('Promotion committed but its response was lost');
   return result;
  };
  await assert.rejects(writeCommunityFile(env,input),/Promotion committed but its response was lost/);
  db.batch=originalBatch;
  const committed=await db.prepare('SELECT status,storage_key FROM community_files WHERE id=?').bind(input.fileId).first<{status:string;storage_key:string}>();
  assert.equal(committed?.status,'ready');
  const stored=await bucket.get(committed!.storage_key);assert.ok(stored,'Compensation must preserve the key already owned by the committed logical file');
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()),bytes);
  const retried=await writeCommunityFile(env,input);assert.equal(retried.storage_key,committed!.storage_key);
  await reconcileCommunityStorage(env);
  assert.deepEqual(new Uint8Array(await (await bucket.get(retried.storage_key))!.arrayBuffer()),bytes);
  assert.equal((await db.prepare("SELECT SUM(size) bytes FROM community_files WHERE job_id=? AND status!='deleted'").bind(input.jobId).first<{bytes:number}>())!.bytes,bytes.byteLength,'The ready bytes stay charged exactly once');
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
