import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase, staticAssets } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';
import type { DesignDocument, Project, AssetRef } from '../src/shared/schema';

test('OAuth, asset lifetime and isolated renderer security boundaries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-security-'));
  const db = new SqliteDatabase(':memory:');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, bearer?: string, asCookie = cookie) => app.request(`https://studio.example${path}`, {
    method, headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : { Cookie: asCookie }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const form = (path: string, body: Record<string, string>, sessionCookie = '', bearer?: string) => app.request(`https://studio.example${path}`, {
    method: 'POST', headers: { Origin: 'https://studio.example', ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: new URLSearchParams(body),
  }, env);
  const create = async (document?: DesignDocument) => {
    const response = await request('/api/projects', 'POST', { name: document?.name ?? 'Security review', kind: document?.kind ?? 'web', document });
    assert.equal(response.status, 201);
    return (await response.json() as { project: Project }).project;
  };
  const upload = async (project: Project, bytes: Uint8Array, name: string, type: string) => {
    const body = new FormData(); body.set('file', new File([new Uint8Array(bytes)], name, { type }));
    const response = await app.request(`https://studio.example/api/projects/${project.id}/assets`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://studio.example' }, body }, env);
    assert.equal(response.status, 201);
    return (await response.json() as { asset: AssetRef }).asset;
  };
  const save = async (project: Project) => {
    const response = await request(`/api/projects/${project.id}/document`, 'PUT', { document: project.document, expectedRevision: project.revision });
    assert.equal(response.status, 200);
    return (await response.json() as { project: Project }).project;
  };
  try {
    const registration = await request('/api/auth/register', 'POST', { email: 'security@example.com', password: 'Security regression password' });
    assert.equal(registration.status, 201); cookie = registration.headers.get('set-cookie')!.split(';')[0];

    await t.test('OAuth consent cannot be bypassed or converted into permanent credentials', async () => {
      const client = await (await request('/oauth/register', 'POST', { redirect_uris: ['http://127.0.0.1/callback'] })).json() as { client_id: string };
      const verifier = secret() + 'abc';
      const authorization = { client_id: client.client_id, redirect_uri: 'http://127.0.0.1/callback', response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256', resource: 'https://studio.example/mcp', scope: 'studio' };
      const consent = await form('/oauth/authorize', { ...authorization, decision: 'allow' }, cookie);
      assert.equal(consent.status, 302);
      const code = new URL(consent.headers.get('location')!).searchParams.get('code')!;
      const issuedResponse = await form('/oauth/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: authorization.redirect_uri, code, code_verifier: verifier, resource: authorization.resource });
      assert.equal(issuedResponse.status, 200);
      const issued = await issuedResponse.json() as { access_token: string; refresh_token: string };
      assert.equal((await request('/api/projects', 'GET', undefined, issued.access_token)).status, 200);
      for (const path of ['/api/tokens', '/api/tokens/']) {
        assert.equal((await request(path, 'POST', { name: 'Permanent access' }, issued.access_token)).status, 403);
        assert.equal((await request(path, 'GET', undefined, issued.access_token)).status, 403);
      }
      assert.equal((await request('/api/providers/openai', 'PUT', { apiKey: 'test-not-a-real-provider-key' }, issued.access_token)).status, 403);
      assert.equal((await request('/api/providers/openai', 'DELETE', undefined, issued.access_token)).status, 403);
      assert.equal((await form('/oauth/authorize', { ...authorization, decision: 'allow' }, cookie, issued.access_token)).status, 403);
      assert.equal((await db.prepare('SELECT count(*) AS count FROM api_tokens').first<{ count: number }>())!.count, 0);
      assert.equal((await form('/oauth/revoke', { token: issued.refresh_token, client_id: client.client_id })).status, 200);
      assert.equal((await request('/api/projects', 'GET', undefined, issued.access_token)).status, 401);
    });

    await t.test('duplicating a project copies referenced media and preserves its published snapshot', async () => {
      let original = await create();
      const asset = await upload(original, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTzQAAAAASUVORK5CYII=', 'base64'), 'pixel.png', 'image/png');
      original.document.assets.push(asset);
      original.document.pages[0].nodes.push({ id: 'pixel-node', type: 'image', name: 'Pixel', x: 0, y: 0, width: 10, height: 10, src: asset.url });
      original = await save(original);
      const copy = await create(original.document);
      const copyAsset = copy.document.pages[0].nodes.find(n => n.id === 'pixel-node')!.src!;
      assert.notEqual(copyAsset, asset.url);
      assert.equal(copy.document.assets[0].url, copyAsset);
      const snapshotResponse = await request(`/api/projects/${copy.id}/publish`, 'POST');
      assert.equal(snapshotResponse.status, 200);
      const snapshot = new URL((await snapshotResponse.json() as { url: string }).url).pathname;
      const publishedAsset = `${snapshot}/assets/${copyAsset.split('/').pop()}`;
      const before = Buffer.from(await (await request(copyAsset)).arrayBuffer());
      assert.equal((await request(`/api/projects/${original.id}`, 'DELETE')).status, 200);
      assert.equal((await request(asset.url)).status, 404);
      const retained = await request(copyAsset); assert.equal(retained.status, 200);
      assert.deepEqual(Buffer.from(await retained.arrayBuffer()), before);
      assert.equal((await request(publishedAsset, 'GET', undefined, undefined, '')).status, 200);
      await save(copy);
    });

    await t.test('cloud exports reject oversized objects and external media before browser launch', async () => {
      const doc = createDocument('3d', 'Bounds'); doc.pages[0].width = 100; doc.pages[0].height = 100;
      doc.pages[0].nodes = [{ id: 'large-model', type: 'model3d', name: 'Large object', x: 0, y: 0, width: 20000, height: 20000 }];
      const oversized = await create(doc);
      const blocked = await request(`/api/projects/${oversized.id}/export`, 'POST', { format: 'png' });
      assert.equal(blocked.status, 413);
      assert.equal((await blocked.json() as { error: { code: string } }).error.code, 'render_budget_exceeded');
      doc.pages[0].nodes = [{ id: 'remote-image', type: 'image', name: 'Remote', x: 0, y: 0, width: 10, height: 10, src: 'https://127.0.0.1/private.png' }];
      const remote = await create(doc);
      const denied = await request(`/api/projects/${remote.id}/export`, 'POST', { format: 'png' });
      assert.equal(denied.status, 400);
      assert.equal((await denied.json() as { error: { code: string } }).error.code, 'import_asset_required');
    });

    await t.test('uploaded GLB external buffers cannot reach the renderer host network', async () => {
      // This controlled listener measures a real browser request, without contacting another service.
      let requests = 0;
      const server = createServer((_request, response) => { requests++; response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' }); response.end(Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)); });
      await new Promise<void>((ready, reject) => { server.once('error', reject); server.listen(17889, '127.0.0.1', ready); });
      try {
        const output = join(directory, 'renderer', 'studio-renderer.js');
        await build({ entryPoints: [new URL('../scripts/export-renderer.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], outfile: output, bundle: true, format: 'iife', platform: 'browser', logLevel: 'silent' });
        env.ASSETS = staticAssets(join(directory, 'renderer'));
        env.EXPORT_BROWSER = () => chromium.launch({ headless: true });
        const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36, uri: 'http://127.0.0.1:17889/internal-buffer' }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] };
        const json = Buffer.from(JSON.stringify(gltf)); const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
        const glb = Buffer.alloc(20 + padded.length); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
        let project = await create(createDocument('3d', 'External buffer'));
        const asset = await upload(project, glb, 'external.glb', 'model/gltf-binary');
        project.document.pages[0].nodes = [{ id: 'network-model', type: 'model3d', name: 'Network model', x: 0, y: 0, width: 100, height: 100, src: asset.url }];
        project = await save(project);
        const response = await request(`/api/projects/${project.id}/export`, 'POST', { format: 'png' });
        assert.equal(response.status, 502);
        assert.equal((await response.json() as { error: { code: string } }).error.code, 'render_failed');
        assert.equal(requests, 0, 'Embedded GLB URIs must not reach loopback services');
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  } finally {
    db.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'studio-security-'));
    await rm(directory, { recursive: true, force: true });
  }
});
