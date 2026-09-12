import type { Context } from 'hono';
import type { Bindings, Env } from './types';
import { fail, owner } from './security';
import { isCommunityAdmin } from './community-admin-grants';
export const communityEnabled = (env:Bindings) => env.COMMUNITY_ENABLED === 'true';
export const COMMUNITY_LIVE = "l.owner_available=1 AND l.suppressed=0 AND l.deleted=0 AND v.status='ready'";
export async function communityOperator(c:Context<Env>) { const userId=owner(c); if(c.get('tokenKind')==='oauth'||!await isCommunityAdmin(c.env,userId)) fail(403,'forbidden','Community moderation requires an operator session or API key.'); return userId; }
export const isCommunityOperator = async(c:Context<Env>) => !!c.get('user') && c.get('tokenKind')!=='oauth' && await isCommunityAdmin(c.env,c.get('user')!.id);
export interface CommunityListingRow {id:string;user_id:string;source_project_id:string|null;owner_available:number;suppressed:number;deleted:number;moderation_reason:string|null;revision:number;epoch:number;current_version:number|null;pending_job_id:string|null;first_published_at:string|null;created_at:string;updated_at:string}
export async function ownedCommunityListing(env:Bindings,userId:string,listingId:string) { const row=await env.DB.prepare('SELECT * FROM community_listings WHERE id=? AND user_id=?').bind(listingId,userId).first<CommunityListingRow>(); if(!row)fail(404,'not_found','Listing not found.'); return row!; }
export async function communityRateLimit(env:Bindings,userId:string,action:string,limit=20) { const key=`community:${action}:${userId}`,time=Date.now();const row=await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(key,time+900000,time,time).first<{count:number}>();if((row?.count??0)>limit)fail(429,'rate_limited','Too many Community requests. Try again in 15 minutes.'); }
