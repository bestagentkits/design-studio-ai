import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DiscoveryCache, discoveryRoutes, filterFontCatalog, filterModelCatalog, modelDiscoveryRequest, parseGoogleFonts, parseModelPage } from '../server/discovery';
import { ApiError, authenticate, encrypt, hash, secret } from '../server/security';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import type { Env, Bindings } from '../server/types';
import { fallbackFonts, fallbackModels, type FontCatalog, type ModelCatalog } from '../src/shared/discovery';
import { documentFontFamilies, googleFontsStylesheetUrl, googleFontFamily } from '../src/shared/font-loading';
import { createDocument } from '../src/shared/catalog';

test('official discovery request origins and authentication are fixed', () => {
  const key = 'synthetic-test-key';
  const cases = [
    ['openai', 'https://api.openai.com', 'Authorization', `Bearer ${key}`],
    ['anthropic', 'https://api.anthropic.com', 'x-api-key', key],
    ['gemini', 'https://generativelanguage.googleapis.com', 'x-goog-api-key', key],
    ['openrouter', 'https://openrouter.ai', 'Authorization', `Bearer ${key}`],
    ['fal', 'https://api.fal.ai', 'Authorization', `Key ${key}`],
  ] as const;
  for (const [provider, origin, header, expected] of cases) {
    const request = modelDiscoveryRequest(provider, key, 'https://attacker.example/?key=leak');
    assert.equal(new URL(request.url).origin, origin);
    assert.equal(request.init.redirect, 'manual');
    assert.equal(request.init.headers[header], expected);
    assert.equal(request.url.includes(key), false);
  }
});

test('official model response shapes retain IDs and safely discard unrelated fields', () => {
  assert.deepEqual(parseModelPage('openai', { data: [{ id: 'gpt-4.1', owned_by: 'openai', secret: 'never-return' }] }).models, [{ id: 'gpt-4.1', name: 'gpt-4.1' }]);
  const anthropic = parseModelPage('anthropic', { data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }], has_more: true, last_id: 'last' });
  assert.equal(anthropic.cursor, 'last'); assert.equal(anthropic.models[0].name, 'Claude Sonnet 4');
  assert.deepEqual(parseModelPage('gemini', { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }), { models: [{ id: 'gemini-2.5-flash', name: 'Gemini Flash' }], cursor: 'next' });
  assert.equal(parseModelPage('openrouter', { data: [{ id: 'openai/gpt-4.1', name: 'OpenAI: GPT-4.1' }] }).models[0].id, 'openai/gpt-4.1');
  assert.deepEqual(parseModelPage('fal', { models: [{ endpoint_id: 'fal-ai/flux/dev', metadata: { display_name: 'FLUX.1 [dev]', category: 'text-to-image' } }], has_more: true, next_cursor: 'Mg==' }), { models: [{ id: 'fal-ai/flux/dev', name: 'FLUX.1 [dev]', category: 'text-to-image' }], cursor: 'Mg==' });
  assert.throws(() => parseModelPage('openai', { error: 'Unauthorized' }));
  assert.equal(parseModelPage('openai', { data: [{ id: 'x'.repeat(201) }, { id: 42 }] }).models.length, 0);
});

test('catalog cache enforces expiry, credential separation, and capacity', () => {
  const cache = new DiscoveryCache<number>(10, 2);
  cache.set('owner-a:credential-1', 1, 0); cache.set('owner-b:credential-2', 2, 0);
  assert.equal(cache.get('owner-a:credential-2', 1), undefined);
  assert.equal(cache.get('owner-a:credential-1', 9), 1);
  cache.set('owner-a:credential-3', 3, 2);
  assert.equal(cache.get('owner-a:credential-1', 3), undefined);
  assert.equal(cache.get('owner-b:credential-2', 10), undefined);
});

test('catalog filtering preserves live, cached, and fallback metadata without shrinking stored catalogs', () => {
  for (const source of ['live', 'cache', 'fallback'] as const) {
    const models: ModelCatalog = { source, message: 'Catalog status', truncated: true, fetchedAt: '2026-09-08T10:00:00.000Z', models: [{ id: 'fal-ai/flux/dev', name: 'FLUX.1 [dev]', category: 'text-to-image' }, { id: 'private-custom', name: 'Private model', category: 'text' }] };
    for (const query of ['FLUX', 'flux.1', 'TEXT-TO-IMAGE']) assert.deepEqual(filterModelCatalog(models, query), { ...models, models: [models.models[0]] });
    assert.equal(filterModelCatalog(models, 'no-match').models.length, 0);
    assert.equal(filterModelCatalog(models, '   ').models.length, 2);
    assert.equal(models.models.length, 2);
    const fonts: FontCatalog = { ...fallbackFonts(), source, message: 'Catalog status' };
    assert.deepEqual(filterFontCatalog(fonts, ' ROBOTO ').fonts.map(font => font.family), ['Roboto', 'Roboto Mono']);
    assert.ok(filterFontCatalog(fonts, 'MONOSPACE').fonts.every(font => font.category === 'monospace'));
    assert.equal(filterFontCatalog(fonts, 'Roboto').source, source);
    assert.equal(filterFontCatalog(fonts, 'Roboto').message, fonts.message);
    assert.ok(fonts.fonts.length > 20);
  }
});

test('Google Fonts parsing and CSS URLs support document fonts without injection', () => {
  assert.deepEqual(parseGoogleFonts({ items: [{ family: 'Roboto', category: 'sans-serif', variants: ['regular', '700'], files: { regular: 'http://not-returned' } }] }), [{ family: 'Roboto', category: 'sans-serif', variants: ['regular', '700'] }]);
  const doc = createDocument('web');
  doc.theme.fonts = { heading: 'Playfair Display', body: 'Inter' };
  doc.pages[0].nodes[0].style = { fontFamily: 'Roboto Mono' };
  assert.deepEqual(documentFontFamilies(doc), ['Inter', 'Playfair Display', 'Roboto Mono']);
  assert.equal(googleFontsStylesheetUrl(['Inter', 'Inter', 'Arial', 'Playfair Display']), 'https://fonts.googleapis.com/css2?family=Inter&family=Playfair+Display&display=swap');
  assert.equal(googleFontFamily('"Inter", sans-serif'), 'Inter');
  assert.equal(googleFontsStylesheetUrl(['Arial', 'system-ui', 'x;url(https://attacker.example)']), null);
  assert.equal(fallbackFonts().source, 'fallback'); assert.equal(fallbackModels('openai').source, 'fallback');
});

test('authenticated discovery preserves account and OAuth boundaries without external calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-discovery-'));
  const db = new SqliteDatabase(':memory:');
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example', PROVIDER_ALLOWED_ORIGINS: 'https://proxy.example' };
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { await authenticate(c); await next(); });
  app.onError((error, c) => c.json({ error: error instanceof ApiError ? error.code : 'internal' }, (error instanceof ApiError ? error.status : 500) as ContentfulStatusCode));
  app.route('/api', discoveryRoutes);
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    for (const user of ['a', 'b']) {
      await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(user, `${user}@example.test`, user, 'unused', new Date().toISOString()).run();
      await db.prepare('INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)').bind(user, user, user, await hash(`token-${user}`), new Date().toISOString()).run();
    }
    await db.prepare('INSERT INTO providers(user_id,provider,encrypted_key,base_url,model) VALUES(?,?,?,?,?)').bind('a', 'openai', await encrypt(env, 'synthetic-provider-key'), 'https://proxy.example/v1', 'private-custom-model').run();
    await db.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)').bind('client', 'Test', '[]', new Date().toISOString()).run();
    await db.prepare('INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)').bind(await hash('oauth-test'), 'a', 'client', 'https://studio.example/mcp', 'access', Date.now() + 60000, 'family').run();
    const request = (path: string, token?: string) => app.request(`https://studio.example/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);
    assert.equal((await request('/fonts')).status, 401);
    assert.equal((await request('/providers/openai/models', 'oauth-test')).status, 403);
    assert.equal((await request('/providers/unknown/models', 'token-a')).status, 400);
    const own = await (await request('/providers/openai/models', 'token-a')).json() as ModelCatalog;
    assert.equal(own.source, 'fallback'); assert.match(own.message, /Custom endpoint/);
    assert.ok(own.models.some(model => model.id === 'private-custom-model'));
    const other = await (await request('/providers/openai/models', 'token-b')).json() as ModelCatalog;
    assert.equal(other.source, 'fallback'); assert.ok(!other.models.some(model => model.id === 'private-custom-model'));
    assert.equal(JSON.stringify(own).includes('synthetic-provider-key'), false);
    const fonts = await (await request('/fonts', 'token-a')).json() as FontCatalog;
    assert.equal(fonts.source, 'fallback'); assert.ok(fonts.fonts.length > 20);
    const filteredFonts = await (await request('/fonts?q=Roboto', 'token-a')).json() as FontCatalog;
    assert.deepEqual(filteredFonts.fonts.map(font => font.family), ['Roboto', 'Roboto Mono']);
    assert.equal(filteredFonts.source, fonts.source); assert.equal(filteredFonts.message, fonts.message);
    const filteredOwn = await (await request('/providers/openai/models?q=PRIVATE-custom', 'token-a')).json() as ModelCatalog;
    assert.deepEqual(filteredOwn.models, [{ id: 'private-custom-model', name: 'private-custom-model' }]);
    assert.equal(filteredOwn.source, own.source); assert.equal(filteredOwn.message, own.message);
    const filteredOther = await (await request('/providers/openai/models?q=private-custom', 'token-b')).json() as ModelCatalog;
    assert.deepEqual(filteredOther.models, []);
    assert.equal((await request(`/fonts?q=${'x'.repeat(201)}`, 'token-a')).status, 400);
    assert.equal((await request(`/providers/openai/models?q=${'x'.repeat(201)}`, 'token-a')).status, 400);
    assert.equal((await request(`/fonts?q=${'x'.repeat(200)}`, 'token-a')).status, 200);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
