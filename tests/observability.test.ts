import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { app } from '../server/index';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { secret, hash, ApiError } from '../server/security';
import type { Bindings, Env } from '../server/types';
import { withSpan, telemetryEnv, observabilityMiddleware, providerUsage, completeMediaSpan } from '../server/observability';
import { health, maintainTelemetry } from '../server/observability-store';
import { posthogConfig } from '../server/observability-posthog';
import type { TelemetryEvent, TelemetrySummary, TelemetryEvents } from '../src/shared/observability';

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'dsa-observability-'));
  const db = new SqliteDatabase(join(directory, 'test.sqlite'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`migrations/${name}`, 'utf8'));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  const request = (path: string, method = 'GET', body?: unknown, cookie = '', headers: Record<string, string> = {}) => app.request(`${env.APP_URL}${path}`, {
    method, headers: { Origin: env.APP_URL!, Cookie: cookie, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const register = async (email: string) => { const response = await request('/api/auth/register', 'POST', { email, name: 'PRIVATE PERSON', password: 'private-password-not-telemetry' }); assert.equal(response.status, 201); return { user: (await response.json()).user, cookie: response.headers.get('Set-Cookie')!.split(';')[0] }; };
  return { db, env, request, register };
}

test('activity is owner isolated, operator access explicit, errors correlated and safe', async t => {
  const { db, env, request, register } = await setup(t);
  const a = await register('owner-a@example.test'), b = await register('owner-b@example.test');
  const created = await request('/api/projects', 'POST', { name: 'PRIVATE PROJECT CONTENT', kind: 'web' }, a.cookie);
  assert.equal(created.status, 201); const project = (await created.json()).project;
  const wrongRevision = await request(`/api/projects/${project.id}/document`, 'PUT', { document: project.document, expectedRevision: 999 }, a.cookie);
  assert.equal(wrongRevision.status, 409);
  const requestId = wrongRevision.headers.get('X-Request-ID'); assert.ok(requestId);
  const trace = await request(`/api/observability/trace/${requestId}`, 'GET', undefined, a.cookie);
  assert.equal(trace.status, 200); const traced = (await trace.json()).events as TelemetryEvent[];
  assert.equal(traced[0].errorCode, 'revision_conflict'); assert.equal(traced[0].projectId, project.id);
  assert.equal(traced[0].action, 'PUT /api/projects/:id/document');
  assert.equal((await request(`/api/observability/trace/${requestId}`, 'GET', undefined, b.cookie)).status, 404);
  assert.equal((await request('/api/observability/events', 'GET')).status, 401);
  assert.equal((await request('/api/observability/events?scope=all', 'GET', undefined, a.cookie)).status, 403);
  assert.equal((await request('/api/observability/events?actorId=other', 'GET', undefined, a.cookie)).status, 400);
  env.OBSERVABILITY_ADMIN_IDS = a.user.id;
  assert.equal((await request('/api/observability/events?scope=all', 'GET', undefined, a.cookie)).status, 200);
  const oauth = secret();
  await db.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)').bind('observability-test', 'Test client', '[]', new Date().toISOString()).run();
  await db.prepare('INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)').bind(await hash(oauth), a.user.id, 'observability-test', `${env.APP_URL}/mcp`, 'access', Date.now() + 100000, secret()).run();
  assert.equal((await request('/api/observability/events?scope=all', 'GET', undefined, '', { Authorization: `Bearer ${oauth}` })).status, 403);
  assert.equal((await request('/api/observability/events', 'GET', undefined, '', { Authorization: `Bearer ${oauth}` })).status, 200);
  const events = await (await request('/api/observability/events?limit=2', 'GET', undefined, a.cookie)).json() as TelemetryEvents;
  assert.equal(events.events.length, 2); assert.ok(events.nextCursor);
  const more = await (await request(`/api/observability/events?limit=2&cursor=${encodeURIComponent(events.nextCursor!)}`, 'GET', undefined, a.cookie)).json() as TelemetryEvents;
  assert.ok(more.events.every(item => !events.events.some(prior => prior.id === item.id)));
  const saved = JSON.stringify((await db.prepare('SELECT * FROM observability_events').all()).results);
  for (const forbidden of ['PRIVATE PROJECT', 'PRIVATE PERSON', 'private-password', 'owner-a@example', 'Bearer', project.document.pages[0].name]) assert.ok(!saved.includes(forbidden), forbidden);
});

test('client events reject arbitrary content, validate project ownership and never trust claimed trace IDs', async t => {
  const { request, register } = await setup(t);
  const a = await register('events-a@example.test'), b = await register('events-b@example.test');
  const created = await request('/api/projects', 'POST', { name: 'Private' }, a.cookie), traceId = created.headers.get('X-Request-ID')!;
  const project = (await created.json()).project;
  assert.equal((await request('/api/observability/client-events', 'POST', { event: 'page_view', page: 'home', prompt: 'PRIVATE' }, a.cookie)).status, 400);
  assert.equal((await request('/api/observability/client-events', 'POST', { event: 'page_view', page: 'home' }, a.cookie, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/observability/client-events', 'POST', { event: 'project_open', projectId: project.id }, b.cookie)).status, 404);
  const forged = await request('/api/observability/client-events', 'POST', { event: 'client_error', requestId: traceId, errorCode: 'network_error' }, b.cookie);
  assert.equal(forged.status, 202); assert.notEqual((await forged.json()).requestId, traceId);
  const linked = await request('/api/observability/client-events', 'POST', { event: 'project_open', projectId: project.id, requestId: traceId }, a.cookie);
  assert.equal(linked.status, 202); assert.equal((await linked.json()).requestId, traceId);
  assert.equal((await request('/api/observability/client-events', 'POST', { event: 'page_view', page: 'home' })).status, 202);
});

test('nested server spans retain correlation, record usage before later validation failure and expose unknowns', async t => {
  const { db, env, register, request } = await setup(t), a = await register('spans@example.test');
  const harness = new Hono<Env>();
  harness.use('*', observabilityMiddleware);
  harness.use('*', async (c, next) => { c.set('user', a.user); c.set('authMethod', 'token'); c.set('tokenKind', 'api'); await next(); });
  harness.get('/api/inner', c => withSpan(c, { kind: 'provider', action: 'provider.text', provider: 'openai', model: 'model-1' }, async span => {
    span.set(providerUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }));
    return c.json({ ok: true });
  }));
  harness.get('/api/semantic-error', c => withSpan(c, { kind: 'mcp', action: 'mcp.semantic-error' }, async span => { span.set({ status: 'error', errorCode: 'mcp_tool_error' }); return c.json({ isError: true }); }));
  harness.get('/api/outer', c => withSpan(c, { kind: 'mcp', action: 'mcp.generate' }, async span => {
    await harness.request(`${env.APP_URL}/api/inner`, {}, telemetryEnv(c, span));
    throw new ApiError(502, 'invalid_generation', 'PRIVATE OUTPUT');
  }));
  harness.onError((error, c) => { c.set('telemetryErrorCode', 'invalid_generation'); return c.json({ error: 'invalid_generation' }, 502); });
  const response = await harness.request(`${env.APP_URL}/api/outer`, {}, env);
  const trace = (await (await request(`/api/observability/trace/${response.headers.get('X-Request-ID')}`, 'GET', undefined, a.cookie)).json()).events as TelemetryEvent[];
  assert.equal(trace.length, 4); assert.equal(new Set(trace.map(e => e.traceId)).size, 1);
  const tool = trace.find(e => e.kind === 'mcp')!, inner = trace.find(e => e.action === 'GET /api/inner')!, provider = trace.find(e => e.kind === 'provider')!;
  assert.equal(inner.parentId, tool.id); assert.equal(provider.parentId, inner.id); assert.equal(tool.status, 'error'); assert.equal(provider.status, 'success');
  assert.equal(provider.totalTokens, 14); assert.equal(provider.costUsd, null);
  const summary = await (await request('/api/observability/summary', 'GET', undefined, a.cookie)).json() as TelemetrySummary;
  assert.equal(summary.usage.providerCalls, 1); assert.equal(summary.usage.totalTokens, 14); assert.equal(summary.usage.costUsd, null); assert.equal(summary.usage.measuredCostCalls, 0);
  const semantic = await harness.request(`${env.APP_URL}/api/semantic-error`, {}, env); assert.equal(semantic.status, 200);
  const semanticTrace = (await (await request(`/api/observability/trace/${semantic.headers.get('X-Request-ID')}`, 'GET', undefined, a.cookie)).json()).events as TelemetryEvent[];
  assert.equal(semanticTrace.find(event => event.kind === 'http')!.status, 'error');
  const raw = JSON.stringify((await db.prepare('SELECT * FROM observability_events').all()).results); assert.ok(!raw.includes('PRIVATE OUTPUT'));
});

test('queued media finalizes once, retention hides old data, telemetry loss does not block projects', async t => {
  const { db, env, request, register } = await setup(t), a = await register('durability@example.test');
  const harness = new Hono<Env>();
  harness.get('/job', async c => { c.set('user', a.user); c.set('authMethod', 'token'); c.set('tokenKind', 'api');
    return withSpan(c, { kind: 'provider', action: 'provider.media.job', provider: 'fal' }, async span => { span.pending = true; return c.json({ id: span.event.id }); });
  });
  harness.get('/complete/:id', async c => { c.set('user', a.user); await completeMediaSpan(c, c.req.param('id'), { outputBytes: 1024 }); return c.json({ ok: true }); });
  const job = await (await harness.request(`${env.APP_URL}/job`, {}, env)).json();
  assert.equal((await db.prepare('SELECT status FROM observability_events WHERE id=?').bind(job.id).first<{status:string}>())!.status, 'running');
  await harness.request(`${env.APP_URL}/complete/${job.id}`, {}, env);
  const before = await db.prepare('SELECT * FROM observability_events WHERE id=?').bind(job.id).first();
  await harness.request(`${env.APP_URL}/complete/${job.id}`, {}, env);
  assert.deepEqual(await db.prepare('SELECT * FROM observability_events WHERE id=?').bind(job.id).first(), before);
  await db.prepare('UPDATE observability_events SET started_at=? WHERE id=?').bind('2020-01-01T00:00:00.000Z', job.id).run();
  health(env).cleanupAt = 0; await maintainTelemetry(env);
  assert.equal(await db.prepare('SELECT id FROM observability_events WHERE id=?').bind(job.id).first(), null);
  await db.exec('DROP TABLE observability_events');
  const created = await request('/api/projects', 'POST', { name: 'Still works' }, a.cookie);
  assert.equal(created.status, 201); assert.ok(health(env).dropped > 0);
  assert.equal((await request('/api/observability/summary', 'GET', undefined, a.cookie)).status, 503);
});

test('media completion preserves late measurements in both poll orders without changing terminal outcomes', async t => {
  const { db, env, register, request } = await setup(t), a = await register('media-race@example.test');
  const harness = new Hono<Env>();
  harness.use('*', async (c, next) => { c.set('user', a.user); await next(); });
  harness.post('/job', c => withSpan(c, { kind: 'provider', action: 'provider.media.job', provider: 'fal' }, async span => {
    span.pending = true; return c.json({ id: span.event.id });
  }));
  harness.post('/complete/:id', async c => { await completeMediaSpan(c, c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  const create = async () => (await (await harness.request(`${env.APP_URL}/job`, { method: 'POST' }, env)).json()).id as string;
  const complete = (id: string, body: object) => harness.request(`${env.APP_URL}/complete/${id}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, env);
  const row = (id: string) => db.prepare('SELECT * FROM observability_events WHERE id=?').bind(id).first<Record<string, unknown>>();
  const measurements = { outputBytes: 1024, usage: { input_tokens: 12, output_tokens: 3, cost_usd: 0 } };
  for (const cachedFirst of [true, false]) {
    const id = await create();
    await complete(id, cachedFirst ? { outputBytes: 1024 } : measurements);
    const first = (await row(id))!;
    await complete(id, cachedFirst ? measurements : { outputBytes: 1024 });
    const final = (await row(id))!;
    assert.equal(final.finished_at, first.finished_at); assert.equal(final.duration_ms, first.duration_ms);
    assert.equal(final.status, 'success'); assert.equal(final.input_tokens, 12); assert.equal(final.output_tokens, 3);
    assert.equal(final.total_tokens, 15); assert.equal(final.cost_usd, 0); assert.equal(final.usage_source, 'provider');
    await complete(id, { usage: null }); assert.deepEqual(await row(id), final);
  }
  const failedId = await create();
  await complete(failedId, { errorCode: 'invalid_media_type', usage: { input_tokens: 5 } });
  const failed = (await row(failedId))!;
  await complete(failedId, { usage: { output_tokens: 2, total_tokens: 7, cost_usd: 0.25 } });
  const enriched = (await row(failedId))!;
  assert.equal(enriched.status, 'error'); assert.equal(enriched.error_code, 'invalid_media_type');
  assert.equal(enriched.finished_at, failed.finished_at); assert.equal(enriched.input_tokens, 5);
  assert.equal(enriched.output_tokens, 2); assert.equal(enriched.total_tokens, 7); assert.equal(enriched.cost_usd, 0.25);
  const concurrentId = await create();
  await Promise.all([complete(concurrentId, { outputBytes: 1024 }), complete(concurrentId, measurements)]);
  const concurrent = (await row(concurrentId))!;
  assert.equal(concurrent.status, 'success'); assert.equal(concurrent.total_tokens, 15); assert.equal(concurrent.cost_usd, 0);
  const summary = await (await request('/api/observability/summary', 'GET', undefined, a.cookie)).json() as TelemetrySummary;
  assert.equal(summary.usage.providerCalls, 4); assert.equal(summary.usage.totalTokens, 52); assert.equal(summary.usage.costUsd, 0.25);
});

test('provider measurements preserve zero and unknown and analytics requires explicit safe host', () => {
  assert.deepEqual(providerUsage(undefined), { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, usageSource: 'unavailable' });
  assert.deepEqual(providerUsage({ input_tokens: 0, output_tokens: 0, cost_usd: 0 }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, usageSource: 'provider' });
  assert.equal(providerUsage({ promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 20 }).totalTokens, 20);
  assert.equal(providerUsage({ prompt_tokens: -1, completion_tokens: Infinity, cost: 12 }).costUsd, null);
  assert.equal(providerUsage({ cost: 0.125 }, 'openrouter').costUsd, 0.125);
  assert.equal(providerUsage({ input_tokens: 0.5 }).inputTokens, null);
  assert.equal(posthogConfig({ POSTHOG_PROJECT_KEY: 'project-token' } as Bindings), null);
  assert.equal(posthogConfig({ POSTHOG_PROJECT_KEY: 'project-token', POSTHOG_HOST: 'https://user:password@example.com' } as Bindings), null);
  assert.deepEqual(posthogConfig({ POSTHOG_PROJECT_KEY: 'project-token', POSTHOG_HOST: 'https://eu.i.posthog.com' } as Bindings), { key: 'project-token', host: 'https://eu.i.posthog.com' });
});
