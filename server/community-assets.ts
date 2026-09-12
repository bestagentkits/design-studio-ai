import type { Bindings } from './types';
import { OWNER_ASSET_QUOTA } from './asset-lifecycle';
import { fail, id, now } from './security';
import type { CommunityFileRow } from './community-queries';
export const COMMUNITY_MAX_FILE_BYTES=64*1024**2;
// Queue invocations expire within fifteen minutes. Crashed writers retain a charge beyond that bound.
export const COMMUNITY_WRITE_QUARANTINE_MS=16*60*1000;
const inflightWrites=new Set<string>();
type WriteRow=CommunityFileRow & {write_token:string|null;write_until:number};
export async function communityChecksum(bytes:Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function reserveCommunityStorage(env:Bindings,jobId:string,userId:string,bytes:number) {
 const result=await env.DB.prepare(`INSERT INTO community_storage_reservations(job_id,user_id,bytes,expires_at) SELECT ?,?,?,? WHERE
 COALESCE((SELECT SUM(size) FROM assets WHERE user_id=?),0)+COALESCE((SELECT SUM(bytes) FROM asset_reservations WHERE user_id=? AND expires_at>=?),0)+COALESCE((SELECT SUM(size) FROM community_files WHERE user_id=? AND status!='deleted'),0)+COALESCE((SELECT SUM(bytes) FROM community_storage_reservations WHERE user_id=?),0)+?<=? ON CONFLICT(job_id) DO NOTHING`).bind(jobId,userId,bytes,Date.now()+3600000,userId,userId,Date.now(),userId,userId,bytes,OWNER_ASSET_QUOTA).run();
 if(!result.meta.changes&&!await env.DB.prepare('SELECT job_id FROM community_storage_reservations WHERE job_id=?').bind(jobId).first())fail(413,'asset_quota_exceeded','Storage is full, including Community files and cleanup awaiting deletion.');
}
export async function assertCommunityLease(env:Bindings,jobId:string,lease:string) {const result=await env.DB.prepare("UPDATE community_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease=? AND status='running' AND lease_until>?").bind(Date.now()+300000,now(),jobId,lease,Date.now()).run();if(!result.meta.changes)fail(409,'lease_lost','This worker no longer owns the operation.');}
async function discardWrite(env:Bindings,writeId:string,storageKey:string) {
 // A committed promotion can lose its response. Resolve durable ownership before deleting;
 // an unavailable database leaves the attempt for reconciliation instead of guessing.
 const committed=await env.DB.prepare("SELECT id FROM community_files WHERE storage_key=? AND id!=? AND status!='deleted'").bind(storageKey,writeId).first();
 if(committed)return;
 // Each attempt has its own key; compensation cannot erase a successor's committed artifact.
 await env.ASSETS_BUCKET.delete(storageKey);
 await env.DB.batch([
  env.DB.prepare("UPDATE community_files SET status='deleted',write_until=0 WHERE id=? AND status!='deleted'").bind(writeId),
  env.DB.prepare("UPDATE community_storage_reservations SET bytes=bytes+COALESCE((SELECT size FROM community_files WHERE id=?),0) WHERE job_id=(SELECT job_id FROM community_files WHERE id=?) AND changes()=1").bind(writeId,writeId)
 ]);
}
export async function writeCommunityFile(env:Bindings,args:{jobId:string;userId:string;listingId?:string|null;version?:number|null;lease?:string;fileId:string;role:CommunityFileRow['role'];format?:CommunityFileRow['format'];options?:unknown;filename:string;mimeType:string;bytes:Uint8Array}) {
 if(args.bytes.byteLength>COMMUNITY_MAX_FILE_BYTES)fail(413,'artifact_too_large','A Community artifact may contain at most 64 MiB.');
 if(args.lease)await assertCommunityLease(env,args.jobId,args.lease);
 const existing=await env.DB.prepare('SELECT * FROM community_files WHERE id=? AND job_id=?').bind(args.fileId,args.jobId).first<WriteRow>(),checksum=await communityChecksum(args.bytes);
 if(existing?.status==='ready'){
  if(existing.checksum!==checksum)fail(409,'artifact_changed','A ready artifact is immutable. Start a new operation.');
  const object=await env.ASSETS_BUCKET.get(existing.storage_key);if(!object)fail(409,'artifact_unavailable','A committed artifact is missing. Start a new operation.');
  if(await communityChecksum(new Uint8Array(await object.arrayBuffer()))!==existing.checksum)fail(409,'artifact_corrupt','The committed artifact checksum does not match.');
  return existing;
 }
 if(existing&&existing.status!=='intent')fail(409,'lease_lost','This artifact has been revoked.');
 const token=`write-${id()}`,storageKey=`community/${args.userId}/${args.jobId}/${args.fileId}/${token}`,placeholder=`community/${args.userId}/${args.jobId}/pending-${args.fileId}`;
 const guard=`EXISTS(SELECT 1 FROM community_jobs WHERE id=? AND ${args.lease?"lease=? AND status='running' AND lease_until>?":"status='queued' AND stage='receiving'"})`,guardValues=()=>[args.jobId,...(args.lease?[args.lease,Date.now()]:[])];
 const admission=await env.DB.batch([
  env.DB.prepare(`INSERT INTO community_files(id,user_id,listing_id,version,job_id,role,format,options,filename,mime_type,size,checksum,storage_key,status,write_token,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,0,?,?,'intent',?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET write_token=excluded.write_token,checksum=excluded.checksum,mime_type=excluded.mime_type,options=excluded.options WHERE community_files.status='intent' AND community_files.job_id=excluded.job_id`).bind(args.fileId,args.userId,args.listingId??null,args.version??null,args.jobId,args.role,args.format??null,args.options?JSON.stringify(args.options):null,args.filename,args.mimeType,checksum,placeholder,token,now(),...guardValues()),
  env.DB.prepare(`INSERT INTO community_files(id,user_id,listing_id,version,job_id,role,filename,mime_type,size,checksum,storage_key,status,write_token,write_until,created_at) SELECT ?,?,?,?,?,'input',?,?,?,?,?,'intent',?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM community_storage_reservations WHERE job_id=? AND bytes>=?)`).bind(token,args.userId,args.listingId??null,args.version??null,args.jobId,`__write_${token}`,args.mimeType,args.bytes.byteLength,checksum,storageKey,token,Date.now()+COMMUNITY_WRITE_QUARANTINE_MS,now(),args.jobId,args.bytes.byteLength),
  env.DB.prepare('UPDATE community_storage_reservations SET bytes=bytes-? WHERE job_id=? AND changes()=1').bind(args.bytes.byteLength,args.jobId)
 ]);
 if(!(admission[1] as {meta:{changes:number}}).meta.changes)fail(413,'community_budget_exceeded','The write lease expired or artifact retries exceed the reserved storage budget.');
 inflightWrites.add(token);let promoted=false;
 try {
  if(args.lease)await assertCommunityLease(env,args.jobId,args.lease);
  await env.ASSETS_BUCKET.put(storageKey,args.bytes,{httpMetadata:{contentType:args.mimeType}});
  if(args.lease)await assertCommunityLease(env,args.jobId,args.lease);
  const commit=await env.DB.batch([
   // Move the attempt key and its charge in the same transaction that commits the logical file.
   env.DB.prepare(`UPDATE community_files SET storage_key=?,status='deleted',write_until=0 WHERE id=? AND status='intent' AND EXISTS(SELECT 1 FROM community_files WHERE id=? AND write_token=? AND status='intent') AND ${guard}`).bind(`community/${args.userId}/${args.jobId}/retired-${token}`,token,args.fileId,token,...guardValues()),
   env.DB.prepare("UPDATE community_files SET status='ready',size=?,checksum=?,storage_key=?,write_token=NULL WHERE id=? AND write_token=? AND status='intent' AND changes()=1").bind(args.bytes.byteLength,checksum,storageKey,args.fileId,token)
  ]);
  promoted=!!(commit[1] as {meta:{changes:number}}).meta.changes;if(!promoted)fail(409,'lease_lost','The file write was revoked before commit.');
  return (await env.DB.prepare('SELECT * FROM community_files WHERE id=?').bind(args.fileId).first<CommunityFileRow>())!;
 } finally {
  if(!promoted){try{await discardWrite(env,token,storageKey);}catch{/* Its durable attempt retains its charge until scheduled cleanup confirms deletion. */}}
  inflightWrites.delete(token);
 }
}
export async function purgeCommunityFiles(env:Bindings,files:CommunityFileRow[]) {
 for(const candidate of files){const file=await env.DB.prepare('SELECT * FROM community_files WHERE id=?').bind(candidate.id).first<WriteRow>();if(!file||file.status==='deleted')continue;
  if(inflightWrites.has(file.id)||file.write_until>Date.now())continue;
  if(file.write_token===file.id){await discardWrite(env,file.id,file.storage_key);continue;}
  await env.DB.prepare("UPDATE community_files SET status='deleting' WHERE id=? AND status!='deleted'").bind(file.id).run();await env.ASSETS_BUCKET.delete(file.storage_key);await env.DB.prepare("UPDATE community_files SET status='deleted' WHERE id=? AND status='deleting'").bind(file.id).run();
 }
}
export async function reconcileCommunityWrites(env:Bindings) {
 const abandoned=(await env.DB.prepare("SELECT * FROM community_files WHERE write_token=id AND status!='deleted' AND write_until<=? LIMIT 100").bind(Date.now()).all<CommunityFileRow>()).results;await purgeCommunityFiles(env,abandoned);
}
