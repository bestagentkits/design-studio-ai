import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { lookup } from 'node:dns/promises';
import { isPublicConnectorAddress, assertPublicConnectorAddresses, validateConnectorUrl } from '../server/connector-network-policy';
import { createConnectorFetch } from '../server/connector-transport';
import { createNodeConnectorFetch } from '../server/connector-transport-node';
const endpoint = 'https://connector.vendor.net/mcp';
const bytes = (text: string) => new TextEncoder().encode(text);

test('public address policy rejects special, mapped, transition and noncanonical addresses', () => {
  for (const value of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicConnectorAddress(value), true, value);
  for (const value of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.31.255.255', '192.0.0.9', '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.1', '192.168.1.1', '192.175.48.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '01.1.1.1', '256.1.1.1', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::808:808', '100::1', '2001::1', '2001:db8::1', '2002:0808:0808::1', '3fff::1', 'fc00::1', 'fe80::1', 'ff00::1', 'fe80::1%en0', 'junk']) assert.equal(isPublicConnectorAddress(value), false, value);
  assert.throws(() => assertPublicConnectorAddresses([]), /DNS/);
  assert.throws(() => assertPublicConnectorAddresses([{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }]), /DNS/);
  assert.throws(() => assertPublicConnectorAddresses([{ address: '8.8.8.8', family: 6 }]), /DNS/);
});

test('URL policy rejects aliases, local names and credential query variants', () => {
  for (const value of ['http://vendor.net', 'https://user:pass@vendor.net', 'https://vendor.net/#', 'https://localhost', 'https://service.internal', 'https://service.local.', 'https://metadata', 'https://0177.0.0.1', 'https://2130706433', 'https://[::ffff:127.0.0.1]', 'https://vendor.net/?access_token=x', 'https://vendor.net/?X-Amz-Credential=x', 'https://vendor.net/?X-Goog-Signature=x', 'https://vendor.net/?sig=x', 'https://vendor.net/?code=x', 'https://vendor.net/?api%5Fkey=x']) assert.throws(() => validateConnectorUrl(value), /Connector|Invalid/, value);
  assert.equal(validateConnectorUrl('https://vendor.net./mcp?page=2').href, 'https://vendor.net/mcp?page=2');
});

test('SDK Request and init overrides preserve method, authorization and manual redirect', async () => {
  let calls = 0;
  const fetcher = createConnectorFetch({ runtime: 'workers-public', transport: async (url, init) => {
    calls++; assert.equal(String(url), endpoint); assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer isolated-test-value');
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
    assert.equal(new TextDecoder().decode(init?.body as Uint8Array), 'replacement');
    return Response.json({ ok: true });
  } });
  const response = await fetcher(new Request(endpoint, { method: 'POST', body: 'original' }), { body: 'replacement', headers: { authorization: 'Bearer isolated-test-value' } });
  assert.deepEqual(await response.json(), { ok: true }); assert.equal(calls, 1);
});

test('forbidden headers and request limits stop before sending', async () => {
  let calls = 0;
  const fetcher = createConnectorFetch({ runtime: 'workers-public', limits: { maxRequestBytes: 4, maxHeaderBytes: 100 }, transport: async () => { calls++; return new Response('ok'); } });
  for (const header of ['Host', 'Cookie', 'Proxy-Authorization', 'Connection', 'X-Forwarded-Host', 'Content-Length']) await assert.rejects(fetcher(endpoint, { headers: { [header]: 'value' } }), /Forbidden/);
  await assert.rejects(fetcher(endpoint, { headers: { 'x-padding': 'x'.repeat(101) } }), /headers/);
  await assert.rejects(fetcher(endpoint, { method: 'POST', body: '12345' }), /body/);
  assert.equal(calls, 0);
});

test('redirect, response header and advertised body caps cancel upstream', async () => {
  for (const kind of ['redirect', 'headers', 'length', 'encoding']) {
    let cancelled = false;
    const fetcher = createConnectorFetch({ runtime: 'workers-public', limits: { maxHeaderBytes: 100, maxResponseBytes: 4 }, transport: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: kind === 'redirect' ? 302 : 200,
      headers: kind === 'redirect' ? { location: 'https://other.net/steal' } : kind === 'headers' ? { 'x-padding': 'x'.repeat(101) } : kind === 'length' ? { 'content-length': '5' } : { 'content-encoding': 'gzip' },
    }) });
    await assert.rejects(fetcher(endpoint)); assert.equal(cancelled, true, kind);
  }
});

test('response stream is incremental and cancels at actual byte limit', async () => {
  let cancelled = false, sends = 0;
  const fetcher = createConnectorFetch({ runtime: 'workers-public', limits: { maxResponseBytes: 4 }, transport: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(bytes(++sends === 1 ? '123' : '45')); }, cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await fetcher(endpoint); const reader = response.body!.getReader();
  assert.equal(sends, 0); assert.equal(new TextDecoder().decode((await reader.read()).value), '123');
  await assert.rejects(reader.read(), /body exceeds/); assert.equal(cancelled, true);
});

test('deadline covers stalled request bodies, headers and response streams', async () => {
  for (const phase of ['request', 'headers', 'response']) {
    let cancelled = false, aborted = false;
    const fetcher = createConnectorFetch({ runtime: 'workers-public', limits: { timeoutMs: 20 }, transport: async (_url, init) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      if (phase === 'headers') return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    } });
    const request = phase === 'request' ? new Request(endpoint, { method: 'POST', body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' } as RequestInit) : endpoint;
    if (phase === 'response') await assert.rejects((await fetcher(request)).text(), /timed out/);
    else await assert.rejects(fetcher(request), /timed out/);
    if (phase !== 'headers') assert.equal(cancelled, true, phase);
    if (phase !== 'request') assert.equal(aborted, true, phase);
  }
});

test('early cancellation and caller abort stop underlying streams without exposing reasons', async () => {
  let cancelled = false, signal: AbortSignal | undefined;
  const fetcher = createConnectorFetch({ runtime: 'workers-public', transport: async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  await (await fetcher(endpoint)).body!.cancel(); assert.equal(cancelled, true); assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  const response = await fetcher(endpoint, { signal: controller.signal });
  controller.abort(new Error('private-token-value'));
  await assert.rejects(response.text(), error => !String(error).includes('private-token-value'));
  const throwing = createConnectorFetch({ runtime: 'workers-public', transport: async () => { throw new Error('https://secret:user@host'); } });
  await assert.rejects(throwing(endpoint), error => !String(error).includes('secret'));
});

test('Node DNS mixed address set rejects without connecting and resolves each new request', async () => {
  let calls = 0;
  const resolver = (async () => { calls++; return [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]; }) as unknown as typeof lookup;
  const fetcher = createNodeConnectorFetch(undefined, resolver);
  await assert.rejects(fetcher(endpoint), /DNS/); await assert.rejects(fetcher(endpoint), /DNS/);
  assert.equal(calls, 2);
});

test('real isolated HTTP peer streams SSE and receives no redirected credential request', async () => {
  let targetCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: '/target' }); response.end(); }
    else if (request.url === '/target') { targetCalls++; response.end('unexpected'); }
    else { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: 42\n\n'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  // Trusted test adapter maps already validated public URLs to a loopback fixture, never production policy.
  const fetcher = createConnectorFetch({ runtime: 'workers-public', transport: async (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init) });
  try {
    assert.equal(await (await fetcher(endpoint)).text(), 'data: 42\n\n');
    await assert.rejects(fetcher('https://connector.vendor.net/redirect', { headers: { authorization: 'Bearer test-only' } }), /redirects/);
    assert.equal(targetCalls, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

 test('unread responses expire and a late adapter response is cancelled', async () => {
  let cancelled = 0;
  const fetcher = createConnectorFetch({ runtime: 'workers-public', limits: { timeoutMs: 15 }, transport: async () => new Response(new ReadableStream({ cancel() { cancelled++; } })) });
  const response = await fetcher(endpoint);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(cancelled, 1);
  await assert.rejects(response.text(), /timed out/);
  const late = createConnectorFetch({ runtime: 'workers-public', limits: { timeoutMs: 15 }, transport: async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  } });
  await assert.rejects(late(endpoint), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(cancelled, 2);
});
