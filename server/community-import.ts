import type { Bindings } from './types';
import { communityOperationIdSchema } from '../src/shared/community';
import { readCommunityPackage } from '../src/shared/community-package';
import { communityJobReceipt, dispatchCommunityJob, serializeCommunityJob } from './community-jobs';
import { communityChecksum, reserveCommunityStorage, writeCommunityFile } from './community-assets';
import { fail, id, now } from './security';
export async function importCommunity(env:Bindings,userId:string,operationId:string,bytes:Uint8Array) {
 communityOperationIdSchema.parse(operationId);if(bytes.byteLength>20*1024**2)fail(413,'package_too_large','Studio packages must be at most 20 MiB.');
 const payloadHash=await communityChecksum(bytes),existing=await communityJobReceipt(env,userId,operationId,payloadHash);if(existing&&existing.stage!=='receiving')return serializeCommunityJob(existing);
 let parsed:Awaited<ReturnType<typeof readCommunityPackage>>;try{parsed=await readCommunityPackage(bytes);}catch(error){fail(400,'invalid_package',error instanceof Error?error.message:'Invalid Studio package.');}
 const jobId=existing?.id??id(),time=now(),projectId=existing?JSON.parse(existing.input).projectId:id();
 const total=bytes.byteLength+parsed!.assets.reduce((sum,a)=>sum+a.bytes.byteLength,0);
 await env.DB.prepare("INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,input,stage,created_at,updated_at) VALUES(?,?,?,?,'import',?,'receiving',?,?) ON CONFLICT(user_id,operation_id) DO NOTHING").bind(jobId,userId,operationId,payloadHash,JSON.stringify({projectId,inputFileId:`${jobId}_input`}),time,time).run();
 const receipt=(await communityJobReceipt(env,userId,operationId,payloadHash))!;
 await reserveCommunityStorage(env,receipt.id,userId,total);
 await writeCommunityFile(env,{jobId:receipt.id,userId,fileId:`${receipt.id}_input`,role:'input',filename:'source-package.zip',mimeType:'application/zip',bytes});
 await env.DB.prepare("UPDATE community_jobs SET stage='accepted' WHERE id=? AND status='queued' AND stage='receiving'").bind(receipt.id).run();
 await dispatchCommunityJob(env,receipt.id);return serializeCommunityJob({...receipt,stage:'accepted'});
}
