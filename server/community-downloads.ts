import type { Context } from 'hono';
import type { Env } from './types';
import { documentSchema, type AssetRef } from '../src/shared/schema';
import { remapDocumentAssets } from '../src/shared/document-asset-references';
import { retainedCommunityVersion, type CommunityFileRow } from './community-queries';
import { interactiveSnapshotHtml } from './published-html';
import { recordCommunityDelivery } from './community-engagement';
import { fail } from './security';
export async function serveCommunityFile(c:Context<Env>,listingId:string,version:number,fileId:string,privateJob?:string,report=false) {
 if(!privateJob)await retainedCommunityVersion(c.env,listingId,version,!report);
 const file=await c.env.DB.prepare(`SELECT * FROM community_files WHERE id=? AND status='ready' AND ${privateJob?'job_id=?':'listing_id=? AND version=?'} AND role!='input'`).bind(fileId,...(privateJob?[privateJob]:[listingId,version])).first<CommunityFileRow>();if(!file)fail(404,report?'content_unavailable':'not_found','File unavailable.');
 const object=await c.env.ASSETS_BUCKET.get(file!.storage_key);if(!object)fail(404,report?'content_unavailable':'not_found','File unavailable.');
 if(!privateJob)await retainedCommunityVersion(c.env,listingId,version,!report);
 const headers={'Content-Type':file!.mime_type,'Content-Length':String(file!.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`${file!.role==='download'?'attachment':'inline'}; filename="${file!.filename.replace(/[^a-zA-Z0-9._-]/g,'_')}"`};
 if(c.req.method==='HEAD'){await object!.body.cancel();return new Response(null,{headers});}
 if(!privateJob&&!report&&file!.role==='download')await recordCommunityDelivery(c.env,listingId,c.get('user')?.id??null,c.req.header('CF-Connecting-IP')??'local','download');
 return new Response(object!.body,{headers});
}
export async function communityPreview(c:Context<Env>,listingId:string,version:number,privateJob?:string,report=false) {
 let document:string;
 if(privateJob){const row=await c.env.DB.prepare('SELECT document FROM community_versions WHERE listing_id=? AND version=?').bind(listingId,version).first<{document:string}>();if(!row)fail(404,'content_unavailable','Preview unavailable.');document=row!.document;}
 else document=(await retainedCommunityVersion(c.env,listingId,version,!report)).document;
 const doc=documentSchema.parse(JSON.parse(document)),files=(await c.env.DB.prepare("SELECT * FROM community_files WHERE listing_id=? AND version=? AND role='asset' AND status='ready'").bind(listingId,version).all<CommunityFileRow>()).results,mapping=new Map<string,AssetRef>();
 for(const file of files){const object=await c.env.ASSETS_BUCKET.get(file.storage_key);if(!object)fail(404,'content_unavailable','Preview media unavailable.');const bytes=new Uint8Array(await object!.arrayBuffer());mapping.set(file.id,{id:file.id,name:'Media',type:file.mime_type.split('/')[0],mimeType:file.mime_type,url:`data:${file.mime_type};base64,${Buffer.from(bytes).toString('base64')}`,size:bytes.byteLength});}
 remapDocumentAssets(doc,mapping);
 if(doc.assets.some(a=>a.url.startsWith('/api/assets/')))fail(409,'preview_not_ready','The staged preview is still copying media.');
 const html=await interactiveSnapshotHtml(c.env,doc);if(!privateJob)await retainedCommunityVersion(c.env,listingId,version,!report);
 c.header('X-Frame-Options','SAMEORIGIN');c.header('Cache-Control','private, no-store');c.header('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; frame-ancestors 'self'; sandbox allow-scripts");return c.html(html);
}
