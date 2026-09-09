import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import type { Bindings } from '../server/types';
import type { TelemetryEvents, TelemetrySummary, TelemetryTrace } from '../src/shared/observability';
import type { Project } from '../src/shared/schema';

type Account = { id: string; cookie: string; token: string };
type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const decode = <T>(result: ToolResult): T => {
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[0].text) as T;
};
const error = (result: ToolResult, code: string) => {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).error.code, code);
};

test('observability CLI, MCP and browser tools preserve trace correlation, lookback and owner boundaries', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-observability-parity-'));
  const database = new SqliteDatabase(':memory:');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort())
      await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const bindings: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
    server = serve({ fetch: request => app.fetch(request, bindings), hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`; bindings.APP_URL = baseUrl;
    const request = (path: string, account?: Account, method = 'GET', body?: unknown) => fetch(baseUrl + path, {
      method, headers: { Origin: baseUrl, 'Content-Type': 'application/json', ...(account ? { Authorization: `Bearer ${account.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const register = async (email: string): Promise<Account> => {
      const response = await request('/api/auth/register', undefined, 'POST', { email, password: 'Isolated observability parity password' });
      assert.equal(response.status, 201, await response.clone().text());
      const { user } = await response.json() as { user: { id: string } };
      const cookie = response.headers.get('set-cookie')!.split(';')[0];
      const issued = await fetch(baseUrl + '/api/tokens', { method: 'POST', headers: { Origin: baseUrl, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Parity test' }) });
      assert.equal(issued.status, 201);
      return { id: user.id, cookie, token: (await issued.json() as { token: string }).token };
    };
    const owner = await register('observability-owner@example.test'), other = await register('observability-other@example.test');
    const cli = async <T>(account: Account, ...args: string[]): Promise<T> => {
      const result = await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', 'observability', ...args], {
        env: { DESIGN_STUDIO_API_KEY: account.token, DESIGN_STUDIO_URL: baseUrl }, timeout: 20000,
      });
      return JSON.parse(result.stdout) as T;
    };
    const cliError = async (account: Account, code: string, ...args: string[]) => {
      await assert.rejects(() => cli(account, ...args), (failure: unknown) => {
        const result = failure as { stderr: string; code: number };
        assert.notEqual(result.code, 0); assert.equal(JSON.parse(result.stderr).error.code, code); return true;
      });
    };
    let rpcId = 0;
    const mcp = async (account: Account, name: string, args: Record<string, unknown> = {}) => {
      const response = await fetch(baseUrl + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(response.status, 200, await response.clone().text());
      const envelope = await response.json() as { error?: unknown; result: ToolResult };
      assert.equal(envelope.error, undefined);
      return { result: envelope.result, requestId: response.headers.get('X-Request-ID')! };
    };
    const created = await request('/api/projects', owner, 'POST', { name: 'Private parity project', kind: 'web' });
    assert.equal(created.status, 201);
    const project = (await created.json() as { project: Project }).project;
    const failed = await mcp(owner, 'inspect_design', { projectId: `${project.id}-missing` });
    error(failed.result, 'not_found'); assert.ok(failed.requestId);
    const trace = await cli<TelemetryTrace>(owner, 'trace', failed.requestId, '--days', '30');
    assert.equal(trace.traceId, failed.requestId); assert.equal(trace.truncated, false);
    const root = trace.events.find(event => event.parentId === null)!;
    const tool = trace.events.find(event => event.kind === 'mcp' && event.action === 'inspect_design')!;
    const child = trace.events.find(event => event.kind === 'http' && event.parentId === tool?.id)!;
    assert.ok(root && tool && child, JSON.stringify(trace));
    assert.equal(root.action, 'POST /mcp'); assert.equal(root.httpStatus, 200);
    assert.equal(tool.parentId, root.id); assert.equal(tool.status, 'error');
    assert.equal(child.status, 'error'); assert.equal(child.errorCode, 'not_found');
    assert.ok(trace.events.every(event => event.traceId === failed.requestId && event.actorId === owner.id && event.channel === 'mcp'));
    assert.equal(new Set(trace.events.map(event => event.id)).size, trace.events.length);

    // Age an actual recorded trace to test lookup beyond the default window without sleeping for weeks.
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    await database.prepare('UPDATE observability_events SET started_at=?,finished_at=? WHERE trace_id=?').bind(old, old, failed.requestId).run();
    await cliError(owner, 'not_found', 'trace', failed.requestId);
    assert.deepEqual((await cli<TelemetryTrace>(owner, 'trace', failed.requestId, '--days', '30')).events.map(event => event.id).sort(), trace.events.map(event => event.id).sort());
    const listed = await cli<TelemetryEvents>(owner, 'events', '--days', '30', '--channel', 'mcp', '--kind', 'http', '--status', 'error');
    assert.ok(listed.events.some(event => event.id === child.id));
    const summary = await cli<TelemetrySummary>(owner, 'summary', '--days', '30');
    assert.equal(summary.scope, 'owner'); assert.equal(summary.days, 30); assert.equal(summary.usage.costUsd, null);
    assert.equal(summary.coverage.retentionDays, 30);
    const mcpTrace = decode<TelemetryTrace>((await mcp(owner, 'get_activity_trace', { id: failed.requestId, days: 30 })).result);
    assert.deepEqual(mcpTrace.events.map(event => event.id).sort(), trace.events.map(event => event.id).sort());
    const mcpEvents = decode<TelemetryEvents>((await mcp(owner, 'list_activity_events', { days: 30, kind: 'http', status: 'error' })).result);
    assert.ok(mcpEvents.events.some(event => event.id === child.id));
    assert.equal(decode<TelemetrySummary>((await mcp(owner, 'get_observability_summary', { days: 30 })).result).scope, 'owner');
    await cliError(other, 'not_found', 'trace', failed.requestId, '--days', '30');
    error((await mcp(other, 'get_activity_trace', { id: failed.requestId, days: 30 })).result, 'not_found');
    await cliError(other, 'operator_required', 'summary', '--scope', 'all');
    error((await mcp(other, 'get_observability_summary', { scope: 'all' })).result, 'operator_required');
    const otherEvents = decode<TelemetryEvents>((await mcp(other, 'list_activity_events', { days: 30, projectId: project.id })).result);
    assert.deepEqual(otherEvents.events, []);

    const bundled = await build({ stdin: { contents: `import { registerDesignTools } from './src/app/browser-design-tools';
      export function initialize(document) { globalThis.registry = new Map();
        globalThis.unregister = registerDesignTools({ registerTool: tool => registry.set(tool.name, tool), unregisterTool: name => registry.delete(name) }, () => document, () => {}); }`,
      resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'studioTools', platform: 'browser' });
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    const loginBrowser = async (account: Account) => {
      await page.context().clearCookies();
      await page.context().addCookies([{ name: 'studio_session', value: account.cookie.slice(account.cookie.indexOf('=') + 1), url: baseUrl }]);
    };
    await loginBrowser(owner); await page.goto(baseUrl + '/api/health'); await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.evaluate(document => (globalThis as any).studioTools.initialize(document), project.document);
    const browserTool = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => page.evaluate(async ({ name, args }) => {
      const tool = (globalThis as any).registry.get(name); if (!tool) throw new Error(`Missing tool ${name}`); return tool.execute(args);
    }, { name, args });
    assert.equal(decode<TelemetrySummary>(await browserTool('studio_api_get_observability_summary', { query: { days: '30' } })).scope, 'owner');
    const browserTrace = decode<TelemetryTrace>(await browserTool('studio_api_get_observability_trace_id', { parameters: { id: failed.requestId }, query: { days: '30' } }));
    assert.deepEqual(browserTrace.events.map(event => event.id).sort(), trace.events.map(event => event.id).sort());
    assert.equal(await page.evaluate(() => (globalThis as any).registry.has('studio_api_post_observability_client_events')), false);
    await loginBrowser(other);
    error(await browserTool('studio_api_get_observability_trace_id', { parameters: { id: failed.requestId }, query: { days: '30' } }), 'not_found');
    error(await browserTool('studio_api_get_observability_summary', { query: { scope: 'all' } }), 'operator_required');
    assert.ok(decode<TelemetryEvents>(await browserTool('studio_api_get_observability_events', { query: { days: '30' } })).events.every(event => event.actorId === other.id));

    bindings.OBSERVABILITY_ADMIN_IDS = owner.id;
    assert.equal((await cli<TelemetrySummary>(owner, 'summary', '--scope', 'all')).scope, 'all');
    const oauth = { ...owner, token: secret() };
    await database.prepare('INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)')
      .bind('parity-client', 'Isolated parity client', '[]', new Date().toISOString()).run();
    await database.prepare('INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)')
      .bind(await hash(oauth.token), owner.id, 'parity-client', `${baseUrl}/mcp`, 'access', Date.now() + 60000, secret()).run();
    assert.equal(decode<TelemetrySummary>((await mcp(oauth, 'get_observability_summary')).result).scope, 'owner');
    error((await mcp(oauth, 'get_observability_summary', { scope: 'all' })).result, 'operator_required');
    assert.equal(await page.evaluate(() => { const state = globalThis as any; state.unregister(); return state.registry.size; }), 0);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    database.close(); await rm(directory, { recursive: true, force: true });
  }
});
