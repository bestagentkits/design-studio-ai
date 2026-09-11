import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {app} from '../server/index';
import {processOperation} from '../server/operation-worker';
import {FileBucket,SqliteDatabase} from '../server/node-adapters';
import {secret} from '../server/security';
import type {Bindings} from '../server/types';
test('durable jobs preserve revisions, recover committed saves, isolate owners and pin export snapshots',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'studio-jobs-')),db=new SqliteDatabase(join(directory,'db.sqlite')),origin='https://studio.test';
 const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),APP_URL:origin,ENCRYPTION_KEY:secret(),ALLOW_REGISTRATION:'true'};
 let cookie='';const request=(path:string,method='GET',body?:unknown,auth=cookie)=>app.request(origin+path,{method,headers:{Origin:origin,Cookie:auth,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
 const json=async(response:Response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json() as Promise<any>;};
 try{
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
  const register=async(email:string)=>{const response=await request('/api/auth/register','POST',{email,password:secret()});assert.equal(response.status,201);return response.headers.get('set-cookie')!.split(';')[0];};
  cookie=await register('owner@jobs.test');const other=await register('other@jobs.test');
  const {project}=await json(await request('/api/projects','POST',{name:'Job test',kind:'web'}),201),base=`/api/projects/${project.id}`,document=structuredClone(project.document);document.name='Committed once';
  const save={kind:'save',operationId:'save-one',input:{document,expectedRevision:project.revision}};
  const [a,b]=await Promise.all([request(base+'/operations','POST',save),request(base+'/operations','POST',save)]);await json(a,202);await json(b,202);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM operation_jobs').first<{n:number}>())!.n,1);
  assert.equal((await request(base+'/operations/save-one','GET',undefined,other)).status,404);
  assert.equal((await request(base+'/operations','POST',{...save,input:{...save.input,document:{...document,name:'Different'}}})).status,409);
  const row=(await db.prepare('SELECT * FROM operation_jobs WHERE operation_id=?').bind('save-one').first<any>())!;
  await Promise.all([processOperation(env,row.id),processOperation(env,row.id)]);
  const status=await json(await request(base+'/operations/save-one'));assert.equal(status.operation.status,'succeeded',JSON.stringify(status));assert.equal(status.operation.revision,project.revision+1);
  // Simulate a worker crash after the save committed but before its receipt was acknowledged.
  await db.prepare("UPDATE operation_jobs SET status='running',lease_until=0 WHERE id=?").bind(row.id).run();await processOperation(env,row.id);
  const saved=await json(await request(base));assert.equal(saved.project.revision,project.revision+1);
  await json(await request(base+'/operations','POST',save));
  const receipt=await json(await request(base+'/operations/save-one/result'));assert.equal(receipt.project.revision,project.revision+1);
  const exportRequest={kind:'export',operationId:'export-one',input:{format:'json',expectedRevision:saved.project.revision}};
  await json(await request(base+'/operations','POST',exportRequest),202);
  const next=structuredClone(document);next.name='Later revision';await json(await request(base+'/document','PUT',{document:next,expectedRevision:saved.project.revision}));
  const exp=(await db.prepare('SELECT * FROM operation_jobs WHERE operation_id=?').bind('export-one').first<any>())!;await processOperation(env,exp.id);
  assert.equal((await json(await request(base+'/operations/export-one/result'))).name,'Committed once');
  const keys=(await db.prepare('SELECT input_key,result_key FROM operation_jobs').all<any>()).results.flatMap(r=>[r.input_key,r.result_key]);
  await json(await request(base,'DELETE'));for(const key of keys)assert.equal(await env.ASSETS_BUCKET.get(key),null);
 }finally{db.native.close();await rm(directory,{recursive:true,force:true});}
});
