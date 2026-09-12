import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createDocument } from '../src/shared/catalog';

test('real headless renderer creates PNG, PDF, editable PowerPoint, 3D and video bytes', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: await readFile('public/studio-renderer.js', 'utf8') });
    const doc = createDocument('slides', 'Export validation');
    await t.test('PNG has real raster dimensions and PDF has correct signature', async () => {
      await page.evaluate(doc => (globalThis as any).studioRenderer.present(doc, 0), doc);
      const bytes = await page.screenshot({ type: 'png' });
      assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 720);
      // Valid IHDR dimensions do not prove anything was drawn; histogram the real bytes for content.
      const histogram = await page.evaluate(async base64 => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height;
        const drawing = sample.getContext('2d')!; drawing.drawImage(image, 0, 0);
        const pixels = drawing.getImageData(0, 0, sample.width, sample.height).data, counts = new Map<number, number>();
        for (let i = 0; i < pixels.length; i += 4) { const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]; counts.set(color, (counts.get(color) ?? 0) + 1); }
        return { distinct: counts.size, drawn: pixels.length / 4 - Math.max(...counts.values()) };
      }, bytes.toString('base64'));
      assert.ok(histogram.distinct > 50, `A rendered slide should produce many colors, found ${histogram.distinct}`);
      assert.ok(histogram.drawn > 5000, `A rendered slide should paint over its background, found ${histogram.drawn} pixels`);
      const pdf = await page.pdf({ printBackground: true, width: '1280px', height: '720px' });
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
      // The magic alone passes for an empty PDF; require a page object (or single-page tree) and its geometry.
      const pdfText = pdf.toString('latin1');
      assert.ok(/\/Type\s*\/Page[^s]/.test(pdfText) || /\/Count\s+1\b/.test(pdfText), 'PDF must contain a page object or a single-page tree');
      const mediaBox = pdfText.match(/\/MediaBox\s*\[([^\]]*)\]/);
      assert.ok(mediaBox, 'PDF must declare a page MediaBox');
      const [left, top, right, bottom] = mediaBox![1].trim().split(/\s+/).map(Number);
      assert.ok(right - left > 0 && bottom - top > 0);
      assert.ok(Math.abs((right - left) / (bottom - top) - 1280 / 720) < 1e-6, 'PDF MediaBox must match the requested 1280x720 aspect');
    });
    await t.test('PPTX is a valid zip with text in native slide XML', async () => {
      const base64 = await page.evaluate(doc => (globalThis as any).studioRenderer.pptx(doc), doc);
      const bytes = Buffer.from(base64, 'base64'); assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      const { default: JSZip } = await import('jszip'); const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
      assert.ok(xml.includes('Good ideas')); assert.ok(xml.includes('<a:t>'));
      assert.ok(zip.file('ppt/slides/slide3.xml'));
    });
    await t.test('Three.js scene is rendered into a raster layer', async () => {
      await page.evaluate(doc => (globalThis as any).studioRenderer.present(doc, 0), createDocument('3d', 'Object'));
      const raster = page.locator('canvas[data-scene-layer="3d"]');
      const coverage = await raster.evaluate(canvas => {
        const layer = canvas as HTMLCanvasElement, data = layer.getContext('2d')!.getImageData(0, 0, layer.width, layer.height).data;
        const colors = new Set<number>(); let opaque = 0;
        for (let i = 0; i < data.length; i += 4) { if (data[i + 3] > 0) opaque++; colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]); }
        return { opaque, distinct: colors.size };
      });
      assert.ok(coverage.opaque > 10000, `The 3D layer should cover real area, found ${coverage.opaque} opaque pixels`);
      assert.ok(coverage.distinct > 100, `A shaded 3D object should produce many colors, found ${coverage.distinct}`);
      assert.equal(await page.locator('[data-scene-layer="2d"]').count(), 2, 'Captions remain on either side of the 3D layer');
    });
    await t.test('timeline records an actual WebM container', async () => {
      const motion = createDocument('video', 'Motion'); motion.timeline!.duration = 0.4;
      motion.timeline!.tracks = [{ id: 'moving-shape', nodeId: motion.pages[0].nodes[0].id, keyframes: [{ time: 0, values: { x: 100 } }, { time: 0.4, values: { x: 700 } }] }];
      const recorded = await page.evaluate(async doc => {
        const NativeRecorder = MediaRecorder;
        let startedAt = 0, stoppedAt = 0;
        // Observe the real encoder lifecycle; stopping before startup can discard queued frames.
        globalThis.MediaRecorder = class extends NativeRecorder {
          constructor(stream: MediaStream, options?: MediaRecorderOptions) {
            super(stream, options); this.addEventListener('start', () => { startedAt = performance.now(); });
          }
          stop() { stoppedAt = performance.now(); super.stop(); }
        };
        try { return { base64: await (globalThis as any).studioRenderer.video(doc, 0, 'webm'), startedAt, stoppedAt }; }
        finally { globalThis.MediaRecorder = NativeRecorder; }
      }, motion);
      const bytes = Buffer.from(recorded.base64, 'base64'); assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3'); assert.ok(bytes.length > 500);
      assert.ok(recorded.startedAt > 0 && recorded.stoppedAt - recorded.startedAt >= 90, 'queued frames need a drain interval after encoder startup');
    });
    await t.test('selected video interval samples its actual start and limits duration and frame cadence',async()=>{
      const motion=createDocument('video','Selected interval');motion.pages=[{id:'page',name:'Page',width:160,height:90,background:'#ffffff',nodes:[{id:'red',type:'shape',name:'Red',x:0,y:0,width:20,height:20,style:{fill:'#ff0000'}}]}];
      motion.timeline={duration:3,fps:30,tracks:[{id:'move',nodeId:'red',keyframes:[{time:0,values:{x:0}},{time:1,values:{x:100}},{time:3,values:{x:100}}]}]};
      const observation=await page.evaluate(async doc=>{
        const proto=CanvasCaptureMediaStreamTrack.prototype,original=proto.requestFrame;let frames=0,first:number[]=[];
        proto.requestFrame=function(){frames++;if(frames===1){const canvas=[...document.querySelectorAll('canvas')].find(canvas=>canvas.width===160&&canvas.height===90)!;first=[...canvas.getContext('2d')!.getImageData(110,10,1,1).data];}return original.call(this);};
        const start=performance.now();try{return {base64:await(globalThis as any).studioRenderer.video(doc,0,'webm',{start:1,end:1.4,fps:5}),first,frames,elapsed:performance.now()-start};}finally{proto.requestFrame=original;}
      },motion);
      assert.deepEqual(observation.first,[255,0,0,255]);assert.ok(observation.frames>=3&&observation.frames<=8,`Observed ${observation.frames} requested frames`);assert.ok(observation.elapsed<2500,`Selected clip took ${observation.elapsed}ms instead of a short interval`);assert.equal(Buffer.from(observation.base64,'base64').subarray(0,4).toString('hex'),'1a45dfa3');
    });
  } finally { await browser.close(); }
});
