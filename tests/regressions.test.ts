import { builtStaticAssets } from './built-static-assets';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';
import type { AssetRef, Project } from '../src/shared/schema';

test('design lifecycle and delegated authorization regressions with real storage', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-regressions-'));
  const db = new SqliteDatabase(join(dir, 'studio.sqlite'));
  const base = 'https://studio.example';
  const env: Bindings = { ASSETS: builtStaticAssets, DB: db, ASSETS_BUCKET: new FileBucket(join(dir, 'assets')), APP_URL: base, ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, bearer?: string, anonymous = false) => app.request(base + path, {
    method,
    headers: { Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(bearer ? { Authorization: `Bearer ${bearer}` } : cookie && !anonymous ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const form = (path: string, values: Record<string, string>, authenticated = false) => app.request(base + path, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded', ...(authenticated ? { Cookie: cookie } : {}) }, body: new URLSearchParams(values),
  }, env);
  const create = async (body: unknown) => {
    const response = await request('/api/projects', 'POST', body);
    assert.equal(response.status, 201);
    return ((await response.json()) as { project: Project }).project;
  };
  try {
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    const registered = await request('/api/auth/register', 'POST', { email: `regression-${crypto.randomUUID()}@studio.test`, password: secret(), name: 'Regression tester' });
    assert.equal(registered.status, 201);
    cookie = registered.headers.get('set-cookie')!.split(';')[0];

    await t.test('duplicate owns copied media after original deletion and publishes independently', async () => {
      const original = await create({ name: 'Original with media', kind: 'web' });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
      const uploadBody = new FormData();
      uploadBody.set('file', new File([png], 'pixel.png', { type: 'image/png' }));
      const uploaded = await app.request(`${base}/api/projects/${original.id}/assets`, { method: 'POST', headers: { Origin: base, Cookie: cookie }, body: uploadBody }, env);
      assert.equal(uploaded.status, 201);
      const asset = ((await uploaded.json()) as { asset: AssetRef }).asset;
      original.document.assets.push(asset);
      original.document.pages[0].nodes.push({ id: 'uploaded-image', name: 'Uploaded image', type: 'image', x: 1, y: 1, width: 10, height: 10, src: asset.url });
      const saved = await request(`/api/projects/${original.id}/document`, 'PUT', { document: original.document, expectedRevision: original.revision });
      assert.equal(saved.status, 200);
      const copied = await create({ name: 'Independent copy', kind: original.kind, document: original.document });
      const copiedAsset = copied.document.assets[0];
      assert.notEqual(copiedAsset.id, asset.id);
      assert.notEqual(copiedAsset.url, asset.url);
      assert.equal(copied.document.pages[0].nodes.find(n => n.id === 'uploaded-image')?.src, copiedAsset.url);
      assert.equal((await request(`/api/projects/${original.id}`, 'DELETE')).status, 200);
      assert.equal((await request(asset.url)).status, 404);
      const bytes = await request(copiedAsset.url);
      assert.equal(bytes.status, 200);
      assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), png);
      const copiedSave = await request(`/api/projects/${copied.id}/document`, 'PUT', { document: copied.document, expectedRevision: copied.revision });
      assert.equal(copiedSave.status, 200);
      const publication = await request(`/api/projects/${copied.id}/publish`, 'POST');
      assert.equal(publication.status, 200);
      const publicPath = new URL(((await publication.json()) as { url: string }).url).pathname;
      const published = await request(publicPath, 'GET', undefined, undefined, true);
      assert.equal(published.status, 200);
      assert.match(await published.text(), new RegExp(`${publicPath}/assets/${copiedAsset.id}`));
      const publicAsset = await request(`${publicPath}/assets/${copiedAsset.id}`, 'GET', undefined, undefined, true);
      assert.equal(publicAsset.status, 200);
      assert.deepEqual(Buffer.from(await publicAsset.arrayBuffer()), png);
      assert.equal((await request(copiedAsset.url, 'GET', undefined, undefined, true)).status, 401);
    });

    await t.test('OAuth design access cannot create permanent credentials or manage providers', async () => {
      const clientResponse = await request('/oauth/register', 'POST', { client_name: 'Design integration', redirect_uris: ['http://127.0.0.1:4321/callback'] });
      assert.equal(clientResponse.status, 201);
      const client = (await clientResponse.json()) as { client_id: string };
      const verifier = secret() + 'abc';
      const params = { client_id: client.client_id, redirect_uri: 'http://127.0.0.1:4321/callback', response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256', state: secret(), resource: `${base}/mcp`, scope: 'studio' };
      const allowed = await form('/oauth/authorize', { ...params, decision: 'allow' }, true);
      assert.equal(allowed.status, 302);
      const code = new URL(allowed.headers.get('location')!).searchParams.get('code')!;
      const issued = await form('/oauth/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: params.redirect_uri, resource: params.resource, code, code_verifier: verifier });
      assert.equal(issued.status, 200);
      const token = ((await issued.json()) as { access_token: string }).access_token;
      assert.equal((await request('/api/projects', 'GET', undefined, token)).status, 200);
      const design = await request('/api/projects', 'POST', { name: 'Delegated design' }, token);
      assert.equal(design.status, 201);
      const project = ((await design.json()) as { project: Project }).project;
      project.document.name = 'Edited by delegated client';
      assert.equal((await request(`/api/projects/${project.id}/document`, 'PUT', { document: project.document, expectedRevision: project.revision }, token)).status, 200);
      for (const [path, method, body] of [
        ['/api/tokens', 'GET', undefined], ['/api/tokens', 'POST', { name: 'Permanent credential' }], ['/api/tokens/missing', 'DELETE', undefined],
        ['/api/providers', 'GET', undefined], ['/api/providers/openai', 'PUT', { apiKey: secret() }], ['/api/providers/openai', 'DELETE', undefined],
      ] as const) {
        const response = await request(path, method, body, token);
        assert.equal(response.status, 403, `${method} ${path} must reject delegated credentials`);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'insufficient_scope');
      }
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM api_tokens').first<{ count: number }>())?.count, 0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM providers').first<{ count: number }>())?.count, 0);
      assert.equal((await request('/api/providers')).status, 200);
      assert.equal((await request('/api/tokens')).status, 200);
    });

    await t.test('excessive canvas, object and cumulative render dimensions reject before needing a browser', async () => {
      const oversizedCanvas = createDocument('web', 'Oversized canvas');
      oversizedCanvas.pages[0].width = 20000; oversizedCanvas.pages[0].height = 20000;
      const oversizedObject = createDocument('3d', 'Oversized object');
      oversizedObject.pages[0].nodes[0].width = 5000; oversizedObject.pages[0].nodes[0].height = 5000;
      const cumulative = createDocument('slides', 'Cumulative render');
      cumulative.pages = Array.from({ length: 5 }, (_, index) => ({ id: `budget-page-${index}`, name: `Page ${index + 1}`, width: 4000, height: 4000, background: '#ffffff', nodes: [] }));
      for (const [document, format] of [[oversizedCanvas, 'png'], [oversizedObject, 'png'], [cumulative, 'pdf']] as const) {
        const project = await create({ name: document.name, kind: document.kind, document });
        const response = await request(`/api/projects/${project.id}/export`, 'POST', { format, expectedRevision: project.revision });
        assert.equal(response.status, 413, document.name);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'render_budget_exceeded');
        assert.equal((await request(`/api/projects/${project.id}/export`, 'POST', { format: 'json' })).status, 200);
      }
    });
  } finally {
    db.close();
    const resolved = join(tmpdir(), dir.split(/[\\/]/).pop()!);
    assert.equal(resolved, dir);
    assert.ok(dir.split(/[\\/]/).pop()!.startsWith('studio-regressions-'));
    await rm(dir, { recursive: true, force: true });
  }
});
