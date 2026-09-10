import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const endpoint = 'https://beta.studio.agentkit.best/api/health';
const common = `
const endpoint = ${JSON.stringify(endpoint)};
function check(value, message) { if (!value) throw new Error(message); }
async function rejected(run, pattern) {
  try { await run(); } catch (error) { check(pattern.test(error.message), 'Unexpected failure: ' + error.message); return error.message; }
  throw new Error('Expected rejection did not occur');
}
async function runPublic(factory) {
  const start = performance.now();
  const response = await factory({ timeoutMs: 20000 })(new Request(endpoint));
  check(response.status === 200, 'Health HTTP response was not 200');
  const text = await response.text();
  const parsed = JSON.parse(text);
  check(parsed.ok === true, 'Health JSON was not healthy');
  check(response.bodyUsed, 'Response stream was not consumed');
  const capError = await rejected(async () => {
    const limited = await factory({ timeoutMs: 20000, maxResponseBytes: 1 })(endpoint);
    await limited.text();
  }, /response body exceeds limit/);
  return { status: response.status, jsonHealthy: parsed.ok, bodyBytes: new TextEncoder().encode(text).length, fullyConsumed: response.bodyUsed, capError, elapsedMs: Math.round(performance.now() - start) };
}
async function runFixtures() {
  let cancellationCount = 0;
  const oversized = createConnectorFetch({ runtime: 'workers-public', limits: { maxResponseBytes: 2 }, transport: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancellationCount++; }
  }, { highWaterMark: 0 })) });
  const streamCapError = await rejected(async () => (await oversized(endpoint)).arrayBuffer(), /body exceeds limit/);
  const stalled = createConnectorFetch({ runtime: 'workers-public', limits: { timeoutMs: 25 }, transport: async () => new Response(new ReadableStream({ cancel() { cancellationCount++; } })) });
  const deadlineError = await rejected(async () => (await stalled(endpoint)).text(), /timed out/);
  check(cancellationCount === 2, 'Fixture streams did not cancel');
  return { streamCapError, deadlineError, cancellationCount, kind: 'trusted in-memory stream fixtures; no egress evidence' };
}
`;
const nodeBundle = await build({ stdin: {
  contents: "import { createNodeConnectorFetch } from './server/connector-transport-node.ts'; import { createConnectorFetch } from './server/connector-transport.ts';" + common + `
export async function run() {
  const live = await runPublic(createNodeConnectorFetch);
  const privateDnsError = await rejected(() => createNodeConnectorFetch(undefined, async () => [{address:'127.0.0.1',family:4}])(endpoint), /DNS must resolve exclusively/);
  const mixedDnsError = await rejected(() => createNodeConnectorFetch(undefined, async () => [{address:'1.1.1.1',family:4},{address:'::1',family:6}])(endpoint), /DNS must resolve exclusively/);
  return { live, privateDnsError, mixedDnsError, fixtures: await runFixtures() };
}`,
  resolveDir: process.cwd(), sourcefile: 'connector-node-runtime-probe.mjs',
}, bundle: true, write: false, platform: 'node', format: 'esm' });
const nodeModule = await import(`data:text/javascript;base64,${Buffer.from(nodeBundle.outputFiles[0].contents).toString('base64')}`);
console.log(JSON.stringify({ nodeVersion: process.version, pid: process.pid, cwd: process.cwd(), endpoint }));
const nodeResult = await nodeModule.run();
console.log(JSON.stringify({ runtime: 'Node pinned HTTPS', ...nodeResult }));

const workerBundle = await build({ stdin: {
  contents: "import { createWorkersConnectorFetch, createConnectorFetch } from './server/connector-transport.ts';" + common + `
export default { async fetch() { try { return Response.json({live:await runPublic(createWorkersConnectorFetch), fixtures:await runFixtures()}); } catch(error) { return Response.json({error:error.message},{status:500}); } } };
`, resolveDir: process.cwd(), sourcefile: 'connector-workerd-runtime-probe.mjs',
}, bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['workerd'], minify: true });
let runtime;
try {
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    script: workerBundle.outputFiles[0].text,
  }));
  const response = await runtime.dispatchFetch('http://probe.test');
  const workerdResult = await response.json();
  assert.equal(response.status, 200, JSON.stringify(workerdResult));
  assert.equal(workerdResult.live.status, nodeResult.live.status);
  assert.equal(workerdResult.live.jsonHealthy, nodeResult.live.jsonHealthy);
  assert.equal(workerdResult.live.bodyBytes, nodeResult.live.bodyBytes);
  assert.deepEqual(workerdResult.fixtures, nodeResult.fixtures);
  console.log(JSON.stringify({ runtime: 'local workerd native public fetch', bundleBytes: workerBundle.outputFiles[0].contents.length, ...workerdResult }));
} finally {
  await runtime?.dispose();
  console.log('Local workerd disposed; no deployed Worker or application state changed.');
}
