import {Hono,type Context} from 'hono';
import type {Env,Bindings} from './types';
import {operationJobSchema,type OperationJob} from '../src/shared/operation-jobs';
import {projectRow} from './projects';
import {paintHash} from '../src/shared/paint-png';
import {fail,owner,rateLimit} from './security';
export type JobRow={id:string;project_id:string;user_id:string;operation_id:string;payload_hash:string;kind:'save'|'export';status:OperationJob['status'];stage:string;input_key:string;result_key:string|null;result_type:string|null;revision:number|null;error:string|null;lease:string|null;lease_until:number;created_at:number;updated_at:number};
export const operationRoutes=new Hono<Env>();
export function jobView(row:JobRow):OperationJob{return {id:row.operation_id,kind:row.kind,status:row.status,stage:row.stage,revision:row.revision,error:row.error?JSON.parse(row.error):null,resultUrl:row.status==='succeeded'?`/api/projects/${row.project_id}/operations/${row.operation_id}/result`:null,createdAt:row.created_at,updatedAt:row.updated_at};}
async function ownedJob(c:Context<Env>){await projectRow(c,c.req.param('id')!);const row=await c.env.DB.prepare('SELECT * FROM operation_jobs WHERE project_id=? AND user_id=? AND operation_id=?').bind(c.req.param('id'),owner(c),c.req.param('operationId')).first<JobRow>();if(!row)fail(404,'not_found','Unknown operation');return row!;}
export async function dispatchJob(env:Bindings,id:string){if(!env.OPERATION_QUEUE)return;const now=Date.now();await env.DB.prepare("UPDATE operation_jobs SET status='queued',dispatched_at=0 WHERE id=? AND status='running' AND lease_until<?").bind(id,now).run();const claimed=await env.DB.prepare("UPDATE operation_jobs SET dispatched_at=? WHERE id=? AND status='queued' AND dispatched_at<?").bind(now,id,now-30000).run();if(claimed.meta.changes)try{await env.OPERATION_QUEUE.send({id});}catch(e){await env.DB.prepare('UPDATE operation_jobs SET dispatched_at=0 WHERE id=?').bind(id).run();throw e;}}
operationRoutes.post('/:id/operations',async c=>{
 const row=await projectRow(c,c.req.param('id')!),body=operationJobSchema.parse(await c.req.json()),encoded=JSON.stringify(body),hash=await paintHash(new TextEncoder().encode(encoded));
 let job=await c.env.DB.prepare('SELECT * FROM operation_jobs WHERE project_id=? AND user_id=? AND operation_id=?').bind(row.id,owner(c),body.operationId).first<JobRow>();
 if(job){if(job.payload_hash!==hash)fail(409,'operation_id_conflict','Operation ID belongs to a different request');await dispatchJob(c.env,job.id);return c.json({operation:jobView(job)},job.status==='succeeded'?200:202);}
 if(body.input.expectedRevision!==row.revision)fail(409,'revision_conflict','Read the current revision before starting an operation');
 await rateLimit(c,`operation:${owner(c)}`,30);
 const count=await c.env.DB.prepare("SELECT COUNT(*) AS count FROM operation_jobs WHERE user_id=? AND status IN ('queued','running')").bind(owner(c)).first<{count:number}>();if((count?.count??0)>=4)fail(429,'operations_busy','Wait for a pending operation before starting another');
 const id=crypto.randomUUID(),inputKey=`${owner(c)}/${row.id}/operations/${id}/input`,now=Date.now();
 // Store the accepted export snapshot before dispatch; later project edits do not alter it.
 await c.env.ASSETS_BUCKET.put(inputKey,new TextEncoder().encode(JSON.stringify({request:body,snapshot:body.kind==='export'?row:undefined})),{httpMetadata:{contentType:'application/json'}});
 let result;try{result=await c.env.DB.prepare('INSERT OR IGNORE INTO operation_jobs(id,project_id,user_id,operation_id,payload_hash,kind,input_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,row.id,owner(c),body.operationId,hash,body.kind,inputKey,now,now).run();}catch(e){await c.env.ASSETS_BUCKET.delete(inputKey);throw e;}
 if(!result.meta.changes)await c.env.ASSETS_BUCKET.delete(inputKey);
 job=await c.env.DB.prepare('SELECT * FROM operation_jobs WHERE project_id=? AND user_id=? AND operation_id=?').bind(row.id,owner(c),body.operationId).first<JobRow>();if(job!.payload_hash!==hash)fail(409,'operation_id_conflict','Operation ID belongs to a different request');await dispatchJob(c.env,job!.id);return c.json({operation:jobView(job!)},202);
});
operationRoutes.get('/:id/operations/:operationId',async c=>{const row=await ownedJob(c);if(row.status==='queued'||(row.status==='running'&&row.lease_until<Date.now()))await dispatchJob(c.env,row.id);return c.json({operation:jobView(row)});});
operationRoutes.get('/:id/operations/:operationId/result',async c=>{const row=await ownedJob(c);if(row.status!=='succeeded'||!row.result_key)fail(409,'operation_not_ready','Wait for successful completion');const result=await c.env.ASSETS_BUCKET.get(row.result_key!);if(!result)fail(410,'result_unavailable','The operation result is unavailable');return new Response(result!.body,{headers:{'Content-Type':row.result_type??'application/octet-stream',...(result!.httpMetadata?.contentDisposition?{'Content-Disposition':result!.httpMetadata.contentDisposition}:{}),'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});});
