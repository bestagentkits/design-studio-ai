import assert from 'node:assert/strict';
import { once } from 'node:events';
import { build } from 'esbuild';
import { serve } from '@hono/node-server';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { z } from 'zod';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { McpServer as LegacyServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { probeClient } from './mcp-client.mjs';

function register(server) {
  server.registerTool('sum', { inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
  return server;
}
const handlers = Object.fromEntries(['json', 'sse'].map(responseMode => [responseMode,
  createMcpHandler(() => register(new McpServer({ name: 'probe', version: '1' })), { responseMode, legacy: 'reject' })]));
const server = serve({ port: 18840, hostname: '127.0.0.1', fetch: async request => {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/legacy')) {
    const mcp = register(new LegacyServer({ name: 'legacy-probe', version: '1' }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: path.endsWith('json') });
    await mcp.connect(transport);
    const response = await transport.handleRequest(request);
    // Buffer the isolated response before closing the per-request legacy server.
    const bytes = await response.arrayBuffer();
    await mcp.close();
    return new Response(bytes.byteLength ? bytes : null, { status: response.status, headers: response.headers });
  }
  return handlers[path.endsWith('sse') ? 'sse' : 'json'].fetch(request);
}});
await once(server, 'listening');
console.log(JSON.stringify({ process: process.pid, port: 18840, cwd: process.cwd() }));
let runtime;
try {
  const worker = await build({ stdin: {
    contents: "import { probeClient } from './mcp-client.mjs'; export default { async fetch(request) { const {endpoint,modern}=await request.json(); try{return Response.json(await probeClient(endpoint,modern));}catch(error){return Response.json({error:error.message},{status:500});} } };",
    resolveDir: new URL('.', import.meta.url).pathname, sourcefile: 'probe-worker.mjs',
  }, bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['workerd'], external: ['node:*'], minify: true });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'], script: worker.outputFiles[0].text }));
  console.log(JSON.stringify({ workerBundleBytes: worker.outputFiles[0].contents.length }));
  for (const modern of [false, true]) for (const encoding of ['json', 'sse']) {
    const endpoint = `http://127.0.0.1:18840/${modern ? 'modern' : 'legacy'}/${encoding}`;
    const started = performance.now();
    const node = await probeClient(endpoint, modern);
    const response = await runtime.dispatchFetch('http://probe.test', { method: 'POST', body: JSON.stringify({ endpoint, modern }) });
    const workerd = await response.json();
    assert.equal(response.status, 200, JSON.stringify(workerd));
    assert.deepEqual(workerd, node);
    console.log(JSON.stringify({ encoding, node, workerd, elapsedMs: Math.round(performance.now() - started) }));
  }
  await assert.rejects(probeClient('http://127.0.0.1:18840/legacy/json', true));
  console.log('Pinned modern client rejects legacy-only endpoint. OAuth and deployed-edge egress remain unverified.');
} finally {
  await runtime?.dispose();
  for (const handler of Object.values(handlers)) await handler.close();
  await new Promise(resolve => server.close(resolve));
}
