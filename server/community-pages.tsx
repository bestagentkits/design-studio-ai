import { Hono } from 'hono';
import { publicMetadata, stripPublicMetadata, type PublicMetadata } from '../src/shared/public-metadata';
import type { Env } from './types';
import { ApiError, origin } from './security';
import { communityEnabled, COMMUNITY_LIVE } from './community-access';
import { communityListing, listCommunity } from './community-queries';
import { communityProfile } from './community-profiles';
import type { CommunityListing } from '../src/shared/community';

const escape=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const designPath=(id:string)=>`/community/designs/${encodeURIComponent(id)}`;
function cards(listings:CommunityListing[]) {
  return listings.length?`<div class="community-grid">${listings.map(listing=>`<article class="community-card"><a href="${designPath(listing.id)}">${listing.coverUrl?`<img src="${escape(listing.coverUrl)}" alt="${escape(listing.title)}" loading="lazy">`:''}<h2>${escape(listing.title)}</h2></a><p>${escape(listing.description)}</p><a href="/community/creators/${encodeURIComponent(listing.creator.handle)}">${escape(listing.creator.displayName)}</a><p>${listing.remixes} people remixed · ${listing.downloads} people downloaded</p></article>`).join('')}</div>`:'<p>No designs match yet. Be the first to share something useful.</p>';
}
export const communityPages=new Hono<Env>();
communityPages.get('/marketplace',c=>c.redirect('/community'+new URL(c.req.url).search,301));
communityPages.get('/sitemap.xml',async c=>{
  const response=await c.env.ASSETS?.fetch(new Request(`${origin(c)}/sitemap.xml`));
  let xml=response?.ok?await response.text():'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  if(communityEnabled(c.env)){
    const listings=await c.env.DB.prepare(`SELECT l.id,p.handle FROM community_listings l JOIN community_versions v ON v.listing_id=l.id AND v.version=l.current_version JOIN community_profiles p ON p.user_id=l.user_id WHERE ${COMMUNITY_LIVE} ORDER BY l.id LIMIT 45000`).all<{id:string;handle:string}>();
    const paths=new Set(['/community',...listings.results.flatMap(row=>[designPath(row.id),`/community/creators/${encodeURIComponent(row.handle)}`])]);
    xml=xml.replace('</urlset>',[...paths].map(path=>`<url><loc>${escape(origin(c)+path)}</loc></url>`).join('')+'</urlset>');
  }
  return c.body(xml,200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'});
});
communityPages.get('/community/*',communityPage);
communityPages.get('/community',communityPage);
async function communityPage(c:import('hono').Context<Env>) {
  const path=c.req.path,base=origin(c),query=Object.fromEntries(new URL(c.req.url).searchParams);
  let title='Community — Design Studio AI',description='Discover, download and remix designs shared by the community.',content='',status:200|404=200;
  const privatePage=['/community/saved','/community/publishing','/community/impact','/community/moderation'].includes(path);
  let indexable=!privatePage&&!Object.keys(query).length,cover:string|undefined;
  try{
    if(!communityEnabled(c.env))throw new ApiError(404,'not_found','Community is not enabled on this studio.');
    const listingMatch=/^\/community\/designs\/([a-zA-Z0-9_-]+)$/.exec(path),creatorMatch=/^\/community\/creators\/([a-z0-9-]+)$/.exec(path);
    if(listingMatch){
      const listing=await communityListing(c.env,listingMatch[1]);title=`${listing.title} — Community`;description=listing.description||`A ${listing.kind} design by ${listing.creator.displayName}.`;cover=listing.coverUrl?new URL(listing.coverUrl,base).href:undefined;
      content=`<article><h1>${escape(listing.title)}</h1><p>By <a href="/community/creators/${encodeURIComponent(listing.creator.handle)}">${escape(listing.creator.displayName)}</a></p><p>${escape(listing.description)}</p>${listing.coverUrl?`<img src="${escape(listing.coverUrl)}" alt="${escape(listing.title)}" style="max-width:100%">`:''}<p>${escape(listing.kind)} · ${listing.pageCount} pages · Version ${listing.version} · CC-BY-4.0</p><ul>${(listing.files??[]).map(file=>`<li><a href="${escape(file.url)}" download>${escape(file.filename)}</a> (${escape(file.mimeType)}, ${file.size} bytes)</li>`).join('')}</ul><p>Credit ${escape(listing.creator.displayName)} when reusing this design.</p><noscript>Enable JavaScript to preview interactively, save or remix this design.</noscript></article>`;
    }else if(creatorMatch){
      const row=await c.env.DB.prepare('SELECT user_id FROM community_profiles WHERE handle=?').bind(creatorMatch[1]).first<{user_id:string}>();
      const profile=row?await communityProfile(c.env,row.user_id):null;
      if(!profile)throw new ApiError(404,'not_found','Creator unavailable.');
      title=`${profile.displayName} — Community`;description=profile.bio||`Designs shared by ${profile.displayName}.`;
      content=`<h1>${escape(profile.displayName)}</h1><p>@${escape(profile.handle)}</p><p>${escape(profile.bio)}</p>${cards((await listCommunity(c.env,{creator:profile.handle})).listings)}`;
    }else if(privatePage){content='<h1>Your Community workspace</h1><p>Sign in to manage your saved designs, publications and impact.</p><a href="/?auth=signin">Sign in</a>';
    }else if(path==='/community'){
      const result=await listCommunity(c.env,query);
      content=`<h1>Good design deserves company.</h1><p>Explore useful ideas. Make them your own. Share what you create.</p><form action="/community" method="get"><label>Search Community <input type="search" name="q" value="${escape(query.q??'')}"></label><button type="submit">Search</button></form>${cards(result.listings)}`;
      if(result.nextCursor)content+=`<a href="/community?${escape(new URLSearchParams({...query,cursor:result.nextCursor}).toString())}">More designs</a>`;
    }else throw new ApiError(404,'not_found','This Community page is unavailable.');
  }catch(error){
    if(!(error instanceof ApiError))throw error;
    status=error.status===404?404:200;indexable=false;title='Community — Design unavailable';content=`<h1>${escape(error.message)}</h1><a href="/community">Explore Community</a>`;
  }
  const response=await c.env.ASSETS?.fetch(new Request(base+'/'));
  let shell=response?.ok?await response.text():'<!doctype html><html><head><title></title></head><body><div id="root"></div></body></html>';
  const start=shell.indexOf('<div id="root">'),end=shell.lastIndexOf('</div>');
  if(start>=0&&end>=start)shell=shell.slice(0,start)+`<div id="root"><main class="community-shell"><nav><a href="/">My projects</a> · <a href="/community">Community</a> · <a href="/docs/community">How sharing works</a></nav>${content}</main></div>`+shell.slice(end+6);
  shell=stripPublicMetadata(shell);
  const type: PublicMetadata['type'] = path.startsWith('/community/designs/') ? 'ItemPage' : path.startsWith('/community/creators/') ? 'ProfilePage' : 'CollectionPage';
  const breadcrumbs = [{ name: 'Home', path: '/' }, { name: 'Community', path: '/community' }, ...(path === '/community' ? [] : [{ name: title, path }])];
  shell=shell.replace('</head>', publicMetadata({ origin: base, path, title, description, type, indexable, image: cover, imageAlt: cover ? title : undefined, breadcrumbs }) + '</head>');
  return c.html(shell,status,{'Cache-Control':'no-store'});
}
