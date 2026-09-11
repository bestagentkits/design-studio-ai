import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { gif } from './helpers/gif-fixture';

test('real browser export GIF samples retain mixed vector z-order, pause and static poster', { timeout: 30000 }, async () => {
  const bundle = await build({ stdin: { contents: `
    import { sampleCreativeGifs } from './src/app/creative-elements-export';
    import { boardSvg } from './src/shared/board-render';
    import { boardElementSchema } from './src/shared/board-schema';
    window.probe = async (url) => {
      const poster = document.createElement('canvas'); poster.width = 2; poster.height = 1; const p = poster.getContext('2d'); p.fillStyle = '#808080'; p.fillRect(0,0,2,1);
      const board = {id:'board',name:'board',background:'#ffffff',elements:[
        boardElementSchema.parse({id:'gif',name:'GIF',type:'gif',x:0,y:0,width:200,height:100,assetId:'gifsource',posterAssetId:'poster',posterTime:0,playing:true,loop:true}),
        boardElementSchema.parse({id:'cover',name:'Vector above',type:'shape',x:100,y:0,width:100,height:100,shape:'rectangle',radius:0,stroke:'#0000ff',fill:'#0000ff',strokeWidth:1})
      ]};
      const input={schemaVersion:2,boards:[board],paintings:[],assets:[{id:'gifsource',url},{id:'poster',url:poster.toDataURL()}]};
      const sample=async(time)=>{const d=await sampleCreativeGifs(input,time),svg=boardSvg(d.boards[0],d,{x:0,y:0,width:200,height:100},200,100);const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const c=canvas.getContext('2d');c.drawImage(image,0,0);return [[50,50],[150,50]].map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data));};
      const first=await sample(0), second=await sample(.02), staticPoster=await sample();
      board.elements[0].playing=false;board.elements[0].pausedAtMs=20;const paused=await sample(100);
      return {first,second,staticPoster,paused,sourceUnchanged:input.assets[0].url===url&&board.elements[0].type==='gif'};
    };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<!doctype html><body></body>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(url => (window as unknown as { probe: (url: string) => Promise<Record<string, unknown>> }).probe(url), `data:image/gif;base64,${Buffer.from(gif(0)).toString('base64')}`);
    assert.deepEqual(result.first, [[255, 0, 0, 255], [0, 0, 255, 255]]);
    assert.deepEqual(result.second, [[0, 255, 0, 255], [0, 0, 255, 255]]);
    assert.deepEqual(result.staticPoster, [[128, 128, 128, 255], [0, 0, 255, 255]]);
    assert.deepEqual(result.paused, result.second); assert.equal(result.sourceUnchanged, true);
  } finally { await browser.close(); }
});


test('SVG importer rasterizes safe gradients and rejects active or external content', { timeout: 30000 }, async () => {
  const bundle = await build({ stdin: { contents: `import {sanitizeElementSvg,rasterizeElementSvg} from './src/app/creative-elements-svg';window.svgProbe=async()=>{
    const root='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">';
    const attacks=['<script>alert(1)</script>','<image href="https://example.com/a.png"/>','<rect onload="alert(1)"/>','<rect fill="url(https://example.com/a.svg)"/>','<foreignObject/>','<style>@import "https://example.com/a.css";</style>'];
    const blocked=attacks.map(body=>{try{sanitizeElementSvg(root+body+'</svg>');return false;}catch{return true;}});
    const safe=root+'<defs><linearGradient id="g"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#ff0000"/></linearGradient></defs><rect width="8" height="8" fill="url(#g)"/></svg>';
    const result=await rasterizeElementSvg(safe),bitmap=await createImageBitmap(result.blob),canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return {blocked,pixel:Array.from(ctx.getImageData(4,4,1,1).data),mime:result.blob.type};};`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try { const page = await browser.newPage(); await page.setContent('<!doctype html><body></body>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => (window as unknown as { svgProbe: () => Promise<{blocked: boolean[];pixel:number[];mime:string}> }).svgProbe());
    assert.deepEqual(result.blocked, Array(6).fill(true)); assert.deepEqual(result.pixel, [255,0,0,255]); assert.equal(result.mime, 'image/png');
  } finally { await browser.close(); }
});

test('bundled artwork inserts through real document validation and recolors its recipe after renaming', { timeout: 30000 }, async () => {
  const bundle = await build({ stdin: { contents: `
    import { bundledArtworkAsset, bundledAttribution, recolorBundledSticker } from './src/app/creative-elements-artwork';
    import { ELEMENT_LIBRARY } from './src/shared/creative-elements-catalog';
    import { createDocument } from './src/shared/catalog';
    import { mutateDocument } from './src/shared/operations';
    import { boardElementSchema } from './src/shared/board-schema';
    import { documentSchema } from './src/shared/schema';
    window.artworkProbe=async()=>{
      const item=ELEMENT_LIBRARY[0], asset=await bundledArtworkAsset(item,'#ee4455');
      const base=mutateDocument(createDocument('wireframe','Artwork validation'),[{op:'add-board',board:{id:'board',name:'Art',background:'#ffffff',elements:[]}}]);
      base.assets.push(asset);
      const element=boardElementSchema.parse({id:'star',name:'Renamed favorite',type:'sticker',assetId:asset.id,attribution:bundledAttribution(item),x:0,y:0,width:160,height:160});
      const inserted=mutateDocument(base,[{op:'upsert-board-elements',boardId:'board',elements:[element]}]); documentSchema.parse(inserted);
      const recolored=await recolorBundledSticker(inserted,element,'#22aa66');documentSchema.parse(recolored);
      const current=recolored.boards[0].elements[0],replacement=recolored.assets.find(a=>a.id===current.assetId),image=new Image();image.src=replacement.url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return {mime:asset.mimeType,url:asset.url.slice(0,22),dimensions:[image.width,image.height],pixel:Array.from(context.getImageData(256,256,1,1).data),oldRetained:recolored.assets.find(a=>a.id===asset.id).url===asset.url,sourceUnchanged:inserted.boards[0].elements[0].assetId===asset.id,newId:current.assetId!==asset.id,name:current.name};
    };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://studio.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto('https://studio.test/'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => (window as unknown as { artworkProbe: () => Promise<Record<string, unknown>> }).artworkProbe());
    assert.equal(result.mime, 'image/png'); assert.equal(result.url, 'data:image/png;base64,'); assert.deepEqual(result.dimensions, [512, 512]); assert.deepEqual(result.pixel, [34, 170, 102, 255]);
    assert.equal(result.oldRetained, true); assert.equal(result.sourceUnchanged, true); assert.equal(result.newId, true); assert.equal(result.name, 'Renamed favorite');
  } finally { await browser.close(); }
});
