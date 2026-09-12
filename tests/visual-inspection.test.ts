import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { build } from 'esbuild';
import type { Browser } from '@playwright/test';
import { app } from '../server/index';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { launchExportBrowser } from '../server/export-node';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument, Project } from '../src/shared/schema';
import type { VisualInspectionResult } from '../src/shared/visual-inspection';
import { registerDesignTools } from '../src/app/browser-design-tools';
import { builtStaticAssets } from './built-static-assets';

test('saved visual inspection renders real pixels and preserves identity across agent clients', { timeout: 420000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-inspection-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ASSETS: builtStaticAssets,
    APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret(), EXPORT_BROWSER: launchExportBrowser };
  let cookie = '', browser: Browser | undefined, server: ReturnType<typeof serve> | undefined;
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => app.request(`https://studio.example${path}`, {
    method, headers: { Cookie: cookie, Origin: 'https://studio.example', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const inspect = async (path: string, body: unknown): Promise<VisualInspectionResult> => {
    const response = await request(path, body);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('Cache-Control') ?? '', /private.*no-store/);
    return response.json() as Promise<VisualInspectionResult>;
  };
  const png = (image: VisualInspectionResult['images'][number]) => {
    const bytes = Buffer.from(image.data, 'base64');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), image.width); assert.equal(bytes.readUInt32BE(20), image.height);
    return bytes;
  };
  const pixels = async (image: VisualInspectionResult['images'][number], points: number[][]) => {
    browser ??= await launchExportBrowser();
    const page = await browser.newPage();
    try {
      return await page.evaluate(async ({ data, points }) => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
      }, { data: image.data, points });
    } finally { await page.close(); }
  };
  const evidence = async (name: string, result: VisualInspectionResult) => {
    if (!process.env.VISUAL_INSPECTION_EVIDENCE_DIR) return;
    const target = resolve(process.env.VISUAL_INSPECTION_EVIDENCE_DIR); await mkdir(target, { recursive: true });
    await writeFile(join(target, `${name}.png`), png(result.images[0]));
    await writeFile(join(target, `${name}.json`), JSON.stringify({ ...result, images: result.images.map(({ data: _data, ...image }) => image) }, null, 2));
  };
  try {
    for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(join('migrations', name), 'utf8'));
    const auth = await request('/api/auth/register', { email: 'inspection@studio.test', name: 'Inspection', password: 'Inspection-password-8391!' });
    assert.equal(auth.status, 201); cookie = auth.headers.get('set-cookie')!.split(';')[0];
    const empty = await inspect('/api/projects/inspect', {});
    assert.deepEqual(empty, { scope: 'workspace', source: 'saved', total: 0, offset: 0, nextOffset: null, items: [], images: [] });
    const doc = createDocument('video', 'Color and motion inspection'); doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
    doc.pages = [
      { id: 'red-page', name: 'Red motion', width: 320, height: 180, background: '#ffffff', nodes: [{ id: 'moving-red', name: 'Red square', type: 'shape', x: 0, y: 0, width: 40, height: 40, style: { fill: '#ff0000' } }] },
      { id: 'green-page', name: 'Green portrait', width: 180, height: 320, background: '#00ff00', nodes: [] },
      { id: 'blue-page', name: 'Blue square', width: 240, height: 240, background: '#0000ff', nodes: [] },
    ];
    doc.timeline = { duration: 2, fps: 30, tracks: [{ id: 'red-motion', nodeId: 'moving-red', keyframes: [{ time: 0, values: { x: 0 } }, { time: 2, values: { x: 200 } }] }] };
    const created = await request('/api/projects', { name: doc.name, kind: doc.kind, document: doc });
    assert.equal(created.status, 201, await created.clone().text());
    const project = (await created.json() as { project: Project }).project;
    const path = `/api/projects/${project.id}/inspect`;
    let green: VisualInspectionResult;

    await t.test('page ID and index choose the same saved pixels and dimensions', async () => {
      green = await inspect(path, { mode: 'page', pageId: 'green-page', expectedRevision: 1, maxDimension: 256 });
      const indexed = await inspect(path, { mode: 'page', pageIndex: 1, maxDimension: 256 });
      assert.deepEqual(indexed, green); png(green.images[0]);
      assert.equal(green.scope, 'page'); assert.equal(green.source, 'saved'); assert.equal(green.total, 3); assert.equal(green.offset, 1); assert.equal(green.nextOffset, null);
      assert.equal(green.images[0].width, 144); assert.equal(green.images[0].height, 256);
      assert.deepEqual(green.items[0], { projectId: project.id, projectName: doc.name, kind: 'video', revision: 1, pageId: 'green-page', pageIndex: 1, pageName: 'Green portrait', width: 180, height: 320, time: 0, imageIndex: 0, bounds: { x: 0, y: 0, width: 144, height: 256 } });
      assert.deepEqual(await pixels(green.images[0], [[72, 128]]), [[0, 255, 0, 255]]);
      await evidence('page-green', green);
    });
    await t.test('sample time changes actual node positions without changing saved revision', async () => {
      const start = await inspect(path, { mode: 'page', pageIndex: 0, time: 0 });
      const end = await inspect(path, { mode: 'page', pageIndex: 0, time: 2 });
      assert.deepEqual(await pixels(start.images[0], [[20, 20], [220, 20]]), [[255, 0, 0, 255], [255, 255, 255, 255]]);
      assert.deepEqual(await pixels(end.images[0], [[20, 20], [220, 20]]), [[255, 255, 255, 255], [255, 0, 0, 255]]);
      assert.equal(end.items[0].time, 2); assert.equal(end.items[0].revision, 1);
      assert.deepEqual((await (await request(`/api/projects/${project.id}`)).json() as { project: Project }).project.document, project.document);
    });
    await t.test('contact-sheet tiles map to actual page colors and expose the remaining pages', async () => {
      const first = await inspect(path, { mode: 'overview', limit: 2, columns: 2, tileSize: 160 });
      assert.equal(first.scope, 'project'); assert.equal(first.nextOffset, 2); assert.equal(first.total, 3);
      assert.deepEqual(first.items.map(item => item.pageId), ['red-page', 'green-page']);
      assert.equal(first.images[0].width, 320); assert.equal(first.images[0].height, 200); png(first.images[0]);
      const bounds = first.items[1].bounds;
      assert.deepEqual(await pixels(first.images[0], [[bounds.x + Math.floor(bounds.width / 2), bounds.y + Math.floor(bounds.height / 2)]]), [[0, 255, 0, 255]]);
      const last = await inspect(path, { offset: first.nextOffset, limit: 2, columns: 2, tileSize: 160 });
      assert.equal(last.nextOffset, null); assert.equal(last.offset, 2); assert.equal(last.items[0].pageId, 'blue-page');
      assert.equal(last.images[0].width, 160); assert.equal(last.images[0].height, 200);
      assert.deepEqual(await pixels(last.images[0], [[80, 80]]), [[0, 0, 255, 255]]);
      await evidence('project-contact-sheet', first);
    });
    await t.test('invalid selectors, stale revisions, missing renderer and ownership fail explicitly', async () => {
      for (const body of [{ mode: 'page', pageId: 'missing' }, { mode: 'page', pageIndex: 99 }, { mode: 'page', pageId: 'red-page', pageIndex: 0 }, { pageId: 'red-page' }, { offset: 3 }, { offset: -1 }, { limit: 13 }, { columns: 5 }, { maxDimension: 2049 }, { time: -1 }, { unknown: true }]) {
        const response = await request(path, body); assert.equal(response.status, 400, JSON.stringify(body));
      }
      const stale = await request(path, { expectedRevision: 2 }); assert.equal(stale.status, 409); assert.equal((await stale.json() as any).error.code, 'revision_conflict');
      const original = env.EXPORT_BROWSER; delete env.EXPORT_BROWSER;
      try { const response = await request(path, {}); assert.equal(response.status, 503); assert.equal((await response.json() as any).error.code, 'renderer_not_configured'); }
      finally { env.EXPORT_BROWSER = original; }
      const ownerCookie = cookie; cookie = '';
      assert.equal((await request(path, {})).status, 401); assert.equal((await request('/api/projects/inspect', {})).status, 401);
      const auth = await request('/api/auth/register', { email: 'stranger-inspection@studio.test', name: 'Stranger', password: 'Inspection-password-8391!' });
      assert.equal(auth.status, 201); cookie = auth.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await request(path, {})).status, 404); assert.equal((await inspect('/api/projects/inspect', {})).total, 0);
      cookie = ownerCookie;
    });
    await t.test('workspace covers are owner-scoped, deterministically ordered and paginated', async () => {
      const secondDoc = createDocument('web', 'Second saved design'); secondDoc.theme.fonts = { heading: 'Arial', body: 'Arial' };
      secondDoc.pages = [{ id: 'second-cover', name: 'Yellow cover', width: 256, height: 128, background: '#ffff00', nodes: [] }];
      const secondResponse = await request('/api/projects', { name: secondDoc.name, kind: secondDoc.kind, document: secondDoc }); assert.equal(secondResponse.status, 201);
      const second = (await secondResponse.json() as { project: Project }).project;
      const ids = [project.id, second.id].sort();
      const first = await inspect('/api/projects/inspect', { limit: 1, tileSize: 160 });
      const last = await inspect('/api/projects/inspect', { offset: first.nextOffset, limit: 1, tileSize: 160 });
      assert.equal(first.scope, 'workspace'); assert.equal(first.total, 2); assert.equal(first.nextOffset, 1); assert.equal(last.nextOffset, null);
      assert.deepEqual([first.items[0].projectId, last.items[0].projectId], ids);
      for (const result of [first, last]) { assert.equal(result.items[0].imageIndex, 0); assert.equal(result.items[0].pageIndex, 0); png(result.images[0]); assert.equal(Math.max(result.images[0].width, result.images[0].height), 160); }
      const exhausted = await inspect('/api/projects/inspect', { offset: 2 }); assert.deepEqual(exhausted.items, []); assert.deepEqual(exhausted.images, []); assert.equal(exhausted.nextOffset, null);
    });
    const issued = await request('/api/tokens', { name: 'Visual inspection clients' }); assert.equal(issued.status, 201);
    const token = (await issued.json() as { token: string }).token;
    await t.test('MCP sends actual image blocks and compact metadata without base64 duplication', async () => {
      const rpc = await app.request('https://studio.example/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'inspect_project', arguments: { projectId: project.id, mode: 'page', pageId: 'green-page', maxDimension: 256 } } }) }, env);
      assert.equal(rpc.status, 200, await rpc.clone().text());
      const result = (await rpc.json() as any).result; assert.equal(result.isError, undefined);
      assert.equal(result.content[0].type, 'text'); assert.equal(result.content[1].type, 'image'); assert.equal(result.content[1].mimeType, 'image/png');
      assert.deepEqual(Buffer.from(result.content[1].data, 'base64'), png(green!.images[0]));
      const metadata = JSON.parse(result.content[0].text); assert.equal(metadata.items[0].pageId, 'green-page'); assert.equal(metadata.images[0].data, undefined);
      assert.ok(!result.content[0].text.includes(result.content[1].data));
    });
    let baseUrl = '';
    server = serve({ fetch: req => new URL(req.url).pathname === '/inspection-test' ? new Response('<!doctype html><title>Inspection integration</title>', { headers: { 'Content-Type': 'text/html' } }) : app.fetch(req, { ...env, APP_URL: baseUrl }), hostname: '127.0.0.1', port: 0 });
    await new Promise<void>(resolveListening => { if (server!.listening) resolveListening(); else server!.once('listening', resolveListening); });
    const address = server.address(); assert.ok(address && typeof address !== 'string'); baseUrl = `http://127.0.0.1:${address.port}`;
    await t.test('WebMCP executes in Chromium with the real session, endpoint and image response', async () => {
      type Tool = Parameters<Parameters<typeof registerDesignTools>[0]['registerTool']>[0];
      const tools = new Map<string, Tool>(); const unregister = registerDesignTools({ registerTool: tool => tools.set(tool.name, tool), unregisterTool: name => { tools.delete(name); } }, () => doc, () => assert.fail('Inspection must not edit the open document'));
      const bundle = await build({ entryPoints: ['src/app/browser-visual-inspection-tools.ts'], bundle: true, format: 'iife', globalName: 'inspectionBrowser', write: false, platform: 'browser' });
      browser ??= await launchExportBrowser(); const context = await browser.newContext();
      const separator = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: baseUrl, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      try {
        const tool = tools.get('studio_api_post_projects_id_inspect'); assert.ok(tool); assert.equal(tool.annotations?.readOnlyHint, true);
        await page.goto(`${baseUrl}/inspection-test`); await page.addScriptTag({ content: bundle.outputFiles[0].text + `
          globalThis.executeInspection = async function(projectId, pageId) {
            const tools = new Map();
            const unregister = inspectionBrowser.registerVisualInspectionBrowserTools({ registerTool: tool => tools.set(tool.name, tool), unregisterTool: name => tools.delete(name) });
            try { return await tools.get('studio_api_post_projects_id_inspect').execute({ parameters: { id: projectId }, body: { mode: 'page', pageId, maxDimension: 256 } }); }
            finally { unregister(); if (tools.size) throw new Error('Browser tools were not unregistered'); }
          };` });
        const result = await page.evaluate(projectId => (globalThis as any).executeInspection(projectId, 'green-page'), project.id);
        assert.equal(result.content[1].type, 'image'); assert.equal(result.content[1].data, green!.images[0].data);
        assert.equal(JSON.parse(result.content[0].text).images[0].data, undefined);
        const invalid = await page.evaluate(projectId => (globalThis as any).executeInspection(projectId, 'missing'), project.id);
        assert.equal(invalid.isError, true); assert.equal(JSON.parse(invalid.content[0].text).error.code, 'invalid_page');
      } finally { await context.close(); unregister(); }
      assert.equal(tools.size, 0);
    });
    await t.test('CLI subprocesses write valid PNG files and machine-readable metadata', async () => {
      const run = async (args: string[]) => {
        const result = await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', 'projects', ...args], { windowsHide: true, timeout: 90000, env: { ...process.env, DESIGN_STUDIO_API_KEY: token, DESIGN_STUDIO_URL: baseUrl } });
        return JSON.parse(result.stdout);
      };
      const output = join(directory, 'inspection.png');
      const page = await run(['inspect', project.id, '--mode', 'page', '--page-id', 'green-page', '--revision', '1', '--max-dimension', '256', '--output', output]);
      assert.deepEqual(await readFile(output), png(green!.images[0])); assert.equal(page.images[0].path, output); assert.equal(page.images[0].data, undefined); assert.equal(page.items[0].revision, 1);
      const outputDir = join(directory, 'workspace'); const overview = await run(['overview', '--limit', '2', '--tile-size', '256', '--output-dir', outputDir]);
      assert.equal(overview.items.length, 2); assert.equal(overview.images.length, 2); assert.equal(overview.nextOffset, null);
      for (const [index, image] of overview.images.entries()) {
        const bytes = await readFile(image.path); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(bytes.readUInt32BE(16), image.width); assert.equal(bytes.readUInt32BE(20), image.height); assert.equal(image.data, undefined);
        assert.equal(overview.items[index].imageIndex, index); assert.equal(image.bytes, bytes.length);
      }
    });
  } finally {
    await browser?.close();
    if (server) await new Promise<void>(resolveClose => server!.close(() => resolveClose()));
    db.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith('studio-inspection-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('visual inspection handles render races, asset and pixel limits, DOM and 3D content', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-inspection-limits-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  let launches = 0, cookie = '';
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ASSETS: builtStaticAssets, APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret(), EXPORT_BROWSER: async () => { launches++; return launchExportBrowser(); } };
  const request = (path: string, body: unknown, method = 'POST') => app.request(`https://studio.example${path}`, { method, headers: { Cookie: cookie, Origin: 'https://studio.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  const create = async (doc: DesignDocument) => {
    doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
    const response = await request('/api/projects', { name: doc.name, kind: doc.kind, document: doc }); assert.equal(response.status, 201, await response.clone().text());
    return (await response.json() as { project: Project }).project;
  };
  try {
    for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(join('migrations', name), 'utf8'));
    const auth = await request('/api/auth/register', { email: 'inspection-limits@studio.test', name: 'Inspection limits', password: 'Inspection-password-8391!' }); assert.equal(auth.status, 201); cookie = auth.headers.get('set-cookie')!.split(';')[0];
    await t.test('external media and oversized canvases reject before launching a browser', async () => {
      const external = createDocument('slides', 'External image'); external.pages = [{ id: 'external-page', name: 'External', width: 320, height: 180, background: '#ffffff', nodes: [{ id: 'external-image', name: 'Import needed', type: 'image', x: 0, y: 0, width: 100, height: 100, src: 'https://example.com/image.png' }] }];
      const project = await create(external); const before = launches;
      const response = await request(`/api/projects/${project.id}/inspect`, {}); assert.equal(response.status, 400); assert.equal((await response.json() as any).error.code, 'import_asset_required');
      const huge = createDocument('slides', 'Pixel budget'); huge.pages = [{ id: 'huge-page', name: 'Oversized', width: 20000, height: 20000, background: '#ffffff', nodes: [] }];
      const oversized = await create(huge);
      const rejected = await request(`/api/projects/${oversized.id}/inspect`, { mode: 'page', maxDimension: 256 }); assert.equal(rejected.status, 413); assert.equal((await rejected.json() as any).error.code, 'render_budget_exceeded');
      assert.equal(launches, before, 'Asset and canvas validation must run before browser acquisition');
    });
    await t.test('an edit racing an actual render returns a revision conflict', async () => {
      const doc = createDocument('slides', 'Render race'); doc.pages = [{ id: 'race-page', name: 'Race', width: 320, height: 180, background: '#ffffff', nodes: [] }];
      const project = await create(doc), original = env.EXPORT_BROWSER;
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>(resolveGate => { release = resolveGate; });
      const rendering = new Promise<void>(resolveStarted => { started = resolveStarted; });
      env.EXPORT_BROWSER = async () => { const browser = await original!(); started(); await gate; return browser; };
      let pending: Promise<Response> | undefined;
      try {
        pending = Promise.resolve(request(`/api/projects/${project.id}/inspect`, { mode: 'page', expectedRevision: 1 }));
        await Promise.race([rendering, pending.then(async response => { throw new Error(`Render ended before browser acquisition: ${response.status} ${await response.clone().text()}`); })]);
        const changed = structuredClone(project.document); changed.pages[0].background = '#ff0000';
        const saved = await request(`/api/projects/${project.id}/document`, { document: changed, expectedRevision: 1 }, 'PUT'); assert.equal(saved.status, 200, await saved.clone().text());
        assert.equal((await saved.json() as { project: Project }).project.revision, 2);
        release(); const response = await pending; assert.equal(response.status, 409); assert.equal((await response.json() as any).error.code, 'revision_conflict');
      } finally { release(); if (pending) await pending; env.EXPORT_BROWSER = original; }
    });
    await t.test('structured DOM and 3D designs produce populated PNGs through the saved-project API', async () => {
      const dom = createDocument('web', 'Structured controls');
      assert.ok(dom.pages[0].nodes.some(node => node.component || node.layout));
      const scene = createDocument('3d', 'Red 3D cube');
      scene.pages = [{ id: 'cube-page', name: 'Cube', width: 400, height: 400, background: '#ffffff', nodes: [{ id: 'red-cube', type: 'model3d', name: 'Red cube', x: 0, y: 0, width: 400, height: 400, data: { geometry: 'box', color: '#ff0000', metalness: 0, roughness: 1 } }] }];
      const decoder = await launchExportBrowser();
      try {
        for (const doc of [dom, scene]) {
          const project = await create(doc); const response = await request(`/api/projects/${project.id}/inspect`, { mode: 'page', maxDimension: 400 });
          assert.equal(response.status, 200, await response.clone().text()); const result = await response.json() as VisualInspectionResult;
          const bytes = Buffer.from(result.images[0].data, 'base64'); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          const page = await decoder.newPage();
          try {
            const stats = await page.evaluate(async data => {
              const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
              const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
              const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, image.width, image.height).data;
              let red = 0; const colors = new Set<string>();
              for (let index = 0; index < pixels.length; index += 4) { if (pixels[index] > 100 && pixels[index] > pixels[index + 1] * 1.5 && pixels[index] > pixels[index + 2] * 1.5) red++; colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`); }
              return { red, colors: colors.size };
            }, result.images[0].data);
            if (doc.kind === '3d') assert.ok(stats.red > 1000, `The real cube must occupy visible red pixels: ${JSON.stringify(stats)}`);
            else assert.ok(stats.colors > 100, `Rendered controls and text must contain detailed pixels: ${JSON.stringify(stats)}`);
          } finally { await page.close(); }
          if (process.env.VISUAL_INSPECTION_EVIDENCE_DIR) await writeFile(join(resolve(process.env.VISUAL_INSPECTION_EVIDENCE_DIR), `inspection-${doc.kind}.png`), bytes);
        }
      } finally { await decoder.close(); }
    });
  } finally { db.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith('studio-inspection-limits-')); await rm(directory, { recursive: true, force: true }); }
});
