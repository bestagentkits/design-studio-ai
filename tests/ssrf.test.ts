import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { isBlockedHostname } from '../server/ssrf';
import type { Bindings } from '../server/types';

test('the SSRF hostname guard blocks loopback, private, link-local, CGNAT and reserved targets', () => {
  const blocked = ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', '100.64.0.1', '172.16.3.4', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', 'localhost', 'api.localhost', 'internal.example.internal', 'printer.local'];
  for (const host of blocked) assert.equal(isBlockedHostname(host), true, `expected blocked: ${host}`);
  const allowed = ['api.openai.com', 'example.com', '8.8.8.8', 'openrouter.ai', 'team.example'];
  for (const host of allowed) assert.equal(isBlockedHostname(host), false, `expected allowed: ${host}`);
});

test('the provider transport rejects a private address even when the origin is allowlisted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-ssrf-'));
  const db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example', PROVIDER_ALLOWED_ORIGINS: 'https://127.0.0.1,https://169.254.169.254' };
  await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind('alice', 'alice@example.test', 'alice', 'unused', new Date().toISOString()).run();
  await db.prepare('INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)').bind('alice', 'alice', 'alice', await hash('token-alice'), new Date().toISOString()).run();
  const request = (path: string, method = 'GET', body?: unknown) => app.request(`https://studio.example${path}`, { method, headers: { Authorization: 'Bearer token-alice', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  const config = { name: 'Metadata proxy', baseUrl: 'https://169.254.169.254/latest', model: 'm', protocol: 'openai', authMethod: 'none' };
  const response = await request('/api/providers/custom-proxy', 'PUT', config);
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'invalid_provider_url');
  assert.match(body.error.message, /loopback, private, link-local, CGNAT or reserved/);
});
