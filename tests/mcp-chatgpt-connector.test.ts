import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import { supportedProtocolVersions } from '../server/mcp-protocol';
import { inputJsonSchema } from '../server/mcp-tool-schemas';
import { documentSchema } from '../src/shared/schema';
import { version as packageVersion } from '../package.json';
import type { Bindings } from '../server/types';
import { builtStaticAssets } from './built-static-assets';

// Ajv validates advertised schemas as clients do; its 2020-12 build is resolved by package export name.
const require = createRequire(import.meta.url);
const Ajv = require('ajv').default as new (options: object) => { compile(schema: unknown): unknown };
const Ajv2020 = require('ajv/dist/2020').default as typeof Ajv;

type Rpc = { jsonrpc: string; id?: string | number | null; result?: Record<string, any>; error?: { code: number; message: string; data?: any } };
const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'openai-mcp', version: '1.0.0' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const discoveryBudgetBytes = 256 * 1024;
const schemaAnswerBudgetBytes = 24 * 1024;

test('a hosted connector authorizes with OAuth, discovers the catalog and calls tools on both MCP eras', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'design-studio-mcp-connector-'));
  const db = new SqliteDatabase(join(dir, 'studio.db'));
  try {
    for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    const env: Bindings = { ASSETS: builtStaticAssets, DB: db, ASSETS_BUCKET: new FileBucket(join(dir, 'assets')), APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
    const call = (path: string, init: RequestInit = {}) => app.request(`https://studio.example${path}`, init, env);
    const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
      call(path, { method, headers: { 'Content-Type': 'application/json', Origin: 'https://studio.example', ...headers }, body: JSON.stringify(body) });
    const form = (path: string, body: Record<string, string>, cookie?: string) =>
      call(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://studio.example', ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(body) });

    const registered = await json('/api/auth/register', 'POST', { email: 'connector@example.test', password: 'Isolated connector password 1', name: 'Connector' });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const { project } = await (await json('/api/projects', 'POST', { name: 'Connector project', kind: 'web' }, { Cookie: cookie })).json() as { project: { id: string; revision: number } };

    // ChatGPT registers a client with its connector callback, then completes PKCE consent and token exchange.
    let accessToken = '';
    let refreshToken = '';
    let clientId = '';
    await t.test('OAuth discovery, PKCE token exchange and refresh', async () => {
      const unauthenticated = await call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
      assert.equal(unauthenticated.status, 401);
      const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(unauthenticated.headers.get('www-authenticate') ?? '')?.[1];
      assert.equal(resourceMetadataUrl, 'https://studio.example/.well-known/oauth-protected-resource');
      const resource = await (await call('/.well-known/oauth-protected-resource')).json() as { resource: string; authorization_servers: string[] };
      assert.equal(resource.resource, 'https://studio.example/mcp');
      const server = await (await call('/.well-known/oauth-authorization-server')).json() as { registration_endpoint: string; code_challenge_methods_supported: string[] };
      assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
      const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
      const client = await json('/oauth/register', 'POST', { client_name: 'ChatGPT', redirect_uris: [redirectUri] });
      assert.equal(client.status, 201);
      clientId = (await client.json() as { client_id: string }).client_id;
      const verifier = secret() + 'connector';
      const params = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256', state: 'connector-state', resource: resource.resource, scope: 'studio' };
      const approved = await form('/oauth/authorize', { ...params, decision: 'allow' }, cookie);
      assert.equal(approved.status, 302);
      const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
      const issued = await form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, resource: resource.resource, code, code_verifier: verifier });
      assert.equal(issued.status, 200);
      const tokens = await issued.json() as { access_token: string; refresh_token: string };
      const rotated = await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, resource: resource.resource, refresh_token: tokens.refresh_token });
      assert.equal(rotated.status, 200);
      ({ access_token: accessToken, refresh_token: refreshToken } = await rotated.json() as { access_token: string; refresh_token: string });
      assert.ok(accessToken && refreshToken);
    });

    const mcp = async (body: unknown, headers: Record<string, string> = {}) => {
      const response = await call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${accessToken}`, ...headers }, body: JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, bytes: new TextEncoder().encode(text).byteLength, message: (text ? JSON.parse(text) : null) as Rpc };
    };
    const modern = (id: number, method: string, params: Record<string, unknown> = {}, name?: string) =>
      mcp({ jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}), Origin: 'https://chatgpt.com' });
    const toolText = (message: Rpc) => JSON.parse(message.result!.content[0].text);

    await t.test('2026-07-28 discovery, catalog and tool calls', async () => {
      const discovered = await modern(1, 'server/discover');
      assert.equal(discovered.status, 200);
      assert.equal(discovered.message.result!.resultType, 'complete');
      assert.deepEqual(discovered.message.result!.supportedVersions, supportedProtocolVersions);
      assert.deepEqual(discovered.message.result!.capabilities, { tools: {}, resources: {} });
      assert.deepEqual(discovered.message.result!._meta['io.modelcontextprotocol/serverInfo'], { name: 'design-studio-ai', version: packageVersion });

      const listed = await modern(2, 'tools/list');
      assert.equal(listed.status, 200);
      assert.equal(listed.message.result!.resultType, 'complete');
      assert.ok(listed.bytes < discoveryBudgetBytes, `tools/list is ${listed.bytes} bytes`);
      const tools = listed.message.result!.tools as Array<{ name: string; inputSchema: Record<string, any> }>;
      assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
      const draft7 = new Ajv({ strict: false, validateFormats: false }), draft2020 = new Ajv2020({ strict: false, validateFormats: false });
      for (const tool of tools) {
        assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
        assert.equal(tool.inputSchema.type, 'object', tool.name);
        assert.doesNotThrow(() => (String(tool.inputSchema.$schema).includes('2020-12') ? draft2020 : draft7).compile(tool.inputSchema), tool.name);
      }
      for (const name of ['list_projects', 'get_project', 'list_themes', 'get_tool_schema', 'patch_document']) assert.ok(tools.some(tool => tool.name === name), name);
      assert.match(tools.find(tool => tool.name === 'patch_document')!.inputSchema.properties.operations.description, /get_tool_schema/);

      const projects = await modern(3, 'tools/call', { name: 'list_projects', arguments: {} }, 'list_projects');
      assert.equal(projects.status, 200);
      assert.equal(projects.message.result!.resultType, 'complete');
      assert.ok(toolText(projects.message).projects.some((item: { id: string }) => item.id === project.id));
      const fetched = await modern(4, 'tools/call', { name: 'get_project', arguments: { projectId: project.id } }, 'get_project');
      assert.equal(toolText(fetched.message).project.id, project.id);
      const themes = await modern(5, 'tools/call', { name: 'list_themes', arguments: {} }, 'list_themes');
      assert.ok(toolText(themes.message).themes.length > 0);
    });

    await t.test('2026-07-28 request validation uses modern JSON-RPC errors', async () => {
      const future = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { 'MCP-Protocol-Version': '2099-01-01' });
      assert.equal(future.status, 400);
      assert.equal(future.message.error!.code, -32022);
      assert.deepEqual(future.message.error!.data, { supported: supportedProtocolVersions, requested: '2099-01-01' });
      const mismatchedName = await modern(2, 'tools/call', { name: 'list_themes', arguments: {} }, 'list_projects');
      assert.equal(mismatchedName.status, 400);
      assert.equal(mismatchedName.message.error!.code, -32020);
      const encodedName = await modern(3, 'tools/call', { name: 'list_themes', arguments: {} }, `=?base64?${btoa('list_themes')}?=`);
      assert.equal(encodedName.status, 200);
      const missingMethod = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: modernMeta } }, { 'MCP-Protocol-Version': '2026-07-28' });
      assert.equal(missingMethod.message.error!.code, -32020);
      const missingCapabilities = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
      assert.equal(missingCapabilities.status, 400);
      assert.equal(missingCapabilities.message.error!.code, -32602);
      const unknownMethod = await modern(6, 'subscriptions/listen');
      assert.equal(unknownMethod.status, 404);
      assert.equal(unknownMethod.message.error!.code, -32601);
      const evilOrigin = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: { _meta: modernMeta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list', Origin: 'https://evil.example' });
      assert.equal(evilOrigin.status, 403);
      const legacyPerRequest = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } } }, { 'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': 'tools/list' });
      assert.equal(legacyPerRequest.status, 400);
      assert.equal(legacyPerRequest.message.error!.code, -32022);
      const notification = await mcp({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'notifications/cancelled' });
      assert.equal(notification.status, 202);
    });

    await t.test('legacy initialize clients keep the compact catalog and full server validation', async () => {
      const initialized = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } } });
      assert.equal(initialized.status, 200);
      assert.equal(initialized.message.result!.protocolVersion, '2025-06-18');
      for (const version of ['2025-11-25', '2025-06-18', '2025-03-26']) {
        const listed = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': version });
        assert.equal(listed.status, 200, version);
        assert.equal(listed.message.result!.resultType, undefined, version);
        assert.ok(listed.bytes < discoveryBudgetBytes, `${version}: ${listed.bytes} bytes`);
      }
      const legacy = { 'MCP-Protocol-Version': '2025-11-25' };
      const invalid = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'patch_document', arguments: { projectId: project.id, expectedRevision: project.revision, operations: [{ op: 'not-an-operation' }] } } }, legacy);
      assert.equal(invalid.message.result!.isError, true);
      assert.match(invalid.message.result!.content[0].text, /Input validation error: Invalid arguments for tool patch_document/);
      const created = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_project', arguments: { name: 'Created through MCP', document: { not: 'a document' } } } }, legacy);
      assert.equal(created.message.result!.isError, true);
      const valid = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'patch_document', arguments: { projectId: project.id, expectedRevision: project.revision, operations: [{ op: 'rename', name: 'Renamed by connector' }], responseMode: 'summary' } } }, legacy);
      assert.notEqual(valid.message.result!.isError, true, valid.message.result!.content?.[0]?.text);
      assert.equal(toolText(valid.message).project.revision, project.revision + 1);
      // Every answer stays small; a large schema is outlined and its parts are read by JSON Pointer.
      const schemaCall = async (id: number, args: Record<string, unknown>) => {
        const answer = await mcp({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_tool_schema', arguments: args } }, legacy);
        assert.ok(answer.bytes < schemaAnswerBudgetBytes, `get_tool_schema ${JSON.stringify(args)} is ${answer.bytes} bytes`);
        return { result: answer.message.result!, document: toolText(answer.message) };
      };
      const operations = (await schemaCall(6, { tool: 'patch_document', property: 'operations' })).document;
      assert.equal(operations.schema.type, 'array');
      let variants = operations.schema.items;
      if (variants.$pointer) variants = (await schemaCall(7, { tool: 'patch_document', property: 'operations', pointer: variants.$pointer })).document.schema;
      const branches = (variants.oneOf ?? variants.anyOf) as Array<Record<string, any>>;
      assert.ok(branches.length > 1);
      const rename = branches.find(branch => (branch.constants?.op ?? branch.properties?.op?.const) === 'rename')!;
      assert.ok(rename, 'operation variants expose their op discriminator');
      if (rename.$pointer) {
        const full = (await schemaCall(8, { tool: 'patch_document', property: 'operations', pointer: rename.$pointer })).document.schema;
        assert.equal(full.properties.op.const, 'rename');
      }
      const whole = (await schemaCall(9, { tool: 'create_project' })).document;
      assert.deepEqual(whole.compactedProperties, ['document']);
      assert.ok(whole.schema.properties.document);
      const inherited = await schemaCall(10, { tool: 'patch_document', property: 'constructor' });
      assert.equal(inherited.result.isError, true);
      assert.match(inherited.document.error, /has no argument constructor/);
      const missingPointer = await schemaCall(11, { tool: 'patch_document', property: 'operations', pointer: '/nowhere' });
      assert.equal(missingPointer.result.isError, true);
      const unknown = await mcp({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'get_tool_schema', arguments: { tool: 'missing_tool' } } }, legacy);
      assert.equal(unknown.message.result!.isError, true);
    });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('schema conversions are reused across per-request optional wrappers', () => {
  assert.equal(inputJsonSchema(documentSchema.optional()), inputJsonSchema(documentSchema.optional()));
  assert.equal(inputJsonSchema(documentSchema.optional()), inputJsonSchema(documentSchema));
});
