import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { chromium, expect, type Page } from '@playwright/test';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase, staticAssets } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';
import type { DesignDocument, Project } from '../src/shared/schema';

test('published interactive documents run inside the real sandboxed response', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-published-viewer-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ASSETS: staticAssets(resolve('public')), APP_URL: '', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  let server: ReturnType<typeof serve> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    // This short-lived test server owns an OS-assigned port and closes in finally.
    server = serve({ fetch: request => app.fetch(request, env), hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    env.APP_URL = base;
    const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `published-${crypto.randomUUID()}@studio.test`, password: secret(), name: 'Published viewer tester' }) });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const publish = async (document: DesignDocument) => {
      const created = await fetch(`${base}/api/projects`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.name, kind: document.kind, document }) });
      assert.equal(created.status, 201);
      const project = ((await created.json()) as { project: Project }).project;
      const published = await fetch(`${base}/api/projects/${project.id}/publish`, { method: 'POST', headers: { Cookie: cookie, Origin: base } });
      assert.equal(published.status, 200);
      return ((await published.json()) as { url: string }).url;
    };
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const open = async (page: Page, url: string) => {
      const response = await page.goto(url);
      assert.equal(response?.status(), 200);
      const csp = response!.headers()['content-security-policy'];
      assert.match(csp, /sandbox allow-scripts(?:;|$)/);
      assert.ok(!csp.includes('allow-same-origin'));
      assert.ok(!csp.includes("script-src 'unsafe-inline'"));
      const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
      assert.ok(nonce);
      assert.equal(await page.locator('script:not([type="application/json"])').evaluate(script => (script as HTMLScriptElement).nonce), nonce);
      assert.equal(await page.evaluate(() => { try { return document.cookie; } catch (error) { return (error as Error).name; } }), 'SecurityError', 'The publication must have an opaque sandbox origin');
    };

    await t.test('3D publication runs the nonce-authorized viewer and renders actual shaded pixels', async () => {
      const doc = createDocument('3d', 'Published 3D geometry');
      doc.pages = [{ id: 'scene-page', name: 'Scene', width: 600, height: 500, background: '#ffffff', nodes: [{ id: 'sphere-object', type: 'model3d', name: 'Interactive sphere', x: 100, y: 80, width: 360, height: 320, style: { fill: '#bd4a35' }, data: { geometry: 'sphere' } }] }];
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await open(page, await publish(doc));
        const host = page.locator('[data-studio-object="sphere-object"]');
        await expect(host.locator('canvas')).toBeVisible();
        await expect(page.locator('[data-node-id="sphere-object"]')).toHaveAttribute('visibility', 'hidden');
        await expect(host).not.toContainText('could not load');
        const screenshot = await host.locator('canvas').screenshot();
        const shades = await page.evaluate(async png => {
          const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
          const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height;
          const drawing = sample.getContext('2d')!; drawing.drawImage(image, 0, 0);
          const pixels = drawing.getImageData(0, 0, sample.width, sample.height).data;
          const colors = new Set<number>();
          for (let i = 0; i < pixels.length; i += 16) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
          return colors.size;
        }, screenshot.toString('base64'));
        assert.ok(shades > 20, `A shaded 3D object should produce many colors, found ${shades}`);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });

    await t.test('timeline controls scrub and play the published SVG under its CSP', async () => {
      const doc = createDocument('video', 'Published timeline');
      doc.pages = [{ id: 'motion-page', name: 'Motion', width: 600, height: 400, background: '#ffffff', nodes: [{ id: 'moving-shape', type: 'shape', name: 'Moving shape', x: 20, y: 30, width: 90, height: 70, style: { fill: '#bd4a35' } }] }];
      doc.timeline = { duration: 2, fps: 30, tracks: [{ id: 'motion-track', nodeId: 'moving-shape', keyframes: [{ time: 0, values: { x: 20, y: 30 } }, { time: 2, values: { x: 220, y: 130 } }] }] };
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await open(page, await publish(doc));
        const node = page.locator('[data-node-id="moving-shape"]');
        const slider = page.getByRole('slider', { name: 'Animation time' });
        await expect(node).toHaveAttribute('transform', 'translate(20 30) rotate(0 45 35)');
        await slider.press('End');
        await expect(node).toHaveAttribute('transform', 'translate(220 130) rotate(0 45 35)');
        await slider.press('Home');
        await expect(node).toHaveAttribute('transform', 'translate(20 30) rotate(0 45 35)');
        await page.getByRole('button', { name: 'Play animation', exact: true }).click();
        await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(0.05);
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        assert.notEqual(await node.getAttribute('transform'), 'translate(20 30) rotate(0 45 35)');
        await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });

    await t.test('untrusted document text cannot escape the embedded JSON or create executable markup', async () => {
      const payload = '</script><script>globalThis.__publishedInjection=1</script><img src=x onerror="globalThis.__publishedInjection=2">';
      const doc = createDocument('video', 'Safe published text');
      doc.pages = [{ id: 'text-page', name: 'Untrusted text', width: 900, height: 500, background: '#ffffff', nodes: [{ id: 'untrusted-text', type: 'text', name: payload, text: payload, x: 10, y: 10, width: 860, height: 400, style: { fontSize: 14, fill: '#000000' } }] }];
      doc.timeline = { duration: 1, fps: 30, tracks: [] };
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await open(page, await publish(doc));
        await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
        assert.equal(await page.locator('script').count(), 2, 'Only JSON data and the trusted viewer may create script elements');
        assert.equal(await page.locator('img, [onerror]').count(), 0);
        assert.equal(await page.evaluate(() => (globalThis as unknown as { __publishedInjection?: number }).__publishedInjection), undefined);
        const embedded = await page.locator('#studio-document').textContent();
        assert.equal(JSON.parse(embedded!).pages[0].nodes[0].text, payload);
        assert.ok((await page.locator('[data-node-id="untrusted-text"] text').textContent())!.includes('globalThis.__publishedInjection'));
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((accept, reject) => server!.close(error => error ? reject(error) : accept()));
    db.close();
    const target = resolve(directory), temporaryRoot = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(temporaryRoot) && target.split(sep).pop()!.startsWith('studio-published-viewer-'));
    await rm(target, { recursive: true, force: true });
  }
});
