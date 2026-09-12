import type { Bindings } from './types';
import { communityPreflightSchema, communityPublishSchema, communityUnlistSchema, type CommunityAttribution, type CommunityPreflight, type CommunityFormat } from '../src/shared/community';
import { communityProjection } from '../src/shared/community-projection';
import { documentSchema, type DesignDocument } from '../src/shared/schema';
import { ownedDocumentAssetIds } from '../src/shared/document-asset-references';
import { normalizeCommunityText } from '../src/shared/community-search';
import { frameExportBudget, frameExportBudgetMessage } from '../src/shared/frame-export-budget';
import { communityProfile } from './community-profiles';
import { communityJobReceipt, dispatchCommunityJob, serializeCommunityJob, type CommunityJobRow } from './community-jobs';
import { ownedCommunityListing, type CommunityListingRow } from './community-access';
import { reserveCommunityStorage } from './community-assets';
import { fail, id, hash, now } from './security';
export interface PublicationInput {document:DesignDocument;metadata:ReturnType<typeof communityPreflightSchema.parse>;disclosure:unknown;assetSources:{id:string;storageKey:string;mimeType:string;size:number}[];attribution:CommunityAttribution|null;creator:{handle:string;displayName:string}}
async function inspectPublication(env:Bindings,userId:string,input:unknown) {
 const value=communityPreflightSchema.parse(input),row=await env.DB.prepare('SELECT id,document,revision FROM projects WHERE id=? AND user_id=?').bind(value.projectId,userId).first<{id:string;document:string;revision:number}>();
 if(!row)fail(404,'not_found','Project not found.');if(row!.revision!==value.expectedProjectRevision)fail(409,'revision_conflict','Save or reload this project before publishing.');
 let projected:ReturnType<typeof communityProjection>;try{projected=communityProjection(documentSchema.parse(JSON.parse(row!.document)));}catch(error){fail(400,'unsafe_public_projection',error instanceof Error?error.message:'The public projection could not be validated.');}const document=projected!.document;
 if(!document.pages[value.cover.pageIndex])fail(400,'invalid_page','Select an existing cover page.');
 for(const options of value.formats){if(!document.pages[options.pageIndex])fail(400,'invalid_page','A selected export page does not exist.');if(options.format==='react'&&!['web','wireframe'].includes(document.kind))fail(400,'unsupported_export','React export requires a Website or Wireframe project.');}
 for(const options of value.formats)if(options.format==='png-sequence'||options.format==='spritesheet'){
  const frameInput={...document.pages[options.pageIndex],start:options.start,end:options.end??document.timeline?.duration??2,fps:options.fps,format:options.format};
  if(!frameExportBudget(frameInput).withinLimits)fail(413,'render_budget_exceeded',frameExportBudgetMessage(frameInput));
 }
 const assetSources:PublicationInput['assetSources']=[];
 for(const assetId of ownedDocumentAssetIds(document)){const asset=await env.DB.prepare('SELECT id,storage_key,mime_type,size FROM assets WHERE id=? AND user_id=? AND project_id=?').bind(assetId,userId,row!.id).first<{id:string;storage_key:string;mime_type:string;size:number}>();if(!asset)fail(400,'invalid_asset','Import all media into this project before publishing.');assetSources.push({id:asset!.id,storageKey:asset!.storage_key,mimeType:asset!.mime_type,size:asset!.size});}
 // Publication never retrieves arbitrary network URLs. Portable media must already be owned.
 const urls=[...document.assets.map(a=>a.url),...document.pages.flatMap(p=>p.nodes.map(n=>n.src).filter(Boolean) as string[])];if(urls.some(url=>!/^\/api\/assets\/[\w-]+$/.test(url)))fail(400,'import_media_required','Import external or inline media into this project before publishing.');
 const assetBytes=assetSources.reduce((sum,a)=>sum+a.size,0);if(assetBytes>48*1024**2)fail(413,'package_too_large','Retained media must fit within the 64 MiB portable package budget.');
 const digest=await hash(JSON.stringify({policyVersion:1,document,metadata:value}));
 const attributionRow=await env.DB.prepare('SELECT attribution FROM community_remix_origins WHERE project_id=?').bind(value.projectId).first<{attribution:string}>();
 const availableFormats:CommunityFormat[]=['package','json','svg','html','png','pdf','pptx'];
 if(['web','wireframe'].includes(document.kind))availableFormats.push('react');
 if(document.pages.some(p=>p.nodes.some(n=>n.type==='model3d'))&&!document.pages.some(p=>p.nodes.some(n=>n.character)))availableFormats.push('glb','gltf','scene-angles');
 if(document.timeline||document.characters?.length)availableFormats.push('motion','webm','mp4','png-sequence','spritesheet');
 for(const format of value.formats)if(!availableFormats.includes(format.format))fail(400,'unsupported_export','This design does not support one of the selected download formats.');
 const preflight:CommunityPreflight={digest,document,disclosure:projected!.disclosure,kind:document.kind,pageCount:document.pages.length,assetBytes,license:'CC-BY-4.0',formats:['package',...value.formats.map(f=>f.format)],availableFormats,issues:[]};
 return {preflight,value,assetSources,attribution:attributionRow?JSON.parse(attributionRow.attribution) as CommunityAttribution:null};
}
export async function preflightCommunity(env:Bindings,userId:string,input:unknown) {return (await inspectPublication(env,userId,input)).preflight;}
export async function publishCommunity(env:Bindings,userId:string,input:unknown,listingId?:string) {
 const value=communityPublishSchema.parse(input),payloadHash=await hash(JSON.stringify({listingId:listingId??null,...value})),receipt=await communityJobReceipt(env,userId,value.operationId,payloadHash);if(receipt)return serializeCommunityJob(receipt);
 const profile=await communityProfile(env,userId);if(!profile)fail(409,'profile_required','Choose your public creator profile before publishing.');
 const {operationId,digest,license,acceptLicense,confirmPublic,expectedListingRevision,...metadata}=value;
 const inspected=await inspectPublication(env,userId,metadata);if(inspected.preflight.digest!==digest)fail(409,'preflight_changed','Public content or options changed. Review a fresh preflight.');
 const existing=listingId?await ownedCommunityListing(env,userId,listingId):await env.DB.prepare('SELECT * FROM community_listings WHERE source_project_id=? AND user_id=?').bind(value.projectId,userId).first<CommunityListingRow>();
 if(existing?.source_project_id!==undefined&&existing.source_project_id!==value.projectId)fail(400,'source_mismatch','A listing can only release its original source project.');
 if(existing?.deleted)fail(409,'listing_deleted','This listing was permanently removed.');if(existing?.suppressed)fail(409,'listing_hidden','A moderator has hidden this listing.');
 if(existing&&expectedListingRevision!==existing.revision)fail(409,'revision_conflict','Reload the listing before publishing a release.');
 const listing=existing?.id??id(),jobId=id(),time=now(),version=(await env.DB.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM community_versions WHERE listing_id=?').bind(listing).first<{version:number}>())!.version,epoch=existing?.epoch??1;
 const pinned:PublicationInput={document:inspected.preflight.document,metadata:inspected.value,disclosure:inspected.preflight.disclosure,assetSources:inspected.assetSources,attribution:inspected.attribution,creator:{handle:profile!.handle,displayName:profile!.displayName}};
 const claim=env.DB.prepare(`INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,listing_id,version,epoch,source_project_id,input,created_at,updated_at) SELECT ?,?,?,?,'publish',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM community_source_locks WHERE project_id=? AND deleting=1) AND EXISTS(SELECT 1 FROM community_listings WHERE id=? AND user_id=? AND revision=? AND epoch=? AND deleted=0 AND suppressed=0 AND pending_job_id IS NULL) ON CONFLICT(user_id,operation_id) DO NOTHING`).bind(jobId,userId,operationId,payloadHash,listing,version,epoch,value.projectId,JSON.stringify(pinned),time,time,value.projectId,userId,value.expectedProjectRevision,value.projectId,listing,userId,existing?.revision??1,epoch);
 await env.DB.batch([
 ...(!existing?[env.DB.prepare(`INSERT INTO community_listings(id,user_id,source_project_id,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM community_source_locks WHERE project_id=? AND deleting=1) ON CONFLICT(source_project_id) DO NOTHING`).bind(listing,userId,value.projectId,time,time,value.projectId,userId,value.expectedProjectRevision,value.projectId)]:[]),claim,
 env.DB.prepare('UPDATE community_listings SET pending_job_id=? WHERE id=? AND EXISTS(SELECT 1 FROM community_jobs WHERE id=?)').bind(jobId,listing,jobId),
 env.DB.prepare(`INSERT INTO community_versions(listing_id,version,document,title,description,kind,tags,metadata,search_text,disclosure,attribution,license,source_revision,checksum,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,'CC-BY-4.0',?,?,? WHERE EXISTS(SELECT 1 FROM community_jobs WHERE id=?)`).bind(listing,version,JSON.stringify(pinned.document),value.title,value.description,pinned.document.kind,JSON.stringify(value.tags),JSON.stringify(metadata),normalizeCommunityText(`${value.title} ${value.description} ${value.tags.join(' ')}`),JSON.stringify(pinned.disclosure),pinned.attribution?JSON.stringify(pinned.attribution):null,value.expectedProjectRevision,digest,time,jobId)
 ]);
 const accepted=await communityJobReceipt(env,userId,operationId,payloadHash);if(!accepted)fail(409,'publication_busy','The project or listing changed, or another release is building. Reload before retrying.');
 try{await reserveCommunityStorage(env,accepted!.id,userId,Math.min(512*1024**2,inspected.preflight.assetBytes*3+64*1024**2*(1+value.formats.length)));}catch(error){await env.DB.batch([env.DB.prepare("UPDATE community_jobs SET status='failed',stage='failed',error=? WHERE id=? AND status='queued'").bind(JSON.stringify({code:'asset_quota_exceeded',message:'Insufficient storage for this publication.'}),accepted!.id),env.DB.prepare('UPDATE community_listings SET pending_job_id=NULL WHERE pending_job_id=?').bind(accepted!.id)]);throw error;}
 await dispatchCommunityJob(env,accepted!.id);return serializeCommunityJob(accepted!);
}
export async function unlistCommunity(env:Bindings,userId:string,listingId:string,input:unknown) {const value=communityUnlistSchema.parse(input),payloadHash=await hash(JSON.stringify({listingId,...value})),existing=await communityJobReceipt(env,userId,value.operationId,payloadHash);if(existing)return serializeCommunityJob(existing);await ownedCommunityListing(env,userId,listingId);const jobId=id(),time=now();await env.DB.batch([
 env.DB.prepare("UPDATE community_listings SET owner_available=0,epoch=epoch+1,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND deleted=0").bind(time,listingId,userId,value.expectedListingRevision),
 env.DB.prepare("INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,listing_id,input,status,stage,result,created_at,updated_at) SELECT ?,?,?,?,'unlist',?,?,'succeeded','completed','{}',?,? WHERE changes()=1").bind(jobId,userId,value.operationId,payloadHash,listingId,JSON.stringify(value),time,time)
 ]);const row=await communityJobReceipt(env,userId,value.operationId,payloadHash);if(!row)fail(409,'revision_conflict','Listing changed. Reload before unlisting.');return serializeCommunityJob(row!);}
/** This durable deletion claim also blocks publication admission until the project is removed. */
export async function guardCommunityProjectDeletion(env:Bindings,projectId:string,userId:string) {
 const time=Date.now();const result=await env.DB.prepare(`INSERT INTO community_source_locks(project_id,deleting) SELECT ?,1 WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=?) AND NOT EXISTS(SELECT 1 FROM community_jobs WHERE source_project_id=? AND status='running' AND lease_until>?) ON CONFLICT(project_id) DO UPDATE SET deleting=1 WHERE NOT EXISTS(SELECT 1 FROM community_jobs WHERE source_project_id=? AND status='running' AND lease_until>?)`).bind(projectId,projectId,userId,projectId,time,projectId,time).run();if(!result.meta.changes)fail(409,'publication_busy','A Community operation is copying this project. Wait for it to finish, then retry deletion.');
 const cleanupId=`cleanup-${id()}`,timeText=now();
 await env.DB.batch([
 env.DB.prepare('UPDATE community_listings SET owner_available=0,deleted=1,epoch=epoch+1,revision=revision+1,updated_at=? WHERE source_project_id=? AND user_id=?').bind(timeText,projectId,userId),
 env.DB.prepare("INSERT INTO community_jobs(id,user_id,operation_id,payload_hash,kind,listing_id,input,created_at,updated_at) SELECT ?,?,'__community_cleanup_'||id,'cleanup','cleanup',id,'{}',?,? FROM community_listings WHERE source_project_id=? AND user_id=? AND deleted=1 ON CONFLICT(user_id,operation_id) DO UPDATE SET status='queued',stage='accepted',updated_at=excluded.updated_at").bind(cleanupId,userId,timeText,timeText,projectId,userId)
 ]);
 const cleanup=await env.DB.prepare("SELECT j.id FROM community_jobs j JOIN community_listings l ON l.id=j.listing_id WHERE l.source_project_id=? AND j.kind='cleanup'").bind(projectId).first<{id:string}>();if(cleanup)await dispatchCommunityJob(env,cleanup.id);
}
