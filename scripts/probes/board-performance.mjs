import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {CreativeWorkspace} from './src/app/creative-workspace';
import {createDocument} from './src/shared/catalog';import {upgradeDocument} from './src/shared/document-upgrade';
import {boardSchema,boardElementSchema} from './src/shared/board-schema';import {diagramNode,diagramEdge} from './src/shared/diagram-presets';
const count=Number(new URL(location.href).searchParams.get('count')||500),edges=count===500?150:600,labels=count===500?100:400;
const doc=upgradeDocument(createDocument('slides')),elements=[];
for(let i=0;i<count-edges-labels;i++)elements.push(diagramNode('n'+i,'flowchart','process','Node '+i,(i%20)*260,Math.floor(i/20)*150));
for(let i=0;i<labels;i++)elements.push(boardElementSchema.parse({id:'t'+i,name:'Label '+i,type:'text',text:'Label '+i,x:(i%20)*260,y:Math.floor(i/20)*150+100,width:180,height:30,fontFamily:'Arial',fontSize:16,fill:'none',stroke:'#26352d',strokeWidth:1,align:'left'}));
for(let i=0;i<edges;i++){const a=i%(count-edges-labels-1);elements.push(diagramEdge('e'+i,'n'+a,'n'+(a+1),'Link '+i));}
doc.boards.push(boardSchema.parse({id:'board',name:'Workload '+count,elements}));
function App(){const[d,setD]=useState(doc);return <CreativeWorkspace doc={d} boardId="board" onCommit={(_,n)=>{window.savedCount=n.boards[0].elements.length;setD(n)}} onClose={()=>{}} onUndo={()=>{}} onRedo={()=>{}}/>};
createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, outfile: 'probe.js', bundle: true, write: false, minify: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
const browser=await chromium.launch();const results=[];
try {for(const count of [500,2000]){
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
await page.route('http://127.0.0.1:19403/**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>*{box-sizing:border-box}body{margin:0}${css}</style><div id="root"></div><script>${js}</script>`}));
const start=performance.now();await page.goto('http://127.0.0.1:19403/?count='+count);await page.getByLabel('Drawing canvas',{exact:true}).waitFor();
const mountMs=performance.now()-start;
const frames=await page.getByLabel('Drawing canvas',{exact:true}).evaluate(async svg=>{const times=[];let last=performance.now();for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now;svg.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaX:i<60?8:-8,deltaY:0}));}return times.slice(5).sort((a,b)=>a-b)});
await page.getByRole('button',{name:'Draw',exact:true}).click();const box=await page.getByLabel('Drawing canvas',{exact:true}).boundingBox();await page.mouse.move(box.x+80,box.y+80);await page.mouse.down();for(let i=1;i<=40;i++)await page.mouse.move(box.x+80+i*5,box.y+80+Math.sin(i/4)*20);await page.mouse.up();
await page.waitForFunction(n=>window.savedCount===n+1,count);await mkdir('artifacts',{recursive:true});await page.screenshot({path:`artifacts/board-workload-${count}.png`});
results.push({count,browser:browser.version(),mountMs:Math.round(mountMs),frameP95Ms:Math.round(frames[Math.floor(frames.length*.95)]*100)/100,frameMaxMs:Math.round(frames.at(-1)*100)/100,savedCount:await page.evaluate(()=>window.savedCount),errors});await page.close();}
console.log(JSON.stringify(results,null,2));await writeFile('artifacts/board-performance.json',JSON.stringify(results,null,2));
}finally{await browser.close()}
