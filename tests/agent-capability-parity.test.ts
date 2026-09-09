import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';
import type { DesignSystem, DesignSystemDefinition } from '../src/shared/design-systems';
import type { Project } from '../src/shared/schema';
import type { FontCatalog, ModelCatalog } from '../src/shared/discovery';

test('MCP, CLI and browser tools share versioned libraries, discovery and multipart asset uploads', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-agent-parity-'));
  const database = new SqliteDatabase(':memory:');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const bindings: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
    server = serve({ fetch: request => app.fetch(request, bindings), hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`; bindings.APP_URL = baseUrl;
    let cookie = '', token = '';
    const request = (path: string, method = 'GET', body?: unknown) => fetch(baseUrl + path, { method, headers: { Origin: baseUrl, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const registration = await request('/api/auth/register', 'POST', { email: 'agent-parity@example.test', password: 'Isolated agent parity password' });
    assert.equal(registration.status, 201, await registration.clone().text()); cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const issued = await request('/api/tokens', 'POST', { name: 'Agent parity test' }); assert.equal(issued.status, 201);
    token = (await issued.json() as { token: string }).token;
    const cli = async <T>(...args: string[]): Promise<T> => {
      const output = await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', ...args], { env: { DESIGN_STUDIO_API_KEY: token, DESIGN_STUDIO_URL: baseUrl }, timeout: 20000 });
      return JSON.parse(output.stdout) as T;
    };
    const rootVersion = await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', '--version'], { timeout: 20000 });
    assert.equal(rootVersion.stdout.trim(), '0.3.0');
    let rpcId = 0;
    const mcpRaw = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(baseUrl + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(response.status, 200, await response.clone().text());
      const envelope = await response.json() as { error?: unknown; result: { isError?: boolean; content: { type: string; text: string }[] } };
      assert.equal(envelope.error, undefined); return envelope.result;
    };
    const mcp = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      const result = await mcpRaw(name, args); assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text) as T;
    };
    const definition: DesignSystemDefinition = { name: 'Cross-client library', description: 'Agent interoperability', system: 'antd', theme: createDocument('web').theme, components: [{ id: 'primary-action', name: 'Primary action', component: { name: 'Button', system: 'antd', props: { label: 'Shared action' } }, style: { borderRadius: 8 } }], compositions: [] };
    const created = await mcp<{ system: DesignSystem }>('create_design_system', { definition });
    const id = created.system.id;
    assert.equal(created.system.version, 1);
    assert.deepEqual((await cli<{ system: DesignSystem }>('design-systems', 'get', id)).system, created.system);
    assert.deepEqual((await cli<{ systems: DesignSystem[] }>('design-systems', 'list')).systems, [created.system]);
    const revised = { ...definition, name: 'Updated through CLI' };
    const definitionFile = join(directory, 'definition.json'); await writeFile(definitionFile, JSON.stringify(revised));
    const updated = await cli<{ system: DesignSystem }>('design-systems', 'update', id, '--system-version', '1', '--file', definitionFile);
    assert.equal(updated.system.version, 2);
    assert.deepEqual((await mcp<{ system: DesignSystem }>('get_design_system', { id })).system, updated.system);
    assert.deepEqual((await mcp<{ system: DesignSystem }>('get_design_system', { id, version: 1 })).system, created.system);
    assert.deepEqual((await cli<{ system: DesignSystem }>('design-systems', 'get', id, '--system-version', '1')).system, created.system);
    const versions = await mcp<{ versions: { version: number }[] }>('list_design_system_versions', { id }); assert.deepEqual(versions.versions.map(item => item.version), [2, 1]);
    const createResponse = await request('/api/projects', 'POST', { name: 'Agent parity project', kind: 'web', document: createDocument('web', 'Agent parity project') });
    assert.equal(createResponse.status, 201); let project = (await createResponse.json() as { project: Project }).project;
    project = (await mcp<{ project: Project }>('apply_design_system', { id, projectId: project.id, expectedRevision: project.revision, version: 1 })).project;
    assert.equal(project.revision, 2); assert.equal(project.document.designSystem!.version, 1);
    project = (await cli<{ project: Project }>('design-systems', 'insert', id, project.id, '--revision', '2', '--page', project.document.pages[0].id, '--item', 'primary-action')).project;
    assert.equal(project.revision, 3); assert.equal(project.document.pages[0].nodes.at(-1)!.component!.props!.label, 'Shared action');

    const bundled = await build({ stdin: { contents: `import { registerDesignTools } from './src/app/browser-design-tools';
      export function initialize(document) {
        globalThis.openDocument = document; globalThis.registry = new Map();
        globalThis.unregisterTools = registerDesignTools({ registerTool: tool => globalThis.registry.set(tool.name, tool), unregisterTool: name => globalThis.registry.delete(name) }, () => globalThis.openDocument, next => { globalThis.openDocument = next; });
      }`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'studioTools', platform: 'browser' });
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.context().addCookies([{ name: 'studio_session', value: cookie.slice(cookie.indexOf('=') + 1), url: baseUrl }]);
    await page.goto(baseUrl + '/api/health'); await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.evaluate(document => (globalThis as any).studioTools.initialize(document), project.document);
    const browserTool = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      const result = await page.evaluate(async ({ name, args }) => {
        const tool = (globalThis as any).registry.get(name); if (!tool) throw new Error(`Tool not registered: ${name}`); return await tool.execute(args);
      }, { name, args });
      assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text) as T;
    };
    assert.deepEqual((await browserTool<{ system: DesignSystem }>('studio_api_get_design_systems_id', { parameters: { id } })).system, updated.system);
    const browserDefinition = { ...revised, name: 'Updated through browser tool' };
    const browserUpdate = await browserTool<{ system: DesignSystem }>('studio_api_put_design_systems_id', { parameters: { id }, body: { expectedVersion: 2, definition: browserDefinition } });
    assert.equal(browserUpdate.system.version, 3);
    assert.deepEqual((await cli<{ system: DesignSystem }>('design-systems', 'get', id)).system, browserUpdate.system);
    project = (await browserTool<{ project: Project }>('studio_api_post_design_systems_id_apply', { parameters: { id }, body: { projectId: project.id, expectedRevision: 3 } })).project;
    assert.equal(project.revision, 4); assert.equal(project.document.designSystem!.version, 3);
    project = (await browserTool<{ project: Project }>('studio_api_post_design_systems_id_insert', { parameters: { id }, body: { projectId: project.id, expectedRevision: 4, pageId: project.document.pages[0].id, itemId: 'primary-action' } })).project;
    assert.equal(project.revision, 5);
    const stale = await mcpRaw('apply_design_system', { id, projectId: project.id, expectedRevision: 3 });
    assert.equal(stale.isError, true); assert.equal(JSON.parse(stale.content[0].text).error.code, 'revision_conflict');
    assert.deepEqual((await (await request(`/api/projects/${project.id}`)).json() as { project: Project }).project, project);

    const fonts = await mcp<FontCatalog>('list_google_fonts', { query: 'Roboto' });
    assert.deepEqual(fonts.fonts.map(font => font.family), ['Roboto', 'Roboto Mono']);
    assert.deepEqual(await cli('fonts', '--query', 'Roboto'), fonts);
    assert.deepEqual(await browserTool('studio_api_get_fonts', { query: { q: 'Roboto' } }), fonts);
    const models = await mcp<ModelCatalog>('list_provider_models', { provider: 'openai', query: 'mini' });
    assert.equal(models.source, 'fallback'); assert.deepEqual(models.models.map(model => model.id), ['gpt-4.1-mini']);
    assert.deepEqual(await cli('providers', 'models', 'openai', '--query', 'mini'), models);
    assert.deepEqual(await browserTool('studio_api_get_providers_provider_models', { parameters: { provider: 'openai' }, query: { q: 'mini' } }), models);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const uploaded = await browserTool<{ asset: { id: string; url: string; name: string; mimeType: string } }>('studio_api_post_projects_id_assets', { parameters: { id: project.id }, body: { name: 'browser-upload.png', mimeType: 'image/png', base64: png.toString('base64') } });
    assert.equal(uploaded.asset.name, 'browser-upload.png'); assert.equal(uploaded.asset.mimeType, 'image/png');
    const downloaded = await request(uploaded.asset.url); assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
    const assets = await browserTool<{ assets: { id: string }[] }>('studio_api_get_projects_id_assets', { parameters: { id: project.id } }); assert.ok(assets.assets.some(asset => asset.id === uploaded.asset.id));
    assert.equal(await page.evaluate(() => { const state = globalThis as any; state.unregisterTools(); return state.registry.size; }), 0);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    database.close(); await rm(directory, { recursive: true, force: true });
  }
});
