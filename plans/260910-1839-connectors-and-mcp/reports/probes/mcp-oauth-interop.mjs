import assert from 'node:assert/strict';
import { once } from 'node:events';
import { build } from 'esbuild';
import { serve } from '@hono/node-server';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createOAuthPeer } from './mcp-oauth-peer.mjs';
import { probeOAuth } from './mcp-oauth-client.mjs';
const origin = 'http://127.0.0.1:18845';
const peer = createOAuthPeer(origin);
const server = serve({ hostname: '127.0.0.1', port: 18845, overrideGlobalObjects: false, fetch: peer.fetch });
await once(server, 'listening');
console.log(JSON.stringify({ pid: process.pid, port: 18845, cwd: process.cwd(), node: process.version }));
let runtime;
try {
  const node = await probeOAuth(origin);
  console.log(JSON.stringify({ runtime: 'Node', ...node }));
  const worker = await build({ stdin: {
    contents: "import { probeOAuth } from './mcp-oauth-client.mjs'; export default { async fetch() { try { return Response.json(await probeOAuth('http://127.0.0.1:18845')); } catch(error) { return Response.json({error:error.message,stack:error.stack},{status:500}); } } };",
    resolveDir: new URL('.', import.meta.url).pathname, sourcefile: 'oauth-worker.mjs',
  }, bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['workerd'], external: ['node:*'], minify: true });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'], script: worker.outputFiles[0].text }));
  const response = await runtime.dispatchFetch('http://probe.test');
  const workerd = await response.json();
  assert.equal(response.status, 200, JSON.stringify(workerd));
  assert.deepEqual(workerd, node);
  assert.equal(peer.counts.pkce, 2);
  assert.equal(peer.counts.refresh, 2);
  assert.equal(peer.counts.rejectedGrant, 8);
  console.log(JSON.stringify({ runtime: 'local-workerd', ...workerd, bundleBytes: worker.outputFiles[0].contents.length, peerCounts: peer.counts }));
} finally {
  await runtime?.dispose(); await peer.close();
  await new Promise(resolve => server.close(resolve));
  console.log('Isolated peer and workerd stopped.');
}
