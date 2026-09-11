import { build } from 'esbuild';
import { chromium, firefox, webkit } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const bundle=await build({stdin:{contents:`export {characterSvg} from './src/shared/character-svg'; export {characterSchema,characterInstanceSchema} from './src/shared/character-schema';`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Motion'});
const results=[];
for(const [name,engine] of Object.entries({chromium,firefox,webkit})) {
 const browser=await engine.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.setContent('<div id="view"></div>'); await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#7c3aed';ctx.fillRect(8,8,112,112);ctx.clearRect(40,40,48,48);const url=canvas.toDataURL();
 const bones=Array.from({length:64},(_,i)=>({id:'b'+i,name:'Bone',x:i?0:64,y:i?0:64}));
 const vertices=[],uv=[],triangles=[];for(let y=0;y<9;y++)for(let x=0;x<9;x++){vertices.push([x*16,y*16]);uv.push([x/8,y/8]);if(x<8&&y<8){const i=y*9+x;triangles.push(i,i+1,i+9,i+1,i+10,i+9);}}
 const slots=Array.from({length:32},(_,i)=>({id:'s'+i,name:'Layer',boneId:'b'+i,attachmentId:'a'+i}));
 const attachments=slots.map((s,i)=>({id:'a'+i,name:'Mesh',slotId:s.id,kind:'mesh',assetId:'art',width:128,height:128,mesh:{version:1,vertices,uv,triangles,weights:vertices.map(()=>[{boneId:s.boneId,weight:1}])}}));
 const channels=Array.from({length:50},(_,i)=>({id:'ch'+i,target:'bone',targetId:'b'+i,property:'rotation',keys:Array.from({length:200},(_,k)=>({id:`k${i}_${k}`,time:k/20,value:k/10}))}));
 const c=Motion.characterSchema.parse({id:'rig',name:'Spike',width:256,height:256,bones,slots,attachments,skins:[],clips:[{id:'idle',name:'Idle',duration:10,channels}]});const instance=Motion.characterInstanceSchema.parse({characterId:'rig',clipId:'idle'});
 const samples=[];for(let n=0;n<35;n++){const start=performance.now();const svg=Motion.characterSvg(c,instance,[{id:'art',url}],n/60,'one')+Motion.characterSvg(c,instance,[{id:'art',url}],n/60,'two'); document.getElementById('view').innerHTML=`<svg width="512" height="512" viewBox="0 0 512 512">${svg}</svg>`;document.getElementById('view').getBoundingClientRect();if(n>=5)samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b); return {p95:samples[Math.floor(samples.length*.95)],vertices:vertices.length*32*2,keys:10000,triangles:triangles.length/3*32*2};
 });
 results.push({browser:name,version:browser.version(),...result});await page.screenshot({path:`plans/260910-1158-2d-character-motion/reports/spike-${name}.png`});
 } finally {await browser.close();}
}
await writeFile('plans/260910-1158-2d-character-motion/reports/runtime-spike-results.json',JSON.stringify(results,null,2));console.log(results);
