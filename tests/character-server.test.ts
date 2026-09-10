import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {app} from '../server/index';
import {FileBucket,SqliteDatabase} from '../server/node-adapters';
import {secret} from '../server/security';
import {builtStaticAssets} from './built-static-assets';
import type {Bindings} from '../server/types';
import type {DesignDocument} from '../src/shared/schema';
import {createDocument} from '../src/shared/catalog';
import {newCharacter,addCharacterLayer,newClip,keyBone} from '../src/shared/character-editing';
import {characterInstanceSchema} from '../src/shared/character-schema';

test('character assets survive clone, portable packages embed hidden skins, proposal guards and ownership hold',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-character-')),db=new SqliteDatabase(':memory:');
 const env:Bindings={DB:db,ASSETS_BUCKET:new FileBucket(join(dir,'assets')),ASSETS:builtStaticAssets,APP_URL:'https://studio.example',ALLOW_REGISTRATION:'true',ENCRYPTION_KEY:secret()};let cookie='';
 const request=(path:string,method='GET',body?:unknown)=>app.request(`https://studio.example${path}`,{method,headers:{Origin:'https://studio.example',Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})},env);
 try{
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 const registered=await request('/api/auth/register','POST',{email:'motion@studio.test',password:'Secure-Test-Password-917!',name:'Motion tester'});assert.equal(registered.status,201);cookie=registered.headers.get('set-cookie')!.split(';')[0];
 const created=await request('/api/projects','POST',{name:'Motion',kind:'web'});assert.equal(created.status,201);const original=(await created.json() as any).project;
 const form=new FormData();form.set('file',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],'art.png',{type:'image/png'}));
 const uploaded=await request(`/api/projects/${original.id}/assets`,'POST',form);assert.equal(uploaded.status,201);const {asset}=await uploaded.json() as any;
 const doc:DesignDocument=original.document,c=newCharacter();addCharacterLayer(c,asset.id,'Artwork',64,64);const alt=structuredClone(c.attachments[0]);alt.id='hidden-attachment';alt.name='Hidden';c.attachments.push(alt);c.skins.push({id:'alternate',name:'Alternate',attachments:{[alt.slotId]:alt.id}});const clip=newClip('Wave');c.clips.push(clip);keyBone(c,clip.id,c.bones[0].id,0,{rotation:0});keyBone(c,clip.id,c.bones[0].id,1,{rotation:45});doc.schemaVersion=2;doc.characters=[c];doc.assets=[asset];doc.pages[0].nodes=[{id:'actor',name:'Actor',type:'character',x:0,y:0,width:512,height:512,character:characterInstanceSchema.parse({characterId:c.id,clipId:clip.id})}];
 const saved=await request(`/api/projects/${original.id}/document`,'PUT',{document:doc,expectedRevision:original.revision,expectedBriefRevision:0});assert.equal(saved.status,200,await saved.clone().text());const revision=(await saved.json() as any).project.revision;
 const conflict=await request(`/api/projects/${original.id}/document`,'PUT',{document:doc,expectedRevision:revision,expectedBriefRevision:7});assert.equal(conflict.status,409);
 const low={...createDocument('web'),id:original.id};assert.equal((await request(`/api/projects/${original.id}/document`,'PUT',{document:low,expectedRevision:revision})).status,409);
 const inspect=await request(`/api/projects/${original.id}/motion?nodeId=actor&time=1`);assert.equal(inspect.status,200);assert.equal((await inspect.json() as any).characters[0].pose.bones[c.bones[0].id].rotation,45);
 const cloneResponse=await request('/api/projects','POST',{name:'Independent',kind:'web',document:doc});assert.equal(cloneResponse.status,201,await cloneResponse.clone().text());const copied=(await cloneResponse.json() as any).project;const copiedAsset=copied.document.assets[0];assert.notEqual(copiedAsset.id,asset.id);assert.ok(copied.document.characters[0].attachments.every((a:any)=>a.assetId===copiedAsset.id));
 assert.equal((await request(`/api/projects/${original.id}`,'DELETE')).status,200);assert.equal((await request(copiedAsset.url)).status,200);
 const exported=await request(`/api/projects/${copied.id}/export`,'POST',{format:'motion'});assert.equal(exported.status,200,await exported.clone().text());const zip=await JSZip.loadAsync(await exported.arrayBuffer());assert.ok(zip.file('player.js'));const packaged=JSON.parse(await zip.file('document.json')!.async('string'));assert.match(packaged.assets[0].url,/^data:image\/png;base64,/);assert.equal(packaged.characters[0].skins.length,1);
 const publicResult=await request(`/api/projects/${copied.id}/publish`,'POST',{});assert.equal(publicResult.status,200);const body=await publicResult.json() as any;const published=await request(new URL(body.url,'https://studio.example').pathname);assert.equal(published.status,200);assert.match(await published.text(),/hidden-attachment/);
 const owner=cookie;cookie='';assert.equal((await request(`/api/projects/${copied.id}/motion`)).status,401);cookie=owner;
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
