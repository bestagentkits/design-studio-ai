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
      const pdf = await page.pdf({ printBackground: true, width: '1280px', height: '720px' });
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
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
      assert.ok(await page.locator('svg image').getAttribute('href').then(value => value?.startsWith('data:image/png')));
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
  } finally { await browser.close(); }
});
