import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { isTextProvider } from '../src/shared/providers';
import type { Bindings } from '../server/types';

const endpoint = '/api/community/me/profile/generate';
const suggestion = { displayName: 'Paper Lantern', handle: 'paper-lantern', bio: 'Exploring color and everyday shapes.' };

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'community-profile-generation-'));
  const db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  }
  const env: Bindings = {
    DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')),
    ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example', COMMUNITY_ENABLED: 'true',
  };
  for (const user of ['alice', 'bob']) {
    await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)')
      .bind(user, `${user}-private@example.test`, `${user} private account name`, 'unused-test-only', new Date().toISOString()).run();
    await db.prepare('INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)')
      .bind(user, user, user, await hash(`token-${user}`), new Date().toISOString()).run();
  }
  const request = (path: string, method = 'GET', body?: unknown, user = 'alice') => app.request(env.APP_URL + path, {
    method, headers: { ...(user ? { Authorization: `Bearer token-${user}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const json = async (response: Response, status = 200) => {
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const connect = async (provider = 'openai', user = 'alice', model = `${provider}-configured-model`) =>
    json(await request(`/api/providers/${provider}`, 'PUT', { apiKey: `${user}-isolated-provider-key`, model }, user));
  const generate = (body: unknown = {}, user = 'alice') => request(endpoint, 'POST', body, user);
  return { db, request, json, connect, generate };
}

function providerTransport(t: TestContext) {
  const calls: { url: string; headers: Headers; payload: { model: string; messages: { role: string; content: string }[] } }[] = [];
  let output = JSON.stringify(suggestion), status = 200, unavailable = false;
  // Only outbound provider transport is replaced; authentication, encryption,
  // shared validators, routes and all SQLite persistence remain real.
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/(api\.openai\.com\/v1|api\.deepseek\.com|openrouter\.ai\/api\/v1)\/chat\/completions$/);
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    calls.push({ url, headers: new Headers(init.headers), payload: JSON.parse(String(init.body)) });
    if (unavailable) throw new Error('Isolated transport failure');
    return Response.json({ choices: [{ message: { content: output } }] }, { status });
  });
  return {
    calls,
    respond(value: unknown) { output = JSON.stringify(value); },
    respondText(value: string) { output = value; },
    fail(httpStatus: number) { status = httpStatus; },
    disconnect() { unavailable = true; },
  };
}

test('profile generation selects the first owned text provider and sends only supplied public fields', async t => {
  const { request, json, connect, generate, db } = await setup(t), transport = providerTransport(t);
  await connect('openai', 'bob');
  await connect('fal');
  await connect('grok');
  await connect('leonardo');
  await connect('openrouter');
  await connect('openai');
  const providers = (await json(await request('/api/providers'))).providers as { provider: string; model: string }[];
  const expected = providers.find(provider => isTextProvider(provider.provider))!;
  const project = (await json(await request('/api/projects', 'POST', { name: 'Private unreleased project' }), 201)).project;
  const beforeProject = await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first();
  const input = { displayName: '  Public artist  ', handle: 'my-art', bio: 'I like paper shapes.', prompt: 'Write in Vietnamese.' };
  const response = await json(await generate(input));
  assert.deepEqual(response, { suggestion, provider: expected.provider });
  assert.equal(transport.calls.length, 1);
  const call = transport.calls[0];
  assert.equal(call.payload.model, expected.model);
  assert.equal(call.headers.get('Authorization'), 'Bearer alice-isolated-provider-key');
  assert.deepEqual(JSON.parse(call.payload.messages.find(message => message.role === 'user')!.content), {
    displayName: 'Public artist', handle: input.handle, bio: input.bio, instructions: input.prompt,
  });
  for (const privateValue of ['alice-private@example.test', 'alice private account name', project.id, 'Private unreleased project']) {
    assert.ok(!JSON.stringify(call.payload).includes(privateValue), `${privateValue} must not enter the provider prompt`);
  }
  assert.equal((await json(await request('/api/community/me/profile'))).profile, null);
  assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first(), beforeProject);
  await json(await generate());
  assert.deepEqual(JSON.parse(transport.calls[1].payload.messages.find(message => message.role === 'user')!.content), {
    displayName: '', handle: '', bio: '', instructions: '',
  });
});

test('explicit provider choice uses the owner connection and never borrows another account connection', async t => {
  const { json, connect, generate } = await setup(t), transport = providerTransport(t);
  await connect('openai', 'bob');
  await connect('deepseek', 'alice', 'chosen-text-model');
  assert.equal((await json(await generate({ provider: 'openai' }), 400)).error.code, 'provider_unconfigured');
  assert.equal(transport.calls.length, 0);
  const generated = await json(await generate({ provider: 'deepseek' }));
  assert.equal(generated.provider, 'deepseek');
  assert.equal(transport.calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(transport.calls[0].payload.model, 'chosen-text-model');
  assert.equal(transport.calls[0].headers.get('Authorization'), 'Bearer alice-isolated-provider-key');
  await json(await generate({ provider: 'openai' }, 'bob'));
  assert.equal(transport.calls[1].headers.get('Authorization'), 'Bearer bob-isolated-provider-key');
});

test('profile generation enforces input limits and rejects non-text providers before transport', async t => {
  const { json, connect, generate } = await setup(t), transport = providerTransport(t);
  await connect();
  const invalid = [
    { displayName: 'x'.repeat(101) }, { handle: 'x'.repeat(41) }, { bio: 'x'.repeat(501) }, { prompt: 'x'.repeat(1001) },
    { provider: 'fal' }, { provider: 'grok' }, { provider: 'leonardo' }, { expectedProfileRevision: 0 }, { email: 'private@example.test' },
  ];
  for (const body of invalid) await json(await generate(body), 400);
  assert.equal(transport.calls.length, 0);
  await json(await generate({ displayName: 'x'.repeat(100), handle: 'x'.repeat(40), bio: 'x'.repeat(500), prompt: 'x'.repeat(1000) }));
  assert.equal(transport.calls.length, 1);
});

test('profile suggestions reject malformed JSON, reserved handles and invalid output lengths', async t => {
  const { json, connect, generate, db } = await setup(t), transport = providerTransport(t);
  await connect();
  const invalid = [
    ...['admin', 'api', 'community', 'moderation', 'me', 'saved', 'publishing', 'support', 'studio', 'system', 'www'].map(handle => ({ ...suggestion, handle })),
    { ...suggestion, handle: 'ab' }, { ...suggestion, handle: 'has--gap' }, { ...suggestion, handle: 'x'.repeat(41) },
    { ...suggestion, displayName: '' }, { ...suggestion, displayName: 'x'.repeat(101) }, { ...suggestion, bio: 'x'.repeat(501) },
    { ...suggestion, unexpected: 'extra data' },
  ];
  for (const value of invalid) {
    transport.respond(value);
    assert.equal((await json(await generate(), 502)).error.code, 'invalid_generation');
  }
  transport.respondText('This is not JSON');
  assert.equal((await json(await generate(), 502)).error.code, 'invalid_generation');
  const bounded = { displayName: 'x'.repeat(100), handle: 'x'.repeat(40), bio: 'x'.repeat(500) };
  transport.respondText('```json\n' + JSON.stringify(bounded) + '\n```');
  assert.deepEqual((await json(await generate())).suggestion, bounded);
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM community_profiles').first<{ count: number }>())!.count, 0);
});

test('suggested handles may belong to the owner but collide with other profiles without saving or reserving', async t => {
  const { request, json, connect, generate, db } = await setup(t), transport = providerTransport(t);
  await connect();
  await json(await request('/api/community/me/profile', 'PUT', { ...suggestion, expectedProfileRevision: 0 }));
  await json(await request('/api/community/me/profile', 'PUT', { ...suggestion, handle: 'other-artist', expectedProfileRevision: 0 }, 'bob'));
  const before = (await db.prepare('SELECT * FROM community_profiles ORDER BY user_id').all()).results;
  transport.respond({ ...suggestion, displayName: 'A new draft name' });
  assert.equal((await json(await generate())).suggestion.displayName, 'A new draft name');
  transport.respond({ ...suggestion, handle: 'OTHER-ARTIST' });
  assert.equal((await json(await generate(), 409)).error.code, 'handle_unavailable');
  transport.respond({ ...suggestion, handle: 'available-draft' });
  assert.equal((await json(await generate())).suggestion.handle, 'available-draft');
  assert.deepEqual((await db.prepare('SELECT * FROM community_profiles ORDER BY user_id').all()).results, before);
  await json(await request('/api/community/me/profile', 'PUT', { ...suggestion, handle: 'available-draft', expectedProfileRevision: 1 }, 'bob'));
  assert.equal((await json(await request('/api/community/me/profile', 'PUT', { ...suggestion, handle: 'available-draft', expectedProfileRevision: 1 }), 409)).error.code, 'handle_unavailable');
});

test('profile generation reports missing providers, guest authentication and provider failures without changing a profile', async t => {
  const { request, json, connect, generate } = await setup(t), transport = providerTransport(t);
  await connect('openai', 'bob');
  await connect('fal');
  assert.equal((await json(await generate(), 400)).error.code, 'provider_unconfigured');
  assert.equal((await json(await generate({}, ''), 401)).error.code, 'unauthorized');
  assert.equal(transport.calls.length, 0);
  await connect();
  await json(await request('/api/community/me/profile', 'PUT', { ...suggestion, expectedProfileRevision: 0 }));
  const before = await json(await request('/api/community/me/profile'));
  transport.fail(503);
  assert.equal((await json(await generate(), 502)).error.code, 'provider_error');
  transport.disconnect();
  assert.equal((await json(await generate(), 502)).error.code, 'provider_unavailable');
  assert.deepEqual(await json(await request('/api/community/me/profile')), before);
});

test('profile generation rate limits each owner before provider transport and permits requests after expiry', async t => {
  const { json, connect, generate, db } = await setup(t), transport = providerTransport(t);
  await connect();
  await connect('openai', 'bob');
  for (let count = 0; count < 20; count++) await json(await generate());
  assert.equal((await json(await generate(), 429)).error.code, 'rate_limited');
  assert.equal(transport.calls.length, 20);
  await json(await generate({}, 'bob'));
  assert.equal(transport.calls.length, 21);
  await db.prepare('UPDATE rate_limits SET expires_at=? WHERE key=?').bind(Date.now() - 1, 'community:profile-generation:alice').run();
  await json(await generate());
  assert.equal(transport.calls.length, 22);
});
