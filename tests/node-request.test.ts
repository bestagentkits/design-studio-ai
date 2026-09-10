import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { materializeNodeRequest } from '../server/node-request';

async function setup(t: TestContext) {
  const NativeResponse = globalThis.Response, NativeRequest = globalThis.Request;
  const app = new Hono();
  const failures: Error[] = [];
  let handlers = 0;
  app.onError((error, c) => { failures.push(error); return c.json({ error: 'unexpected' }, 500); });
  app.use('*', bodyLimit({ maxSize: 8, onError: c => c.json({ error: 'body_too_large' }, 413) }));
  app.all('*', async c => {
    handlers++;
    return c.json({ method: c.req.method, text: await c.req.text(), marker: c.req.header('x-test-marker'), transfer: c.req.header('transfer-encoding') ?? null });
  });
  const server = serve({ hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false, fetch: request => app.fetch(materializeNodeRequest(request)) });
  t.after(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if ('closeAllConnections' in server) server.closeAllConnections();
    await closed;
  });
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, NativeResponse, NativeRequest, failures, handlers: () => handlers };
}

// node:http writes actual chunked socket traffic without fetch adding Content-Length.
async function streamedRequest(base: string, method: string, chunks: string[], chunked = true) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(base, { method, agent: false, headers: { 'x-test-marker': 'preserved', ...(chunked ? { 'transfer-encoding': 'chunked' } : {}) } }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body })); response.on('error', reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error('HTTP probe timed out')));
    request.on('error', reject);
    void (async () => {
      for (const chunk of chunks) { request.write(chunk); await new Promise<void>(resolve => setImmediate(resolve)); }
      request.end();
    })().catch(reject);
  });
}

test('bodyless DELETE survives body-limit reconstruction and preserves native fetch classes', async t => {
  const { base, NativeResponse, NativeRequest, failures } = await setup(t);
  const deleted = await streamedRequest(base, 'DELETE', [], false);
  assert.equal(deleted.status, 200);
  assert.deepEqual(JSON.parse(deleted.body), { method: 'DELETE', text: '', marker: 'preserved', transfer: null });
  assert.equal(globalThis.Response, NativeResponse); assert.equal(globalThis.Request, NativeRequest);
  const response = await fetch(base);
  assert.ok(response instanceof NativeResponse); assert.ok(response instanceof Response);
  assert.equal(response.status, 200); assert.equal((await response.json() as { method: string }).method, 'GET');
  assert.deepEqual(failures, []);
});

test('chunked DELETE and POST preserve bounded streamed bodies and headers', async t => {
  const { base, failures } = await setup(t);
  for (const method of ['DELETE', 'POST']) {
    const result = await streamedRequest(base, method, ['123', '45678']);
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { method, text: '12345678', marker: 'preserved', transfer: 'chunked' });
  }
  assert.deepEqual(failures, []);
});

test('chunked over-limit request returns413 before handler execution and server remains usable', async t => {
  const { base, handlers, failures } = await setup(t);
  const result = await streamedRequest(base, 'POST', ['12345', '67890']);
  assert.equal(result.status, 413); assert.deepEqual(JSON.parse(result.body), { error: 'body_too_large' });
  assert.equal(handlers(), 0);
  const next = await streamedRequest(base, 'DELETE', [], false);
  assert.equal(next.status, 200); assert.equal(handlers(), 1); assert.deepEqual(failures, []);
});
