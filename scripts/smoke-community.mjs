import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {readCommunityPackage} from '../src/shared/community-package.ts';
import {encodePaintPng} from '../src/shared/paint-png.ts';

// Release-only verification. All accounts, projects and files belong to this run.
const origin=process.env.COMMUNITY_SMOKE_ORIGIN??'https://studio.agentkit.best';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account&&token,'Cloudflare credentials are required for isolated verification cleanup.');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),database=config.d1_databases[0].database_id;
assert.equal(origin,config.vars.APP_URL,'Verification origin must match this deployment and its cleanup database.');
const run=randomUUID(),users=[],projects=[],identities=[];let listingId;
const receiptDirectory=new URL('../.data/community-smoke/',import.meta.url),receiptPath=new URL(run+'.json',receiptDirectory);
await mkdir(receiptDirectory,{recursive:true});
const saveReceipt=async(cleaned=false)=>writeFile(receiptPath,JSON.stringify({run,origin,database,identities,projectIds:projects.map(project=>project.id),listingId,updatedAt:new Date().toISOString(),...(cleaned?{cleanedAt:new Date().toISOString()}:{})},null,2),{mode:0o600});
await saveReceipt();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const db=async(sql,params=[])=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.ok(response.ok&&data.success,'Verification database operation failed.');return data.result[0].results;
};
const request=(path,method='GET',body,user)=>fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(90000),headers:{Origin:origin,...(user?{Cookie:user.cookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
const json=async(response,status=200)=>{assert.equal(response.status,status,`Unexpected HTTP status (${response.status})`);return response.json();};
const job=async(operationId,user)=>{
  const deadline=Date.now()+300000;
  while(Date.now()<deadline){const {job}=await json(await request('/api/community/jobs/'+operationId,'GET',undefined,user));if(job.status==='failed')throw new Error('Community operation failed: '+job.error?.code);if(job.status==='succeeded')return job;await delay(1500);}
  throw new Error('Community operation did not complete within five minutes.');
};
async function register(role){
  const email=`community-smoke-${role}-${run}@studio-test.invalid`,identity={email};identities.push(identity);await saveReceipt();
  const response=await request('/api/auth/register','POST',{email,password:randomUUID()+randomUUID(),name:'Community release verification'});
  const body=await json(response,201),user={id:body.user.id,email,cookie:response.headers.get('set-cookie').split(';')[0]};users.push(user);identity.id=user.id;await saveReceipt();return user;
}
async function settleOwnedJobs(userIds){
  const placeholders=userIds.map(()=>'?').join(','),deadline=Date.now()+35*60*1000;
  // A settled request cannot resume receiving. Fence any uncertain upload; its write attempts remain charged below.
  await db(`UPDATE community_jobs SET status='failed',stage='failed',error=? WHERE user_id IN(${placeholders}) AND status='queued' AND stage='receiving'`,[JSON.stringify({code:'verification_cleanup',message:'The isolated verification upload was abandoned.'}),...userIds]);
  while(true){
    const pending=await db(`SELECT user_id,operation_id FROM community_jobs WHERE user_id IN(${placeholders}) AND status IN('queued','running')`,userIds);
    const writers=await db(`SELECT COUNT(*) n FROM community_files WHERE user_id IN(${placeholders}) AND status!='deleted' AND write_token=id AND write_until>?`,[...userIds,Date.now()]);
    if(!pending.length&&!writers[0].n)return;
    assert.ok(Date.now()<deadline,'Verification cleanup is waiting for an active job/write quarantine; recovery identities remain in the ignored receipt.');
    for(const pendingJob of pending){const user=users.find(user=>user.id===pendingJob.user_id);assert.ok(user?.cookie,'A pending verification job needs its original session for recovery.');await json(await request('/api/community/jobs/'+pendingJob.operation_id,'GET',undefined,user));}
    await delay(3000);
  }
}
try{
  const configuration=await json(await request('/api/config'));assert.equal(configuration.community.enabled,true);
  const openapi=await json(await request('/api/openapi'));assert.ok(openapi.paths['/api/community/imports']);
  const author=await register('author'),reader=await register('reader');
  const handle='release-'+run.slice(0,12);await json(await request('/api/community/me/profile','PUT',{handle,displayName:'Release verification',expectedProfileRevision:0},author));
  const {project}=await json(await request('/api/projects','POST',{name:'Community verification '+run,kind:'web'},author),201);projects.push({id:project.id,user:author});
  const png=new Uint8Array(await encodePaintPng(2,2,new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]))),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'verification.png');
  const {asset}=await json(await request(`/api/projects/${project.id}/assets`,'POST',form,author),201);
  project.document.theme.fonts={heading:'Arial',body:'Arial'};
  const page=project.document.pages[0];page.width=480;page.height=360;page.notes='PRIVATE-COMMUNITY-SMOKE';
  page.nodes=[{id:'public-image',type:'image',name:'Visible image',x:0,y:0,width:80,height:80,src:asset.url},{id:'private-text',type:'text',name:'Hidden',text:'PRIVATE-COMMUNITY-SMOKE',visible:false,x:0,y:0,width:80,height:80},{id:'next',type:'component',name:'Next',x:100,y:0,width:180,height:50,component:{name:'Button',system:'shadcn',props:{label:'Next page',internalNotes:'PRIVATE-COMMUNITY-SMOKE'}},interactions:[{trigger:'click',action:'navigate',target:'second-page'}]}];
  project.document.pages.push({id:'second-page',name:'Second page',width:480,height:360,background:'#123456',nodes:[]});project.document.assets=[asset];
  await json(await request(`/api/projects/${project.id}/document`,'PUT',{document:project.document,expectedRevision:project.revision},author));
  const metadata={projectId:project.id,expectedProjectRevision:2,title:'Release verification '+run,description:'Temporary isolated release verification; removed after checks.',tags:['release-verification'],formats:[{format:'json'},{format:'html'},{format:'svg',pageIndex:1}],cover:{pageIndex:1,time:0,focalX:.25,focalY:.75}};
  const {preflight}=await json(await request('/api/community/preflight','POST',metadata,author));assert.ok(!JSON.stringify(preflight.document).includes('PRIVATE-COMMUNITY-SMOKE'));
  const publication={...metadata,operationId:'publish-'+run,digest:preflight.digest,license:'CC-BY-4.0',acceptLicense:true,confirmPublic:true};
  assert.equal((await request('/api/community/listings','POST',{...publication,confirmPublic:false},author)).status,400);
  const accepted=await json(await request('/api/community/listings','POST',publication,author),202);listingId=accepted.job.listingId;
  assert.equal((await json(await request('/api/community/listings','POST',publication,author),202)).job.id,accepted.job.id);
  await job(publication.operationId,author);
  console.log('PASS production preflight privacy, explicit consent, exact retry and real queued publication.');
  const {listing}=await json(await request('/api/community/listings/'+listingId));
  const results=await json(await request('/api/community/listings?'+new URLSearchParams({q:run,kind:'web',format:'package',sort:'relevance'})));assert.equal(results.listings[0].id,listingId);
  const html=await(await request('/community/designs/'+listingId)).text();assert.ok(html.includes(listing.title));assert.ok(html.includes('rel="canonical"'));assert.ok(!html.includes('PRIVATE-COMMUNITY-SMOKE'));
  const preview=await request(listing.previewUrl);assert.equal(preview.status,200);assert.equal(preview.headers.get('X-Frame-Options'),'SAMEORIGIN');assert.match(preview.headers.get('Content-Security-Policy'),/sandbox allow-scripts/);
  const cover=await request(listing.coverUrl);assert.equal(cover.status,200);const coverBytes=Buffer.from(await cover.arrayBuffer());assert.equal(coverBytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(coverBytes.readUInt32BE(16),480);assert.equal(coverBytes.readUInt32BE(20),360);
  const archive=listing.files.find(file=>file.format==='package');assert.ok(archive);
  const downloaded=await request(archive.url,'GET',undefined,reader);assert.equal(downloaded.status,200);const archiveBytes=new Uint8Array(await downloaded.arrayBuffer()),parsed=await readCommunityPackage(archiveBytes);assert.ok(!JSON.stringify(parsed.document).includes('PRIVATE-COMMUNITY-SMOKE'));assert.equal(parsed.assets.length,1);
  const portableJson=await(await request(listing.files.find(file=>file.format==='json').url)).json();assert.match(portableJson.assets[0].url,/^data:image\/png;base64,/);
  assert.equal(listing.files.find(file=>file.format==='svg').options.pageIndex,1);
  await json(await request(`/api/community/listings/${listingId}/bookmark`,'PUT',undefined,reader));assert.equal((await json(await request('/api/community/me/bookmarks','GET',undefined,reader))).listings[0].id,listingId);
  const remixId='remix-'+run;await json(await request(`/api/community/listings/${listingId}/remix`,'POST',{operationId:remixId,version:listing.version},reader),202);const remixed=await job(remixId,reader);projects.push({id:remixed.projectId,user:reader});
  const importedId='import-'+run,upload=new FormData();upload.set('file',new Blob([archiveBytes],{type:'application/zip'}),'design.zip');upload.set('operationId',importedId);await json(await request('/api/community/imports','POST',upload,reader),202);const imported=await job(importedId,reader);projects.push({id:imported.projectId,user:reader});
  if(process.env.COMMUNITY_SMOKE_LARGE_PACKAGE){
    const largeBytes=await readFile(process.env.COMMUNITY_SMOKE_LARGE_PACKAGE),largeUpload=new FormData(),largeOperation='large-import-'+run;
    largeUpload.set('file',new Blob([largeBytes],{type:'application/zip'}),'large-design.zip');largeUpload.set('operationId',largeOperation);
    await json(await request('/api/community/imports','POST',largeUpload,reader),202);
    const large=await job(largeOperation,reader);projects.push({id:large.projectId,user:reader});
    const {project:largeProject}=await json(await request('/api/projects/'+large.projectId,'GET',undefined,reader));
    const expected=await readCommunityPackage(new Uint8Array(largeBytes));assert.equal(largeProject.document.assets.length,expected.assets.length);
    for(let index=0;index<expected.assets.length;index++){const media=await request(largeProject.document.assets[index].url,'GET',undefined,reader);assert.equal(media.status,200);assert.deepEqual(new Uint8Array(await media.arrayBuffer()),expected.assets[index].bytes);}
    console.log('PASS production near-64-MiB expanded import and every independent media byte.');
  }
  await json(await request(`/api/community/listings/${listingId}/reports`,'POST',{operationId:'report-'+run,version:listing.version,reason:'other',message:'Temporary release verification report.'},reader),201);assert.equal((await request('/api/community/moderation/reports','GET',undefined,reader)).status,403);
  const credential=await json(await request('/api/tokens','POST',{name:'Temporary Community release verification'},author),201);
  const mcp=await fetch(origin+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+credential.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(30000)});assert.equal(mcp.status,200);const tools=await mcp.text();assert.ok(tools.includes('community_publish')&&tools.includes('community_download'));
  await json(await request('/api/tokens/'+credential.id,'DELETE',undefined,author));
  console.log('PASS production discovery, no-JS detail, sandbox headers, cover/ZIP/JSON bytes, bookmark, independent remix/import, report authorization and MCP discovery.');
  await json(await request(`/api/projects/${project.id}`,'DELETE',undefined,author));
  assert.equal((await request(archive.url)).status,404);
  for(const id of [remixed.projectId,imported.projectId]){const {project:copy}=await json(await request('/api/projects/'+id,'GET',undefined,reader));const independentAsset=await request(copy.document.assets[0].url,'GET',undefined,reader);assert.equal(independentAsset.status,200);assert.deepEqual(new Uint8Array(await independentAsset.arrayBuffer()),png);assert.equal(copy.document.pages[0].nodes.find(node=>node.name==='Next').interactions[0].target,copy.document.pages[1].id);assert.notEqual(copy.document.pages[1].id,'second-page');}
  const deadline=Date.now()+120000;let files;
  do{files=await db("SELECT COUNT(*) n FROM community_files WHERE listing_id=? AND status!='deleted'",[listingId]);if(files[0].n===0)break;await delay(2000);}while(Date.now()<deadline);
  assert.equal(files[0].n,0,'Source deletion must drive queue cleanup without unrelated work.');
  console.log('PASS production source revocation, queue-driven purge and surviving independent asset bytes.');
}finally{
  // Verify every identity before mutation, including registration whose HTTP response was lost.
  for(const identity of identities){
    assert.ok(identity.email.endsWith(`-${run}@studio-test.invalid`));
    const matches=await db('SELECT id FROM users WHERE email=?',[identity.email]);
    assert.ok(matches.length<=1,'Verification identity is ambiguous.');
    if(identity.id)assert.equal(matches[0]?.id,identity.id,'Only this run may be cleaned.');
    if(matches.length&&!identity.id){identity.id=matches[0].id;users.push({id:identity.id,email:identity.email});}
  }
  await saveReceipt();
  const userIds=users.map(user=>user.id);
  if(userIds.length){
    const placeholders=userIds.map(()=>'?').join(','),listingSelector=`SELECT id FROM community_listings WHERE user_id IN(${placeholders})`;
    await settleOwnedJobs(userIds);
    // A job may have committed after a polling timeout or a lost response; the database owns the inventory.
    const ownedProjects=await db(`SELECT id,user_id FROM projects WHERE user_id IN(${placeholders})`,userIds);
    for(const owned of ownedProjects)if(!projects.some(project=>project.id===owned.id))projects.push({id:owned.id,user:users.find(user=>user.id===owned.user_id)});
    await saveReceipt();
    for(const project of projects){
      assert.ok(project.user?.cookie,'A recovered project needs the original verification session for API deletion.');
      let response=await request('/api/projects/'+project.id,'DELETE',undefined,project.user);const deadline=Date.now()+330000;
      while(response.status===409&&Date.now()<deadline){await delay(3000);response=await request('/api/projects/'+project.id,'DELETE',undefined,project.user);}
      assert.ok(response.status===200||response.status===404,'Verification project cleanup failed.');
    }
    // Project deletion can enqueue cleanup. Never purge records while a queue worker or delayed put can still write.
    await settleOwnedJobs(userIds);
    assert.equal((await db(`SELECT COUNT(*) n FROM projects WHERE user_id IN(${placeholders})`,userIds))[0].n,0,'A verification project appeared during cleanup; retain recovery records.');
    const files=await db(`SELECT user_id,storage_key FROM community_files WHERE user_id IN(${placeholders})`,userIds);
    for(const file of files){assert.ok(file.storage_key.startsWith('community/'+file.user_id+'/'));const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/design-studio-ai-assets/objects/${file.storage_key.split('/').map(encodeURIComponent).join('/')}`,{method:'DELETE',redirect:'manual',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});assert.ok(response.ok||response.status===404,'Verification file cleanup failed.');}
    await db(`DELETE FROM community_moderation_actions WHERE report_id IN(SELECT id FROM community_reports WHERE listing_id IN(${listingSelector}))`,userIds);
    for(const table of ['community_collection_items','community_reports','community_contributions','community_bookmarks','community_daily_stats','community_delivery_receipts'])await db(`DELETE FROM ${table} WHERE listing_id IN(${listingSelector})`,userIds);
    await db(`DELETE FROM community_search WHERE listing_id IN(${listingSelector})`,userIds);
    // Reader remix jobs reference author listings: remove all users' dependencies before any listing or account.
    await db(`DELETE FROM community_files WHERE user_id IN(${placeholders})`,userIds);
    await db(`DELETE FROM community_storage_reservations WHERE user_id IN(${placeholders})`,userIds);
    await db(`DELETE FROM community_jobs WHERE user_id IN(${placeholders})`,userIds);
    await db(`DELETE FROM community_versions WHERE listing_id IN(${listingSelector})`,userIds);
    await db(`DELETE FROM community_listings WHERE user_id IN(${placeholders})`,userIds);
    for(const project of projects)await db('DELETE FROM community_source_locks WHERE project_id=?',[project.id]);
    for(const user of users)await db('DELETE FROM users WHERE id=? AND email=?',[user.id,user.email]);
  }
  await saveReceipt(true);
  console.log('CLEANED isolated Community verification accounts, projects and files.');
}
