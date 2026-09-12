import { communityQuerySchema, type CommunityListing, type CommunityFile } from '../src/shared/community';
import { communityFtsQuery, normalizeCommunityText } from '../src/shared/community-search';
import type { Bindings } from './types';
import { b64, unb64, fail, hash } from './security';
import { COMMUNITY_LIVE, type CommunityListingRow } from './community-access';
export interface CommunityVersionRow {listing_id:string;version:number;document:string;title:string;description:string;kind:CommunityListing['kind'];tags:string;metadata:string;disclosure:string;attribution:string|null;license:'CC-BY-4.0';source_revision:number;checksum:string;status:string;created_at:string}
export interface CommunityFileRow {id:string;user_id:string;listing_id:string|null;version:number|null;job_id:string;role:'asset'|'cover'|'download'|'input';format:CommunityFile['format'];options:string|null;filename:string;mime_type:string;size:number;checksum:string;storage_key:string;status:string;created_at:string}
type ListingJoined=CommunityListingRow & CommunityVersionRow & {handle:string;display_name:string;downloads:number;remixes:number;cover_id:string|null;formats:string|null;page_count:number|null};
const selection=`SELECT l.*,v.title,v.description,v.kind,v.tags,v.license,json_array_length(v.document,'$.pages') page_count,v.attribution,v.disclosure,v.version,p.handle,p.display_name,
 (SELECT COUNT(*) FROM community_contributions WHERE listing_id=l.id AND action='download') downloads,
 (SELECT COUNT(*) FROM community_contributions WHERE listing_id=l.id AND action='remix') remixes,
 (SELECT id FROM community_files WHERE listing_id=l.id AND version=v.version AND role='cover' AND status='ready' LIMIT 1) cover_id,
 (SELECT GROUP_CONCAT(DISTINCT format) FROM community_files WHERE listing_id=l.id AND version=v.version AND role='download' AND status='ready') formats
 FROM community_listings l JOIN community_profiles p ON p.user_id=l.user_id JOIN community_versions v ON v.listing_id=l.id AND v.version=COALESCE(l.current_version,(SELECT MAX(version) FROM community_versions WHERE listing_id=l.id))`;
export const communityFileUrl=(listingId:string,version:number,fileId:string)=>`/api/community/listings/${listingId}/versions/${version}/files/${fileId}`;
export function serializeCommunityFile(row:CommunityFileRow):CommunityFile { return {id:row.id,role:row.role as CommunityFile['role'],format:row.format,mimeType:row.mime_type,size:row.size,checksum:row.checksum,filename:row.filename,url:communityFileUrl(row.listing_id!,row.version!,row.id),...(row.options?{options:JSON.parse(row.options)}:{})}; }
function serializeListing(row:ListingJoined,owned=false):CommunityListing { return {id:row.id,title:row.title,description:row.description,kind:row.kind,tags:JSON.parse(row.tags),version:row.version,revision:row.revision,creator:{handle:row.handle,displayName:row.display_name},coverUrl:row.cover_id?communityFileUrl(row.id,row.version,row.cover_id):null,formats:(row.formats?.split(',')??[]) as CommunityListing['formats'],downloads:row.downloads,remixes:row.remixes,publishedAt:row.first_published_at,license:row.license,pageCount:row.page_count??0,...(owned?{state:row.deleted?'deleted':row.suppressed?'hidden':row.owner_available?'live':row.current_version?'unlisted':'draft',sourceProjectId:row.source_project_id,moderationReason:row.moderation_reason} as const:{})}; }
export async function communityListing(env:Bindings,listingId:string,ownedBy?:string) {
 const row=await env.DB.prepare(`${selection} WHERE l.id=? AND ${ownedBy?'l.user_id=?':COMMUNITY_LIVE}`).bind(listingId,...(ownedBy?[ownedBy]:[])).first<ListingJoined>();if(!row)fail(404,'not_found','Design unavailable.');
 const listing=serializeListing(row!,!!ownedBy);listing.files=(await env.DB.prepare("SELECT * FROM community_files WHERE listing_id=? AND version=? AND status='ready' AND role='download'").bind(listingId,row!.version).all<CommunityFileRow>()).results.map(serializeCommunityFile);listing.previewUrl=`/api/community/listings/${listingId}/versions/${row!.version}/preview`;listing.attribution=row!.attribution?JSON.parse(row!.attribution):null;listing.disclosure=JSON.parse(row!.disclosure);
 if(listing.attribution?.listingId){const original=await env.DB.prepare('SELECT 1 FROM community_listings WHERE id=? AND owner_available=1 AND suppressed=0 AND deleted=0').bind(listing.attribution.listingId).first();if(!original){listing.attribution.originalUnavailable=true;delete listing.attribution.url;}}
 const remixes=await env.DB.prepare(`${selection} WHERE ${COMMUNITY_LIVE} AND EXISTS(SELECT 1 FROM community_remix_origins o WHERE o.project_id=l.source_project_id AND o.listing_id=? AND o.verified=1) ORDER BY l.first_published_at DESC,l.id DESC LIMIT 24`).bind(listingId).all<ListingJoined>();listing.remixListings=remixes.results.map(row=>serializeListing(row));return listing;
}
export async function ownedCommunityListings(env:Bindings,userId:string,bookmarks=false) { const rows=await env.DB.prepare(`${selection} WHERE ${bookmarks?`${COMMUNITY_LIVE} AND EXISTS(SELECT 1 FROM community_bookmarks b WHERE b.listing_id=l.id AND b.user_id=?)`:'l.user_id=?'} ORDER BY l.updated_at DESC,l.id DESC LIMIT 200`).bind(userId).all<ListingJoined>();return rows.results.map(row=>serializeListing(row,!bookmarks)); }
export async function listCommunity(env:Bindings,raw:unknown) {
 const query=communityQuerySchema.parse(raw),sort=query.sort??(query.q?'relevance':'trending');
 const fingerprint=await hash(JSON.stringify({...query,cursor:undefined,limit:undefined,sort}));
 const generation=(await env.DB.prepare('SELECT generation FROM community_search_generation WHERE id=1').first<{generation:number}>())!.generation;
 let offset=0,rankTime=Date.now();
 if(query.cursor){try{const cursor=JSON.parse(new TextDecoder().decode(unb64(query.cursor)));if(cursor.fingerprint!==fingerprint||cursor.generation!==generation||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset>1000000||!Number.isSafeInteger(cursor.rankTime)||cursor.rankTime>Date.now()||cursor.rankTime<Date.now()-900000)fail(409,'cursor_reset_required','Results changed. Restart your search.');offset=cursor.offset;rankTime=cursor.rankTime;}catch(error){if(error instanceof Error&&'code'in error)throw error;fail(400,'invalid_cursor','Invalid search cursor.');}}
 const conditions=[COMMUNITY_LIVE],bindings:unknown[]=[];
 const relevanceMatch=sort==='relevance'&&query.q?communityFtsQuery(query.q):'';
 if(query.q){const expression=communityFtsQuery(query.q);conditions.push(expression?'l.id IN(SELECT listing_id FROM community_search WHERE community_search MATCH ?)':'0');if(expression)bindings.push(expression);}
 if(query.kind){conditions.push('v.kind=?');bindings.push(query.kind);}
 const tags=query.tags?.split(',').filter(Boolean)??[];if(tags.length>8)fail(400,'invalid_tags','Use at most eight tags.');
 for(const tag of tags){conditions.push('EXISTS(SELECT 1 FROM json_each(v.tags) WHERE value=?)');bindings.push(tag.normalize('NFC').toLowerCase().trim());}
 if(query.format){conditions.push("EXISTS(SELECT 1 FROM community_files f WHERE f.listing_id=l.id AND f.version=v.version AND f.status='ready' AND f.role='download' AND f.format=?)");bindings.push(query.format);}
 if(query.creator){conditions.push('p.handle=?');bindings.push(query.creator.toLowerCase());}
 if(query.collection){conditions.push('EXISTS(SELECT 1 FROM community_collection_items ci WHERE ci.listing_id=l.id AND ci.version=v.version AND ci.collection_id=?)');bindings.push(query.collection);}
 if(query.period!=='all'){conditions.push('l.first_published_at>=?');bindings.push(new Date(rankTime-({week:7,month:30,year:365}[query.period])*86400000).toISOString());}
 const rankDate=new Date(rankTime).toISOString(),trend=`(SELECT COALESCE(SUM(CASE action WHEN 'remix' THEN 4 ELSE 1 END),0) FROM community_contributions WHERE listing_id=l.id AND first_at>='${new Date(rankTime-7*86400000).toISOString()}') / sqrt(MAX(0,julianday('${rankDate}')-julianday(l.first_published_at))+2)`;
 let ordering=sort==='most-downloaded'?'downloads DESC':sort==='most-used'?'remixes DESC':sort==='trending'?`${trend} DESC`:relevanceMatch?'matched.rank ASC':'l.first_published_at DESC';
 ordering+=ordering==='l.first_published_at DESC'?',l.id DESC':',l.first_published_at DESC,l.id DESC';
 const where=conditions.join(' AND ');
 // Materialize FTS matches once; a correlated MATCH/rank scan per listing is quadratic.
 const selected=relevanceMatch?`WITH matched AS MATERIALIZED (SELECT listing_id,rank FROM community_search WHERE community_search MATCH ?) ${selection} JOIN matched ON matched.listing_id=l.id WHERE ${conditions.filter((_,index)=>index!==1).join(' AND ')}`:`${selection} WHERE ${where}`;
 const selectedBindings=relevanceMatch?[relevanceMatch,...bindings.slice(1)]:bindings;
 const rows=await env.DB.prepare(`${selected} ORDER BY ${ordering} LIMIT ? OFFSET ?`).bind(...selectedBindings,query.limit+1,offset).all<ListingJoined>();
 const more=rows.results.length>query.limit,items=rows.results.slice(0,query.limit);
 const facets=(await env.DB.prepare(`SELECT v.kind,COUNT(*) count FROM community_listings l JOIN community_versions v ON v.listing_id=l.id AND v.version=l.current_version JOIN community_profiles p ON p.user_id=l.user_id WHERE ${where} GROUP BY v.kind`).bind(...bindings).all<{kind:string;count:number}>()).results;
 const formatFacets=(await env.DB.prepare(`SELECT f.format,COUNT(DISTINCT l.id) count FROM community_listings l JOIN community_versions v ON v.listing_id=l.id AND v.version=l.current_version JOIN community_profiles p ON p.user_id=l.user_id JOIN community_files f ON f.listing_id=l.id AND f.version=v.version AND f.role='download' AND f.status='ready' WHERE ${where} GROUP BY f.format`).bind(...bindings).all<{format:string;count:number}>()).results;
 return {listings:items.map(row=>serializeListing(row)),nextCursor:more?b64(new TextEncoder().encode(JSON.stringify({fingerprint,generation,rankTime,offset:offset+query.limit}))):null,facets:{kinds:facets,formats:formatFacets}};
}
export async function retainedCommunityVersion(env:Bindings,listingId:string,version:number,publicOnly=true) { const row=await env.DB.prepare(`SELECT v.* FROM community_versions v JOIN community_listings l ON l.id=v.listing_id WHERE l.id=? AND v.version=? AND ${publicOnly?COMMUNITY_LIVE:"v.status='ready' AND l.deleted=0"}`).bind(listingId,version).first<CommunityVersionRow>();if(!row)fail(404,publicOnly?'not_found':'content_unavailable','This version is unavailable.');return row!; }
