import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { decrypt, hash, secret } from '../server/security';
import type { Bindings } from '../server/types';

test('custom provider storage, updates, ownership and OAuth restrictions use real persistence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-custom-providers-'));
  const db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example', PROVIDER_ALLOWED_ORIGINS: 'https://team.example,https://other.example' };
  for (const user of ['alice', 'bob']) {
    await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(user, `${user}@example.test`, user, 'unused', new Date().toISOString()).run();
    await db.prepare('INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)').bind(user, user, user, await hash(`token-${user}`), new Date().toISOString()).run();
  }
  const request = (path: string, method = 'GET', body?: unknown, token = 'token-alice') => app.request(`https://studio.example${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  const project = (await (await request('/api/projects', 'POST', { name: 'Unconfigured providers' })).json()).project;
  for (const provider of ['gemini', 'grok', 'leonardo']) {
    const response = await request(`/api/projects/${project.id}/media`, 'POST', { provider, kind: 'image', prompt: 'A vase' });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'provider_unconfigured');
  }
  const unconfiguredText = await request(`/api/projects/${project.id}/generate`, 'POST', { provider: 'deepseek', prompt: 'Refine spacing', expectedRevision: 1 });
  assert.equal(unconfiguredText.status, 400); assert.equal((await unconfiguredText.json()).error.code, 'provider_unconfigured');
  const config = { name: 'Team proxy', baseUrl: 'https://team.example/v1', model: 'team-model', protocol: 'openai', authMethod: 'api-key', authHeader: 'X-Team-Key', apiKey: 'unit-test-private-value' };
  const saved = await request('/api/providers/custom-team', 'PUT', config);
  assert.equal(saved.status, 200); const metadata = await saved.json();
  assert.equal(metadata.name, 'Team proxy'); assert.equal(metadata.authMethod, 'api-key'); assert.equal(metadata.apiKey, '••••••••');
  const row = await db.prepare('SELECT encrypted_key FROM providers WHERE user_id=? AND provider=?').bind('alice', 'custom-team').first<{ encrypted_key: string }>();
  assert.ok(row && !row.encrypted_key.includes(config.apiKey)); assert.equal(await decrypt(env, row!.encrypted_key), config.apiKey);
  assert.equal((await request('/api/providers')).status, 200);
  assert.equal((await (await request('/api/providers')).text()).includes(config.apiKey), false);
  assert.deepEqual((await (await request('/api/providers', 'GET', undefined, 'token-bob')).json()).providers, []);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { model: 'updated-model' })).status, 200);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { baseUrl: 'https://other.example/v1' })).status, 400);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authHeader: 'X-Other-Key' })).status, 400);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'basic' })).status, 400);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'basic', apiKey: 'missing-colon' })).status, 400);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'basic', apiKey: 'user:password' })).status, 200);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'none' })).status, 200);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'bearer' })).status, 400);
  assert.equal((await request('/api/providers/custom-team', 'PUT', { authMethod: 'bearer', apiKey: config.apiKey })).status, 200);
  const none = { ...config, apiKey: undefined, authMethod: 'none', authHeader: undefined };
  assert.equal((await request('/api/providers/custom-second', 'PUT', none)).status, 200);
  assert.equal((await request('/api/providers/custom-team', 'PUT', none, 'token-bob')).status, 200);
  await request('/api/providers/custom-team', 'DELETE', undefined, 'token-bob');
  assert.equal((await (await request('/api/providers')).json()).providers.length, 2);
  assert.equal((await request('/api/providers/custom-new', 'PUT', { authMethod: 'none' })).status, 400);
  assert.equal((await request('/api/providers/grok', 'PUT', { apiKey: config.apiKey, authMethod: 'none' })).status, 400);
  for (const provider of ['gemini', 'openai', 'grok', 'leonardo', 'deepseek']) assert.equal((await request(`/api/providers/${provider}`, 'PUT', { apiKey: config.apiKey })).status, 200);
  const discovery = await (await request('/api/providers/custom-team/models')).json();
  assert.equal(discovery.source, 'fallback'); assert.ok(discovery.models.some((m: { id: string }) => m.id === 'updated-model')); assert.ok(!JSON.stringify(discovery).includes(config.apiKey));
  await db.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)').bind('client', 'Test', '[]', new Date().toISOString()).run();
  await db.prepare('INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)').bind(await hash('oauth-test'), 'alice', 'client', 'https://studio.example/mcp', 'access', Date.now() + 60000, 'family').run();
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request('/api/providers/custom-team', method, method === 'PUT' ? config : undefined, 'oauth-test')).status, 403);
  assert.equal((await request('/api/providers/custom-team/models', 'GET', undefined, 'oauth-test')).status, 403);
  const schemas = await (await request('/api/schema')).json();
  assert.ok(JSON.stringify(schemas.generationInput).includes('deepseek')); assert.ok(JSON.stringify(schemas.mediaInput).includes('leonardo'));
  const openapi = await (await request('/api/openapi')).json();
  assert.ok(openapi.paths['/api/providers/{provider}'].put.requestBody.content['application/json'].schema.properties.authMethod);
  await request('/api/providers/custom-team', 'DELETE');
  assert.equal((await (await request('/api/providers')).json()).providers.some((p: {provider:string}) => p.provider === 'custom-team'), false);
});
