import {Hono} from 'hono';
import type {Bindings,Env} from './types';
import type {JobRow} from './operation-jobs';
import {operationJobSchema} from '../src/shared/operation-jobs';
import {saveDocument} from './projects';
import {renderProjectExport} from './exports';
import {ApiError} from './security';
export async function processOperation(env:Bindings,id:string){
 const lease=crypto.randomUUID(),now=Date.now();const claim=await env.DB.prepare("UPDATE operation_jobs SET status='running',stage='validating',lease=?,lease_until=?,updated_at=? WHERE id=? AND (status='queued' OR (status='running' AND lease_until<?))").bind(lease,now+16*60000,now,id,now).run();if(!claim.meta.changes){const existing=await env.DB.prepare('SELECT status FROM operation_jobs WHERE id=?').bind(id).first<{status:string}>();return !existing||['succeeded','failed'].includes(existing.status);}
 const row=(await env.DB.prepare('SELECT * FROM operation_jobs WHERE id=?').bind(id).first<JobRow>())!;
 const resultKey=`${row.user_id}/${row.project_id}/operations/${row.id}/result-${lease}`;
 const runner=new Hono<Env>();let error:unknown;
 runner.onError(e=>{error=e;return new Response(null,{status:500});});
 runner.get('/',async c=>{
  // This context is constructed only by the internal runner, never by request headers.
  c.set('user',{id:row.user_id,email:'',name:''});c.set('authMethod','token');c.set('tokenKind','api');
  const stored=await env.ASSETS_BUCKET.get(row.input_key);if(!stored)throw new Error('Operation input unavailable');const payload=JSON.parse(new TextDecoder().decode(await stored.arrayBuffer())),request=operationJobSchema.parse(payload.request);
  await env.DB.prepare('UPDATE operation_jobs SET stage=?,updated_at=? WHERE id=? AND lease=?').bind(request.kind==='save'?'saving':'rendering',Date.now(),id,lease).run();
  let response:Response,revision:number;
  if(request.kind==='save'){const input=request.input,project=await saveDocument(c,row.project_id,input.document,input.expectedRevision,input.expectedBriefRevision,`job-${row.id}`);revision=project.revision;response=Response.json({project});}
  else {response=await renderProjectExport(c,row.project_id,request.input,false,payload.snapshot);revision=request.input.expectedRevision;}
  const bytes=await response.arrayBuffer();if(bytes.byteLength>100*1024*1024)throw new Error('Operation result exceeds 100 MB');
  await env.ASSETS_BUCKET.put(resultKey,bytes,{httpMetadata:{contentType:response.headers.get('Content-Type')??'application/octet-stream'}});
  const done=await env.DB.prepare("UPDATE operation_jobs SET status='succeeded',stage='complete',result_key=?,result_type=?,revision=?,error=NULL,lease_until=0,updated_at=? WHERE id=? AND lease=?").bind(resultKey,response.headers.get('Content-Type'),revision,Date.now(),id,lease).run();if(!done.meta.changes)await env.ASSETS_BUCKET.delete(resultKey);else if(row.result_key&&row.result_key!==resultKey)await env.ASSETS_BUCKET.delete(row.result_key);
  return new Response(null,{status:204});
 });
 try{await runner.request(`${env.APP_URL??'http://localhost'}/`,{},env);if(error)throw error;}
 catch(e){const failure=e instanceof ApiError?{code:e.code,message:e.message}:{code:'operation_failed',message:'Operation failed. The original request is retained; inspect the project before starting a new operation.'};await env.DB.prepare("UPDATE operation_jobs SET status='failed',stage='failed',error=?,lease_until=0,updated_at=? WHERE id=? AND lease=?").bind(JSON.stringify(failure),Date.now(),id,lease).run();}
 return true;
}
export async function drainOperations(env:Bindings){const rows=await env.DB.prepare("SELECT id FROM operation_jobs WHERE status='queued' OR (status='running' AND lease_until<?) ORDER BY created_at LIMIT 1").bind(Date.now()).all<{id:string}>();for(const row of rows.results)await processOperation(env,row.id);}
