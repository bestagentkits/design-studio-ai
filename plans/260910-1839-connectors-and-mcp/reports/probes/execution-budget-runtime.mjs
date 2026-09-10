import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { connectorToolSchema } from '../../../../src/shared/connectors.ts';
import { boundedConnectorJson } from '../../../../src/shared/connector-values.ts';
import { agentRunLimits } from '../../../../src/shared/agent-runs.ts';

// Scratch-only workload and SQL. No provider or application service is exercised.
const port = 18846, iterations = 20, deadlineMs = 100, peerDelayMs = 300;
const peerOrigin = `http://127.0.0.1:${port}`;
const schema = 'CREATE TABLE steps (id TEXT PRIMARY KEY, status TEXT, revision INTEGER, completed INTEGER, lease TEXT)';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function workloads() {
  const inputSchema = { type: 'object', properties: { query: { type: 'string' } }, description: '' };
  inputSchema.description = 'x'.repeat(65536 - JSON.stringify(inputSchema).length);
  const tools = Array.from({ length: agentRunLimits.advertisedTools }, (_, index) => ({
    connectionId: 'probe', remoteName: `tool-${index}`, description: 'Isolated schema budget exercise',
    fingerprint: 'a'.repeat(64), inputSchema, effect: 'unknown',
  }));
  const response = { content: [{ type: 'text', text: '' }] };
  response.content[0].text = 'x'.repeat(agentRunLimits.toolResponseBytes - JSON.stringify(response).length);
  const manyValues = Array.from({ length: 19000 }, () => 'x'.repeat(51));
  return { tools: JSON.stringify(tools), response: JSON.stringify(response), manyValues: JSON.stringify(manyValues) };
}
function benchmark(payload, count) {
  const toolsSchema = connectorToolSchema.array().max(agentRunLimits.advertisedTools);
  const resultSchema = boundedConnectorJson(agentRunLimits.toolResponseBytes);
  for (let index = 0; index < count; index++) {
    toolsSchema.parse(JSON.parse(payload.tools));
    resultSchema.parse(JSON.parse(payload.response));
    resultSchema.parse(JSON.parse(payload.manyValues));
  }
  const extraTool = JSON.parse(payload.tools); extraTool.push(extraTool[0]);
  if (toolsSchema.safeParse(extraTool).success) throw new Error('Tool-count boundary accepted overflow');
  const oversized = JSON.parse(payload.response); oversized.content[0].text += 'x';
  if (resultSchema.safeParse(oversized).success) throw new Error('Byte boundary accepted overflow');
  if (resultSchema.safeParse(Array(20001).fill(null)).success) throw new Error('Traversal boundary accepted overflow');
  return { iterations: count, overflowRejected: ['21 tools', '1048577 JSON bytes', '20001 array values'] };
}
async function advance(db, { id, revision, slow }) {
  const lease = crypto.randomUUID();
  const claimed = await db.all("UPDATE steps SET status='running',lease=?,revision=revision+1 WHERE id=? AND revision=? AND status IN ('pending','ready') RETURNING id", [lease, id, revision]);
  if (!claimed.length) return { claimed: false };
  const started = Date.now();
  let status;
  try {
    const response = await fetch(`${peerOrigin}/${slow ? 'slow' : 'fast'}`, { signal: AbortSignal.timeout(deadlineMs), redirect: 'manual' });
    if (response.status !== 200) throw new Error('Peer rejected request');
    await response.text();
    status = 'ready';
  } catch { status = 'outcome_unknown'; }
  // A deadline cannot prove a remote write did not happen. Never replay it automatically.
  await db.all('UPDATE steps SET status=?,completed=completed+?,lease=NULL,revision=revision+1 WHERE id=? AND lease=? AND revision=? RETURNING id', [status, status === 'ready' ? 1 : 0, id, lease, revision + 1]);
  return { claimed: true, elapsedMs: Date.now() - started, ...(await db.all('SELECT status,revision,completed FROM steps WHERE id=?', [id]))[0] };
}

let received = 0, completed = 0;
const timers = new Set();
const server = createServer((request, response) => {
  received++;
  const finish = () => { completed++; if (!response.destroyed) response.end('isolated peer completed'); };
  if (request.url === '/slow') {
    const timer = setTimeout(() => { timers.delete(timer); finish(); }, peerDelayMs); timers.add(timer);
  } else finish();
});
// Binding fails on an occupied reserved port; it never reuses or kills another listener.
server.listen(port, '127.0.0.1');
await once(server, 'listening');
console.log(JSON.stringify({ process: process.pid, port, worktree: process.cwd() }));
const sqlite = new DatabaseSync(':memory:');
const nodeDb = { all: async (sql, args) => sqlite.prepare(sql).all(...args) };
let runtime;
try {
  const payload = workloads();
  const worker = await build({ stdin: {
    contents: `import { connectorToolSchema } from '../../../../src/shared/connectors.ts';
      import { boundedConnectorJson } from '../../../../src/shared/connector-values.ts';
      import { agentRunLimits } from '../../../../src/shared/agent-runs.ts';
      const peerOrigin=${JSON.stringify(peerOrigin)}, deadlineMs=${deadlineMs};
      ${benchmark.toString()}
      ${advance.toString()}
      export default { async fetch(request,env) {
        const input=await request.json();
        if(new URL(request.url).pathname==='/benchmark') return Response.json(benchmark(input.payload,input.count));
        const db={all:async(sql,args)=>(await env.DB.prepare(sql).bind(...args).all()).results};
        return Response.json(await advance(db,input));
      }};`, resolveDir: new URL('.', import.meta.url).pathname, sourcefile: 'execution-budget-worker.mjs',
  }, bundle: true, write: false, platform: 'browser', format: 'esm', conditions: ['workerd'], minify: true });
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], script: worker.outputFiles[0].text }));
  await runtime.ready;
  const workerCall = async (path, input) => {
    const response = await runtime.dispatchFetch(`http://budget.test/${path}`, { method: 'POST', body: JSON.stringify(input) });
    assert.equal(response.status, 200); return response.json();
  };
  benchmark(payload, 1); await workerCall('benchmark', { payload, count: 1 });
  const cpuStart = process.cpuUsage(), heapStart = process.memoryUsage().heapUsed, started = performance.now();
  const nodeResult = benchmark(payload, iterations);
  const nodeMs = performance.now() - started, nodeCpu = process.cpuUsage(cpuStart), heapDelta = process.memoryUsage().heapUsed - heapStart;
  const workerStarted = performance.now();
  const workerResult = await workerCall('benchmark', { payload, count: iterations });
  const workerMs = performance.now() - workerStarted;
  assert.deepEqual(nodeResult, workerResult);
  console.log(JSON.stringify({ benchmark: { runtime: process.version, iterations, payloadBytes: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Buffer.byteLength(value)])), inputSchemaBytes: 65536, workerBundleBytes: worker.outputFiles[0].contents.length,
    node: { elapsedMs: nodeMs, cpuUserMs: nodeCpu.user / 1000, cpuSystemMs: nodeCpu.system / 1000, heapUsedDeltaBytes: heapDelta }, localWorkerd: { roundTripMs: workerMs }, ...nodeResult } }));
  sqlite.exec(schema);
  const d1 = await runtime.getD1Database('DB'); await d1.exec(schema);
  async function checkSteps(label, seed, call) {
    await seed('normal'); await seed('interrupted');
    const first = await call({ id: 'normal', revision: 1 });
    assert.equal(first.status, 'ready'); assert.equal(first.completed, 1); assert.equal(first.revision, 3);
    const receivedAfterFirst = received; await sleep(30);
    assert.equal(received, receivedAfterFirst, 'No implicit background continuation');
    assert.equal((await call({ id: 'normal', revision: 1 })).claimed, false, 'Stale continuation blocked');
    const second = await call({ id: 'normal', revision: 3 });
    assert.equal(second.completed, 2); assert.equal(second.revision, 5);
    const timeout = await call({ id: 'interrupted', revision: 1, slow: true });
    assert.equal(timeout.status, 'outcome_unknown'); assert.equal(timeout.completed, 0);
    const receivedAfterAbort = received;
    assert.equal((await call({ id: 'interrupted', revision: 3, slow: true })).claimed, false);
    await sleep(peerDelayMs + 30);
    assert.equal(received, receivedAfterAbort, 'Unknown external effect cannot replay');
    assert.equal(completed, received, 'Peer can finish after caller aborts');
    return { runtime: label, first, second, timeout, staleContinuationRejected: true, unknownReplayRejected: true, noBackgroundContinuation: true, peerCompletesAfterAbort: true };
  }
  console.log(JSON.stringify(await checkSteps('Node + SQLite', async id => sqlite.prepare("INSERT INTO steps VALUES(?,'pending',1,0,NULL)").run(id), input => advance(nodeDb, input))));
  console.log(JSON.stringify(await checkSteps('local workerd + D1', async id => d1.prepare("INSERT INTO steps VALUES(?,'pending',1,0,NULL)").bind(id).run(), input => workerCall('advance', input))));
  console.log(JSON.stringify({ deadlineMs, peerDelayMs, peerRequests: received, peerCompletions: completed, limits: agentRunLimits }));
} finally {
  await runtime?.dispose(); sqlite.close();
  for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
