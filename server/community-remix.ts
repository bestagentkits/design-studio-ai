import type { Bindings } from './types';
import { communityRemixSchema, type CommunityAttribution } from '../src/shared/community';
import { retainedCommunityVersion, type CommunityFileRow } from './community-queries';
import { communityJobReceipt, serializeCommunityJob, dispatchCommunityJob } from './community-jobs';
import { reserveCommunityStorage } from './community-assets';
import { fail, id, hash, now } from './security';
export async function remixCommunity(env:Bindings,userId:string,listingId:string,input:unknown) {
 const value=communityRemixSchema.parse(input),payloadHash=await hash(JSON.stringify({listingId,...value})),existing=await communityJobReceipt(env,userId,value.operationId,payloadHash);if(existing)return serializeCommunityJob(existing);
 const version=await retainedCommunityVersion(env,listingId,value.version),source=await env.DB.prepare('SELECT l.epoch,p.handle,p.display_name FROM community_listings l JOIN community_profiles p ON p.user_id=l.user_id WHERE l.id=?').bind(listingId).first<{epoch:number;handle:string;display_name:string}>();
 const files=(await env.DB.prepare("SELECT * FROM community_files WHERE listing_id=? AND version=? AND role='asset' AND status='ready'").bind(listingId,value.version).all<CommunityFileRow>()).results;
 const attribution:CommunityAttribution={listingId,version:value.version,title:version.title,creator:{handle:source!.handle,displayName:source!.display_name},license:'CC-BY-4.0',url:`${env.APP_URL??''}/community/designs/${listingId}`,verified:true};
 const jobId=id(),time=now(),projectId=id(),pinned={document:JSON.parse(version.document),title:version.title,files,attribution,projectId};
 const result=await env.DB.prepare(`INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,listing_id,version,epoch,input,created_at,updated_at) SELECT ?,?,?,?,'remix',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM community_listings l JOIN community_versions v ON v.listing_id=l.id WHERE l.id=? AND l.epoch=? AND v.version=? AND l.owner_available=1 AND l.suppressed=0 AND l.deleted=0 AND v.status='ready') ON CONFLICT(user_id,operation_id) DO NOTHING`).bind(jobId,userId,value.operationId,payloadHash,listingId,value.version,source!.epoch,JSON.stringify(pinned),time,time,listingId,source!.epoch,value.version).run();
 const receipt=await communityJobReceipt(env,userId,value.operationId,payloadHash);if(!receipt)fail(409,'source_unavailable','The source was revoked before the remix could start.');
 try{await reserveCommunityStorage(env,receipt!.id,userId,files.reduce((sum,f)=>sum+f.size,0));}catch(error){await env.DB.prepare("UPDATE community_jobs SET status='failed',stage='failed',error=?,updated_at=? WHERE id=? AND status='queued'").bind(JSON.stringify({code:'asset_quota_exceeded',message:'Insufficient storage for this remix.'}),now(),receipt!.id).run();throw error;}
 await dispatchCommunityJob(env,receipt!.id);return serializeCommunityJob(receipt!);
}
