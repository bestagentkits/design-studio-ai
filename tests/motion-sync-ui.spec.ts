import {readFile} from 'node:fs/promises';
import {test,expect} from './authenticated-browser';
import {createDocument} from '../src/shared/catalog';
import {newCharacter,addCharacterLayer,gridMesh} from '../src/shared/character-editing';
import {characterInstanceSchema} from '../src/shared/character-schema';

test('mesh stays loaded across live document updates and Save enables Share in preview',async({page,baseURL})=>{
 const headers={Origin:baseURL!},doc=createDocument('video','Sync regression');
 doc.schemaVersion=2;doc.pages[0].nodes=[];doc.timeline={duration:6,fps:30,tracks:[]};
 const c=newCharacter('Sync character');addCharacterLayer(c,'image','Body',64,64);
 c.attachments[0].kind='mesh';c.attachments[0].mesh=gridMesh(64,64);
 const imageUrl=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#8b5cf6';ctx.fillRect(0,0,64,64);return canvas.toDataURL('image/png');});
 doc.characters=[c];doc.assets=[{id:'image',name:'Body',type:'image',mimeType:'image/png',url:imageUrl}];
 doc.pages[0].nodes=[{id:'actor',type:'character',name:'Actor',x:0,y:0,width:512,height:512,character:characterInstanceSchema.parse({characterId:c.id})}];
 const response=await page.request.post('/api/projects',{headers,data:{name:doc.name,kind:doc.kind,document:doc}});expect(response.status(),await response.text()).toBe(201);
 const project=(await response.json()).project;
 await page.addInitScript(()=>{
  const original=HTMLImageElement.prototype.decode;
  (window as any).imageDecodes=0;
  HTMLImageElement.prototype.decode=async function(){(window as any).imageDecodes++;await original.call(this);await new Promise(r=>setTimeout(r,100));};
 });
 try{
  await page.goto(`/?project=${project.id}&mode=preview`);
  const view=page.locator('[data-character-ready]').first();await expect(view).toHaveAttribute('data-character-ready','true');
  await page.evaluate(()=>{
   (window as any).readinessDrops=0;
   new MutationObserver(records=>{for(const r of records)if((r.target as Element).getAttribute('data-character-ready')==='false')(window as any).readinessDrops++;}).observe(document.querySelector('[data-character-ready]')!,{attributes:true,attributeFilter:['data-character-ready']});
  });
  const initialDecodes=await page.evaluate(()=>(window as any).imageDecodes);
  const remote=structuredClone(project.document);remote.name='Remote name';
  const update=await page.request.put(`/api/projects/${project.id}/document`,{headers,data:{document:remote,expectedRevision:project.revision}});expect(update.status()).toBe(200);
  await expect(page.getByRole('textbox',{name:'Project name',exact:true})).toHaveValue('Remote name');
  expect(await page.evaluate(()=>(window as any).imageDecodes)).toBe(initialDecodes);
  expect(await page.evaluate(()=>(window as any).readinessDrops)).toBe(0);
  await page.getByRole('checkbox',{name:'Live',exact:true}).uncheck();
  await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Saved name');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Share',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Preview',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Share',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Your design is out in the world'})).toBeVisible();
 }finally{await page.request.delete(`/api/projects/${project.id}`,{headers});}
});

test('stalled Live request releases Save and Share without retrying an uncertain write',async({page,baseURL})=>{
 const headers={Origin:baseURL!};const r=await page.request.post('/api/projects',{headers,data:{name:'Deadline regression',kind:'web'}});const project=(await r.json()).project;
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started=false;
 await page.route('**/merge',async route=>{started=true;await gate;await route.continue().catch(()=>{});});
 try{
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Pending local edit');
  await expect.poll(()=>started).toBe(true);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Share',exact:true})).toBeEnabled({timeout:22000});
  await expect(page.getByRole('textbox',{name:'Project name',exact:true})).toHaveValue('Pending local edit');
  await expect(page.getByRole('checkbox',{name:'Live',exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Share',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'reconcile the timed-out save'})).toBeVisible();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Design JSON Fully editable source',exact:true}).click();
  const download=await downloadPromise;
  const backup=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(backup.name).toBe('Pending local edit');
  expect(backup.id).toBe(project.id);
  const saved=(await (await page.request.get(`/api/projects/${project.id}`)).json()).project;
  expect(saved.revision).toBe(project.revision);
 }finally{release();await page.unrouteAll({behavior:'wait'});await page.request.delete(`/api/projects/${project.id}`,{headers});}
});
