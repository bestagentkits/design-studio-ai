import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// An isolated listener owned by this probe; no user service is contacted.
const port = 18839;
const server = http.createServer((_request, response) => response.end('isolated-probe'));
server.listen(port, '127.0.0.1');
await once(server, 'listening');
console.log(JSON.stringify({ process: process.pid, port, cwd: process.cwd() }));
let runtime;
try {
  let nodeLookupCalls = 0;
  const nodeResult = await new Promise((resolve, reject) => {
    http.get(`http://probe.invalid:${port}`, {
      lookup(_host, _options, callback) {
        nodeLookupCalls++;
        callback(new Error('connection-time-policy-denied'));
      },
    }, resolve).on('error', error => resolve(error.message));
  });
  assert.equal(nodeResult, 'connection-time-policy-denied');
  assert.equal(nodeLookupCalls, 1);
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-09-07',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    script: `import http from 'node:http';
      export default { async fetch() {
        let lookupCalls = 0;
        const result = await new Promise(resolve => {
          http.get('http://localhost:${port}', {
            lookup(_host, _options, callback) { lookupCalls++; callback(new Error('connection-time-policy-denied')); }
          }, response => { response.resume(); response.on('end', () => resolve({ status: response.statusCode })); })
          .on('error', error => resolve({ error: error.message }));
        }).catch(error => ({ error: error.message }));
        return Response.json({ lookupCalls, result });
      }};`,
  }));
  const workerResult = await (await runtime.dispatchFetch('http://probe.test')).json();
  console.log(JSON.stringify({ node: { lookupCalls: nodeLookupCalls, result: nodeResult }, workerd: workerResult }));
  console.log('Local workerd results do not establish deployed Cloudflare edge egress guarantees.');
} finally {
  await runtime?.dispose();
  await new Promise(resolve => server.close(resolve));
}
