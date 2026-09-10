import {test,expect} from './authenticated-browser';
import {createDocument} from '../src/shared/catalog';
import JSZip from 'jszip';
test('create rig, import real PNG, animate, compose, persist and export frames',async({page,baseURL},info)=>{
 const headers={Origin:baseURL!},doc=createDocument('video','Character acceptance');doc.pages=[{id:'page',name:'Scene',width:512,height:512,background:'#fff',nodes:[]}];
 doc.timeline={duration:2,fps:30,tracks:[]};
 const created=await page.request.post('/api/projects',{headers,data:{name:doc.name,kind:doc.kind,document:doc}});expect(created.status()).toBe(201);const project=(await created.json()).project;
 try{
 await page.goto(`/?project=${project.id}`);await expect(page.getByRole('button',{name:'Back to workspace'})).toBeVisible();
 if(['mobile','webkit'].includes(info.project.name))await page.locator('.mobile-editor-nav').getByRole('button',{name:'Canvas',exact:true}).click();
 await page.getByRole('checkbox',{name:'Live',exact:true}).uncheck();
 await page.getByRole('button',{name:'Character Motion',exact:true}).first().click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'New character',exact:true}).click();await expect(dialog.getByLabel('Character name',{exact:true})).toHaveValue('Character');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!;ctx.fillStyle='#7c3aed';ctx.fillRect(4,4,56,56);return c.toDataURL().split(',')[1];});
 await dialog.getByLabel('Import character images').setInputFiles({name:'body.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(dialog.getByRole('combobox',{name:'Bone',exact:true}).locator('option')).toHaveCount(2);
 await dialog.getByRole('button',{name:'Animate',exact:true}).click();await dialog.getByRole('button',{name:'New clip',exact:true}).click();
 await dialog.getByRole('button',{name:'Key selected pose',exact:true}).click();await dialog.getByLabel('Clip time seconds').fill('1');await dialog.getByLabel('Bone rotation').fill('45');await dialog.getByRole('button',{name:'Key selected pose',exact:true}).click();
 await dialog.getByRole('button',{name:'Compose',exact:true}).click();await dialog.getByRole('button',{name:'Place clip in scene',exact:true}).click();
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 const saved=(await (await page.request.get(`/api/projects/${project.id}`)).json()).project;expect(saved.document.schemaVersion).toBe(2);expect(saved.document.characters[0].clips[0].channels).toHaveLength(5);
 const old={...saved.document,schemaVersion:1,characters:undefined,pages:saved.document.pages.map((p:any)=>({...p,nodes:[]}))};const downgrade=await page.request.put(`/api/projects/${project.id}/document`,{headers,data:{document:old,expectedRevision:saved.revision}});expect(downgrade.status()).toBe(409);
 const inspect=await page.request.get(`/api/projects/${project.id}/motion?nodeId=${saved.document.pages[0].nodes[0].id}&time=1`);expect(inspect.status()).toBe(200);expect((await inspect.json()).characters[0].pose.bones[saved.document.characters[0].bones[0].id].rotation).toBe(45);
 const frames=await page.request.post(`/api/projects/${project.id}/export`,{headers,data:{format:'png-sequence',start:0,end:1,fps:2,expectedRevision:saved.revision}});expect(frames.status(),await frames.text().then(t=>t.slice(0,150))).toBe(200);const zip=await JSZip.loadAsync(await frames.body());expect(zip.file('frame-00000.png')).not.toBeNull();expect(zip.file('frame-00001.png')).not.toBeNull();const bytes=await zip.file('frame-00000.png')!.async('uint8array');expect(Array.from(bytes.slice(0,8))).toEqual([137,80,78,71,13,10,26,10]);expect(await zip.file('frame-00000.png')!.async('base64')).not.toBe(await zip.file('frame-00001.png')!.async('base64'));
 await page.reload();await expect(page.locator('[data-character-ready="true"]').first()).toBeVisible();
 const character=page.locator('[data-character-ready]').first();await character.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext());await expect.poll(()=>character.locator('canvas').evaluate((c:HTMLCanvasElement)=>!!c.getContext('2d'))).toBe(true);await expect(character).toHaveAttribute('data-character-ready','true');
 const native=await page.request.post(`/api/projects/${project.id}/export`,{headers,data:{format:'motion'}});expect(native.status()).toBe(200);const nativeBytes=await native.body();
 if(['mobile','webkit'].includes(info.project.name))await page.locator('.mobile-editor-nav').getByRole('button',{name:'Canvas',exact:true}).click();
 await page.getByRole('button',{name:'Character Motion',exact:true}).first().click();await page.getByRole('dialog').getByLabel('Import native motion ZIP').setInputFiles({name:'motion.zip',mimeType:'application/zip',buffer:nativeBytes});await expect(page.getByRole('dialog').getByRole('combobox',{name:'Character',exact:true}).locator('option')).toHaveCount(3);
 await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
 }finally{await page.request.delete(`/api/projects/${project.id}`,{headers});}
});
