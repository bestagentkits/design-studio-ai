import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import { isTextProvider } from '../src/shared/providers';
import type { DesignDocument, DesignNode, Project } from '../src/shared/schema';
import type { Bindings } from '../server/types';

const endpoint = '/api/community/metadata/generate';
const suggestion = { title: 'Paper Lantern', description: 'An editable study of color and everyday shapes.', tags: ['paper', 'color'] };
const node = (id: string, extra: Partial<DesignNode> = {}): DesignNode => ({ id, type: 'text', name: id, x: 0, y: 0, width: 100, height: 100, ...extra });

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'community-metadata-generation-'));
  const db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`migrations/${file}`, 'utf8'));
  }
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.example', COMMUNITY_ENABLED: 'true' };
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
  const json = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  const connect = async (provider = 'openai', user = 'alice', model = `${provider}-configured-model`) =>
    json(await request(`/api/providers/${provider}`, 'PUT', { apiKey: `${user}-isolated-provider-key`, model }, user));
  const create = async (document = createDocument(), user = 'alice'): Promise<Project> =>
    (await json(await request('/api/projects', 'POST', { name: 'Public paper study', description: 'PRIVATE PROJECT DESCRIPTION', document }, user), 201)).project;
  const generate = (project: Project, extra: Record<string, unknown> = {}, user = 'alice') =>
    request(endpoint, 'POST', { projectId: project.id, expectedProjectRevision: project.revision, ...extra }, user);
  return { db, request, json, connect, create, generate };
}

function providerTransport(t: TestContext) {
  const calls: { url: string; headers: Headers; payload: { model: string; max_tokens?: number; messages: { role: string; content: string }[] } }[] = [];
  let output: string | null = JSON.stringify(suggestion), status = 200, unavailable = false;
  let duringCall: (() => Promise<void>) | undefined;
  // Only outbound provider transport is replaced; auth, encryption, validators,
  // ownership, revision checks and SQLite persistence use the actual application.
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/(api\.openai\.com\/v1|api\.deepseek\.com|openrouter\.ai\/api\/v1)\/chat\/completions$/);
    assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
    calls.push({ url, headers: new Headers(init.headers), payload: JSON.parse(String(init.body)) });
    if (duringCall) await duringCall();
    if (unavailable) throw new Error('Isolated transport failure');
    return Response.json({ choices: [{ message: { content: output } }] }, { status });
  });
  return { calls, respond(value: unknown) { output = JSON.stringify(value); }, respondText(value: string | null) { output = value; },
    fail(httpStatus: number) { status = httpStatus; }, disconnect() { unavailable = true; }, during(callback: () => Promise<void>) { duringCall = callback; } };
}

test('metadata generation uses the first owned text connection and only bounded public context without saving', async t => {
  const { request, json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  await connect('openai', 'bob');
  for (const provider of ['fal', 'grok', 'leonardo', 'openrouter', 'openai']) await connect(provider);
  const providers = (await json(await request('/api/providers'))).providers as { provider: string; model: string }[];
  const expected = providers.find(provider => isTextProvider(provider.provider))!;
  const document = createDocument();
  document.pages[0].notes = 'PRIVATE PAGE NOTES';
  document.pages[0].nodes = [
    node('visible-heading', { text: 'Public paper shapes' }),
    node('hidden-group', { type: 'group', visible: false, name: 'PRIVATE GROUP NAME' }),
    node('hidden-child', { parentId: 'hidden-group', text: 'PRIVATE HIDDEN CHILD' }),
    node('deep-hidden-child', { parentId: 'hidden-child', text: 'PRIVATE DEEP DESCENDANT' }),
    node('visible-image', { type: 'image', src: 'https://private-media.example.test/image.png?secret=PRIVATE-MEDIA-URL' }),
    node('visible-component', { type: 'component', component: { name: 'Card', system: 'antd', props: { label: 'Public card title', description: 'Public card content', internalNotes: 'PRIVATE COMPONENT DATA' } } }),
    node('visible-chart', { type: 'chart', data: { labels: ['Public chart label'], values: [1], privatePrompt: 'PRIVATE OPAQUE DATA' } }),
  ];
  const project = await create(document);
  const before = await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first();
  const response = await json(await generate(project, { title: '  Entered title  ', description: 'Entered description', tags: ['paper'], prompt: 'Write in Vietnamese.' }));
  assert.deepEqual(response, { suggestion, provider: expected.provider, projectRevision: project.revision });
  const call = transport.calls[0], prompt = call.payload.messages.find(message => message.role === 'user')!.content;
  assert.equal(call.payload.model, expected.model);
  assert.equal(call.headers.get('Authorization'), 'Bearer alice-isolated-provider-key');
  for (const visible of ['Public paper shapes', 'Entered title', 'Entered description', 'Write in Vietnamese.']) assert.ok(prompt.includes(visible));
  for (const privateValue of ['PRIVATE', 'alice-private@example.test', 'alice private account name', 'private-media.example.test', project.id]) {
    assert.ok(!prompt.includes(privateValue), `${privateValue} must not enter the provider context`);
  }
  assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first(), before);
  for (const table of ['community_profiles', 'community_listings', 'community_jobs', 'publications']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())!.count, 0);
  }
  // Large legal documents must not make the upstream prompt grow without bound.
  const large = createDocument();
  large.pages[0].nodes = Array.from({ length: 120 }, (_, index) => node(`text-${index}`, { text: 'B'.repeat(10_000) }));
  await json(await generate(await create(large)));
  const bounded = transport.calls[1].payload.messages.find(message => message.role === 'user')!.content;
  const design = JSON.parse(bounded).design as { pages: { name: string; text: string[] }[]; boardText: string[] };
  const excerpts = [...design.pages.flatMap(page => [page.name, ...page.text]), ...design.boardText];
  assert.ok(excerpts.every(text => text.length <= 500));
  assert.ok(excerpts.reduce((sum, text) => sum + text.length, 0) <= 8000);
  assert.ok(bounded.length < 12_000, `Expected bounded context, received ${bounded.length} characters`);
});

test('explicit metadata provider selection uses the owner saved model and refuses other account connections', async t => {
  const { json, connect, create, generate } = await setup(t), transport = providerTransport(t);
  const project = await create();
  await connect('openai', 'bob'); await connect('deepseek', 'alice', 'chosen-text-model');
  assert.equal((await json(await generate(project, { provider: 'openai' }), 400)).error.code, 'provider_unconfigured');
  assert.equal(transport.calls.length, 0);
  assert.equal((await json(await generate(project, { provider: 'deepseek' }))).provider, 'deepseek');
  assert.equal(transport.calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(transport.calls[0].payload.model, 'chosen-text-model');
  assert.equal(transport.calls[0].headers.get('Authorization'), 'Bearer alice-isolated-provider-key');
});

test('metadata generation sends a bounded output budget to the configured reasoning model', async t => {
  const { json, connect, create, generate } = await setup(t), transport = providerTransport(t);
  const project = await create(), model = 'deepseek/deepseek-v4.1-flash';
  await connect('openrouter', 'alice', model);
  const result = await json(await generate(project));
  assert.deepEqual(result, { suggestion, provider: 'openrouter', projectRevision: project.revision });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(transport.calls[0].payload.model, model);
  // Verify the actual provider request, including its upper bound; the caller
  // must leave room for reasoning without silently selecting a different model.
  assert.equal(transport.calls[0].payload.max_tokens, 8192);
});

test('null empty and truncated metadata outputs are rejected without saving or retrying automatically', async t => {
  const { json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  const project = await create();
  await connect('openrouter', 'alice', 'deepseek/deepseek-v4.1-flash');
  const before = await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first();
  const incomplete = [null, '', '{"title":"Paper Lantern","description":"An editable study'];
  for (const [index, output] of incomplete.entries()) {
    transport.respondText(output);
    const result = await json(await generate(project), 502);
    assert.equal(result.error.code, 'invalid_generation');
    assert.equal('suggestion' in result, false);
    assert.equal(transport.calls.length, index + 1);
    assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first(), before);
    for (const table of ['community_profiles', 'community_listings', 'community_jobs', 'publications']) {
      assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())!.count, 0);
    }
  }
});

test('metadata generation rejects invalid inputs before provider transport and accepts boundary inputs', async t => {
  const { request, json, connect, create, generate } = await setup(t), transport = providerTransport(t);
  const project = await create(); await connect();
  const invalid = [
    { projectId: '' }, { expectedProjectRevision: 0 }, { expectedProjectRevision: 1.5 },
    { title: 'x'.repeat(201) }, { description: 'x'.repeat(4001) }, { prompt: 'x'.repeat(1001) },
    { tags: Array.from({ length: 9 }, (_, index) => `tag${index}`) }, { tags: ['x'.repeat(33)] },
    { provider: 'fal' }, { provider: 'grok' }, { provider: 'leonardo' }, { document: {} }, { email: 'private@example.test' },
  ];
  await json(await request(endpoint, 'POST', {}), 400);
  for (const body of invalid) await json(await generate(project, body), 400);
  assert.equal(transport.calls.length, 0);
  await json(await generate(project, { title: 'x'.repeat(200), description: 'x'.repeat(4000), prompt: 'x'.repeat(1000), tags: Array.from({ length: 8 }, (_, i) => `${i}${'x'.repeat(31)}`) }));
  await json(await generate(project, { title: '', description: '', tags: [], prompt: '' }));
  assert.equal(transport.calls.length, 2);
});

test('metadata output requires valid nonempty title description and one to eight comma-free tags', async t => {
  const { json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  const project = await create(); await connect();
  const before = await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first();
  const invalid = [
    { ...suggestion, title: '' }, { ...suggestion, title: 'x'.repeat(201) },
    { ...suggestion, description: '' }, { ...suggestion, description: 'x'.repeat(4001) },
    { ...suggestion, tags: [] }, { ...suggestion, tags: Array.from({ length: 9 }, (_, index) => `tag${index}`) },
    { ...suggestion, tags: [''] }, { ...suggestion, tags: ['x'.repeat(33)] }, { ...suggestion, tags: ['art,paper'] },
    { ...suggestion, unexpected: 'extra data' }, { title: suggestion.title, tags: suggestion.tags },
  ];
  for (const value of invalid) {
    transport.respond(value);
    assert.equal((await json(await generate(project), 502)).error.code, 'invalid_generation');
  }
  transport.respondText('This is not JSON');
  assert.equal((await json(await generate(project), 502)).error.code, 'invalid_generation');
  const boundary = { title: 'x'.repeat(200), description: 'x'.repeat(4000), tags: Array.from({ length: 8 }, (_, index) => `${index}${'x'.repeat(31)}`) };
  transport.respondText('```json\n' + JSON.stringify(boundary) + '\n```');
  assert.deepEqual((await json(await generate(project))).suggestion, boundary);
  assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first(), before);
});

test('metadata generation checks authentication ownership and saved revision before calling the provider', async t => {
  const { json, connect, create, generate } = await setup(t), transport = providerTransport(t);
  const project = await create(); await connect(); await connect('openai', 'bob');
  assert.equal((await json(await generate(project, {}, ''), 401)).error.code, 'unauthorized');
  assert.equal((await json(await generate(project, {}, 'bob'), 404)).error.code, 'not_found');
  assert.equal((await json(await generate(project, { projectId: 'missing-project' }), 404)).error.code, 'not_found');
  assert.equal((await json(await generate(project, { expectedProjectRevision: project.revision + 1 }), 409)).error.code, 'revision_conflict');
  assert.equal(transport.calls.length, 0);
});

test('a project saved during provider generation makes the suggestion stale without reverting the newer save', async t => {
  const { request, json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  const project = await create(); await connect();
  const updated: DesignDocument = structuredClone(project.document);
  updated.pages[0].nodes.push(node('new-manual-content', { text: 'Newly saved manual work' }));
  transport.during(async () => { await json(await request(`/api/projects/${project.id}/document`, 'PUT', { expectedRevision: project.revision, document: updated })); });
  assert.equal((await json(await generate(project), 409)).error.code, 'revision_conflict');
  const saved = (await json(await request(`/api/projects/${project.id}`))).project as Project;
  assert.equal(saved.revision, project.revision + 1);
  assert.ok(saved.document.pages[0].nodes.some(value => value.text === 'Newly saved manual work'));
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM community_listings').first<{ count: number }>())!.count, 0);
});

test('metadata missing providers and provider failures preserve manual project content', async t => {
  const { json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  const project = await create(); await connect('fal'); await connect('openai', 'bob');
  assert.equal((await json(await generate(project), 400)).error.code, 'provider_unconfigured');
  assert.equal(transport.calls.length, 0);
  await connect();
  const before = await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first();
  transport.fail(503);
  assert.equal((await json(await generate(project), 502)).error.code, 'provider_error');
  transport.disconnect();
  assert.equal((await json(await generate(project), 502)).error.code, 'provider_unavailable');
  assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(project.id).first(), before);
});

test('metadata generation refuses an unsafe visible dependency before contacting the provider', async t => {
  const { json, connect, create, generate } = await setup(t), transport = providerTransport(t);
  const document = createDocument();
  document.pages[0].nodes = [node('hidden-rig', { type: 'model3d', visible: false }), node('visible-model', { type: 'model3d', data: { rigSourceId: 'hidden-rig' } })];
  const project = await create(document); await connect();
  assert.equal((await json(await generate(project), 400)).error.code, 'unsafe_projection');
  assert.equal(transport.calls.length, 0);
});

test('metadata generation limits each owner to twenty calls per fifteen minutes', async t => {
  const { json, connect, create, generate, db } = await setup(t), transport = providerTransport(t);
  const project = await create(), other = await create(createDocument(), 'bob');
  await connect(); await connect('openai', 'bob');
  for (let count = 0; count < 20; count++) await json(await generate(project));
  assert.equal((await json(await generate(project), 429)).error.code, 'rate_limited');
  assert.equal(transport.calls.length, 20);
  await json(await generate(other, {}, 'bob')); assert.equal(transport.calls.length, 21);
  const limit = await db.prepare('SELECT expires_at FROM rate_limits WHERE key=?').bind('community:metadata-generation:alice').first<{ expires_at: number }>();
  assert.ok(limit && limit.expires_at > Date.now() + 14 * 60_000 && limit.expires_at <= Date.now() + 15 * 60_000);
  await db.prepare('UPDATE rate_limits SET expires_at=? WHERE key=?').bind(Date.now() - 1, 'community:metadata-generation:alice').run();
  await json(await generate(project)); assert.equal(transport.calls.length, 22);
});
