import type { Bindings } from './types';
import type { CommunityJob } from '../src/shared/community';
import { fail, now, id, hash } from './security';
export interface CommunityJobRow {id:string;user_id:string;operation_id:string;payload_hash:string;kind:string;listing_id:string|null;version:number|null;epoch:number|null;source_project_id:string|null;input:string;result:string|null;status:CommunityJob['status'];stage:string;lease:string|null;lease_until:number;attempts:number;error:string|null;created_at:string;updated_at:string}
export function serializeCommunityJob(row:CommunityJobRow):CommunityJob {const result=row.result?JSON.parse(row.result):{};return {id:row.id,operationId:row.operation_id,kind:row.kind,status:row.status,stage:row.stage,listingId:row.listing_id,version:row.version,...(result.projectId?{projectId:result.projectId}:{}),error:row.error?JSON.parse(row.error):null,createdAt:row.created_at,updatedAt:row.updated_at};}
export async function communityJobReceipt(env:Bindings,userId:string,operationId:string,payloadHash?:string) {const row=await env.DB.prepare('SELECT * FROM community_jobs WHERE user_id=? AND operation_id=?').bind(userId,operationId).first<CommunityJobRow>();if(row&&payloadHash&&row.payload_hash!==payloadHash)fail(409,'operation_conflict','This operation ID already belongs to a different request.');return row;}
export async function dispatchCommunityJob(env:Bindings,jobId:string) {try{await env.OPERATION_QUEUE?.send({kind:'community',id:jobId});}catch{/* The durable receipt remains available to the scheduler and status redispatch. */}}
export async function recordCommunityAction(env:Bindings,userId:string,operationId:string,kind:string,input:unknown,statements:(jobId:string)=>import('./types').Statement[]) {
 const payloadHash=await hash(JSON.stringify({kind,input})),existing=await communityJobReceipt(env,userId,operationId,payloadHash);if(existing)return serializeCommunityJob(existing);
 const jobId=id(),time=now();await env.DB.batch([
 env.DB.prepare("INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,input,status,stage,result,created_at,updated_at) VALUES(?,?,?,?,?,?,'succeeded','completed','{}',?,?) ON CONFLICT(user_id,operation_id) DO NOTHING").bind(jobId,userId,operationId,payloadHash,kind,JSON.stringify(input),time,time),...statements(jobId)]);
 return serializeCommunityJob((await communityJobReceipt(env,userId,operationId,payloadHash))!);
}
export { processCommunityJob, drainCommunityJobs } from './community-worker';
