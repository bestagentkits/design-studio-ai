import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {app} from '../server/index';
import {SqliteDatabase,staticAssets} from '../server/node-adapters';
import {createDocument} from '../src/shared/catalog';
import {now} from '../server/security';
import type {Bindings} from '../server/types';

test('public Community HTML, canonical metadata and sitemap reveal only live listings without JavaScript',async()=>{
  const db=new SqliteDatabase(':memory:'),base='https://studio.test';
  const env:Bindings={DB:db,ASSETS_BUCKET:{put:async()=>{},get:async()=>null,delete:async()=>{}},ASSETS:staticAssets(resolve('dist')),APP_URL:base,COMMUNITY_ENABLED:'true'};
  try{
    for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
    const time=now();await db.prepare('INSERT INTO users(id,email,password,name,created_at) VALUES(?,?,?,?,?)').bind('author','private-email@example.test','unused','Private account',time).run();
    await db.prepare('INSERT INTO community_profiles(user_id,handle,display_name,bio,search_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('author','public-author','Public author','A public bio','public author',time,time).run();
    for(const id of ['live-design','hidden-design']){
      await db.prepare('INSERT INTO community_listings(id,user_id,created_at,updated_at) VALUES(?,?,?,?)').bind(id,'author',time,time).run();
      await db.prepare("INSERT INTO community_versions(listing_id,version,document,title,description,kind,tags,metadata,search_text,disclosure,license,source_revision,checksum,status,created_at) VALUES(?,1,?,?,'A useful design','web','[]','{}','useful design','{}','CC-BY-4.0',1,'checksum','ready',?)").bind(id,JSON.stringify(createDocument()),id==='live-design'?'Useful <script>alert(1)</script> design':'PRIVATE HIDDEN TITLE',time).run();
      await db.prepare('UPDATE community_listings SET current_version=1,owner_available=?,first_published_at=? WHERE id=?').bind(id==='live-design'?1:0,time,id).run();
    }
    const get=(path:string)=>app.request(base+path,{},env);
    for(const path of ['/community','/community/designs/live-design','/community/creators/public-author']){
      const response=await get(path),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control')??'',/no-store/);
      assert.match(html,/Useful &lt;script&gt;alert\(1\)&lt;\/script&gt; design/);assert.equal(html.includes('PRIVATE HIDDEN TITLE'),false);assert.equal(html.includes('private-email@'),false);
      assert.match(html,new RegExp(`<link rel="canonical" href="${base}${path}">`));assert.ok(!html.includes('<script>alert(1)</script>'));
      assert.equal(html.match(/name="twitter:card"/g)?.length,1);
      assert.match(html,/name="twitter:card" content="summary_large_image"/);
      assert.match(html,/property="og:image" content="https:\/\/studio.test\/social-card.png"/);
      const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'];
      assert.equal(graph[1]['@type'],path.includes('/designs/')?'ItemPage':path.includes('/creators/')?'ProfilePage':'CollectionPage');
      assert.equal(graph[1].url,base+path);
    }
    const sitemap=await(await get('/sitemap.xml')).text();assert.match(sitemap,/community\/designs\/live-design/);assert.ok(!sitemap.includes('hidden-design'));assert.ok(!sitemap.includes('/community/moderation'));
    assert.equal((await get('/community/designs/hidden-design')).status,404);
    assert.match(await(await get('/community?q=useful')).text(),/name="robots" content="noindex,follow"/);
    assert.match(await(await get('/community/moderation')).text(),/name="robots" content="noindex,follow"/);
    const redirect=await get('/marketplace?q=useful');assert.equal(redirect.status,301);assert.equal(redirect.headers.get('Location'),'/community?q=useful');
    await db.prepare("UPDATE community_listings SET suppressed=1 WHERE id='live-design'").run();assert.equal((await get('/community/designs/live-design')).status,404);assert.ok(!(await(await get('/sitemap.xml')).text()).includes('live-design'));
    env.COMMUNITY_ENABLED='false';assert.equal((await get('/community')).status,404);
  }finally{db.close();}
});
