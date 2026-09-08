import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import JSZip from 'jszip';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument } from '../src/shared/schema';
import type { Bindings } from '../server/types';
import { builtStaticAssets } from './built-static-assets';
import { embeddedDocumentFonts } from '../server/exports';

test('cloud font loading skips local fonts and rejects redirects, foreign hosts and oversized stylesheets', async t => {
  const doc = createDocument('web', 'Font transport');
  const addresses: string[] = [];
  let response = new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => { addresses.push(input); assert.equal(options.redirect, 'manual'); assert.ok(options.signal); return response; });
  doc.theme.fonts = { heading: 'Arial', body: 'Georgia' };
  assert.equal(await embeddedDocumentFonts(doc), null); assert.equal(addresses.length, 0);
  doc.theme.fonts.heading = 'Roboto';
  await assert.rejects(embeddedDocumentFonts(doc), { code: 'font_load_failed' });
  assert.equal(addresses.length, 1); assert.ok(addresses[0].startsWith('https://fonts.googleapis.com/css2?'));
  response = new Response('@font-face { font-family: Roboto; src: url(https://attacker.example/private.woff2); }');
  await assert.rejects(embeddedDocumentFonts(doc), { code: 'font_load_failed' }); assert.equal(addresses.length, 2);
  response = new Response('x'.repeat(128 * 1024 + 1));
  await assert.rejects(embeddedDocumentFonts(doc), { code: 'font_load_failed' }); assert.equal(addresses.length, 3);
});

test('authenticated React and scene exports preserve assets, animation, ownership and revisions', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-agent-exports-')), database = new SqliteDatabase(':memory:');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const bindings: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ASSETS: builtStaticAssets, APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret(), EXPORT_BROWSER: () => chromium.launch({ headless: true }) };
  let cookie = '', token = '';
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => app.request(`https://studio.example${path}`, { method, headers: { Origin: 'https://studio.example', ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(authenticated ? token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) }, bindings);
  const create = async (document: DesignDocument) => {
    const response = await request('/api/projects', 'POST', { name: document.name, kind: document.kind, document });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json() as { project: { id: string; revision: number; document: DesignDocument } }).project;
  };
  const exportFile = (id: string, format: string, expectedRevision = 2) => request(`/api/projects/${id}/export`, 'POST', { format, expectedRevision });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const upload = async (id: string) => {
    const form = new FormData(); form.set('file', new File([png], 'pixel.png', { type: 'image/png' }));
    const response = await request(`/api/projects/${id}/assets`, 'POST', form); assert.equal(response.status, 201);
    return (await response.json() as { asset: DesignDocument['assets'][number] }).asset;
  };
  const save = async (project: Awaited<ReturnType<typeof create>>) => {
    const response = await request(`/api/projects/${project.id}/document`, 'PUT', { document: project.document, expectedRevision: project.revision });
    assert.equal(response.status, 200, await response.clone().text());
  };
  let loaderBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const registration = await request('/api/auth/register', 'POST', { email: 'export-owner@example.com', password: 'Export route regression password' });
    assert.equal(registration.status, 201); cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const createdToken = await request('/api/tokens', 'POST', { name: 'Export regression' }); assert.equal(createdToken.status, 201);
    token = (await createdToken.json() as { token: string }).token;
    const web = await create(createDocument('web', 'Portable interface'));
    web.document.assets.push(await upload(web.id)); await save(web);
    const archiveResponse = await exportFile(web.id, 'react'); assert.equal(archiveResponse.status, 200, await archiveResponse.clone().text());
    assert.equal(archiveResponse.headers.get('content-type'), 'application/zip'); assert.match(archiveResponse.headers.get('content-disposition')!, /\.zip"$/);
    const zip = await JSZip.loadAsync(await archiveResponse.arrayBuffer());
    assert.ok(zip.file('src/app/design-component.tsx')); assert.ok(zip.file('src/main.tsx'));
    assert.deepEqual(Buffer.from(await zip.file('public/assets/media-1.png')!.async('uint8array')), png);
    assert.equal(JSON.parse(await zip.file('document.json')!.async('string')).assets[0].url, '/assets/media-1.png');
    const scene = await create(createDocument('3d', 'Textured animation'));
    const asset = await upload(scene.id); scene.document.assets.push(asset);
    const node = scene.document.pages[0].nodes.find(n => n.type === 'model3d')!;
    node.scene = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material: { color: '#ff0000', roughness: .7, metalness: .3, textureAssetId: asset.id } };
    scene.document.timeline = { duration: 1, fps: 24, tracks: [{ id: 'rotation', nodeId: node.id, keyframes: [{ time: 0, values: { 'scene.rotation.y': 0 } }, { time: 1, values: { 'scene.rotation.y': 90 } }] }] };
    await save(scene);
    const loader = await build({ stdin: { contents: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; import { AnimationMixer } from 'three'; globalThis.loadExport = async (values, binary) => { const bytes = new Uint8Array(values); const loaded = await new GLTFLoader().parseAsync(binary ? bytes.buffer : new TextDecoder().decode(bytes), ''); const mixer = new AnimationMixer(loaded.scene); mixer.clipAction(loaded.animations[0]).play(); mixer.setTime(.5); let mesh; loaded.scene.traverse(n => { if (n.isMesh) mesh = n; }); return { meshes: !!mesh, texture: !!mesh.material.map, roughness: mesh.material.roughness, color: mesh.material.color.getHexString(), clips: loaded.animations.length, rotation: mesh.rotation.y }; };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
    loaderBrowser = await chromium.launch({ headless: true }); const page = await loaderBrowser.newPage(); await page.addScriptTag({ content: loader.outputFiles[0].text });
    for (const format of ['glb', 'gltf']) {
      const response = await exportFile(scene.id, format); assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'private,no-store');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (format === 'glb') { assert.equal(bytes.subarray(0, 4).toString(), 'glTF'); assert.equal(bytes.readUInt32LE(8), bytes.length); }
      else assert.ok(JSON.parse(bytes.toString()).buffers[0].uri.startsWith('data:'));
      const result = await page.evaluate(({ bytes, binary }) => (globalThis as any).loadExport(bytes, binary), { bytes: [...bytes], binary: format === 'glb' });
      assert.equal(result.meshes, true); assert.equal(result.texture, true); assert.equal(result.color, 'ff0000'); assert.equal(result.clips, 1);
      assert.ok(Math.abs(result.roughness - .7) < .00001); assert.ok(Math.abs(result.rotation - Math.PI / 4) < .00001);
    }
    for (const format of ['react', 'glb', 'gltf']) {
      const projectId = format === 'react' ? web.id : scene.id;
      const response = await app.request('https://studio.example/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'export_project', arguments: { projectId, format, expectedRevision: 2 } } }) }, bindings);
      assert.equal(response.status, 200);
      const message = await response.json() as any; assert.ok(!message.error && !message.result.isError, JSON.stringify(message));
      const resource = message.result.content[0].resource, bytes = Buffer.from(resource.blob, 'base64');
      if (format === 'react') { assert.match(resource.uri, /\.zip$/); assert.ok((await JSZip.loadAsync(bytes)).file('src/main.tsx')); }
      else if (format === 'glb') assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
      else assert.ok(JSON.parse(bytes.toString()).meshes.length);
    }
    const server = serve({ fetch: request => app.fetch(request, bindings), hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const apiUrl = `http://127.0.0.1:${address.port}`;
    try {
      for (const format of ['react', 'glb', 'gltf']) {
        const file = join(directory, `cli-export.${format === 'react' ? 'zip' : format}`);
        await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', 'projects', 'export', format === 'react' ? web.id : scene.id, '--format', format, '--revision', '2', '--output', file], { env: { ...process.env, DESIGN_STUDIO_API_KEY: token, DESIGN_STUDIO_URL: apiUrl }, timeout: 30000 });
        const bytes = await readFile(file);
        if (format === 'react') assert.ok((await JSZip.loadAsync(bytes)).file('src/main.tsx'));
        else if (format === 'glb') assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
        else assert.ok(JSON.parse(bytes.toString()).meshes.length);
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    assert.equal((await exportFile(scene.id, 'glb', 1)).status, 409);
    assert.equal((await exportFile(scene.id, 'react')).status, 400);
    assert.equal((await exportFile(web.id, 'glb')).status, 400);
    assert.equal((await request(`/api/projects/${scene.id}/export`, 'POST', { format: 'glb' }, false)).status, 401);
    token = ''; cookie = '';
    const other = await request('/api/auth/register', 'POST', { email: 'export-other@example.com', password: 'Other export regression password' }); assert.equal(other.status, 201); cookie = other.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await exportFile(scene.id, 'glb')).status, 404);
    assert.equal((await exportFile(web.id, 'react')).status, 404);
  } finally { await loaderBrowser?.close(); database.close(); await rm(directory, { recursive: true, force: true }); }
});
