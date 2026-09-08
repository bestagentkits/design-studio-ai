import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// OAuth codes and account credentials must not appear in screenshots or traces.
test.use({ screenshot: 'off', trace: 'off' });

test('browser consent follows a cross-origin callback for allow and deny', async ({ page, baseURL }) => {
  const callbacks: URL[] = [];
  const callbackServer = createServer((request, response) => {
    callbacks.push(new URL(request.url!, 'http://localhost'));
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>OAuth client callback</title>Authorization returned.');
  });
  await new Promise<void>(resolve => callbackServer.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${(callbackServer.address() as AddressInfo).port}/connector/oauth/callback`;
  const violations: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('form-action')) violations.push('form-action blocked navigation');
  });
  try {
    const registration = await page.request.post('/api/auth/register', {
      headers: { Origin: baseURL! },
      data: { email: `oauth-${randomUUID()}@studio.test`, name: 'OAuth browser test', password: randomUUID() + randomUUID() },
    });
    expect(registration.status()).toBe(201);
    const registered = await page.request.post('/oauth/register', {
      headers: { Origin: baseURL! },
      data: { client_name: 'Browser OAuth client', redirect_uris: [redirectUri] },
    });
    expect(registered.status()).toBe(201);
    const client = await registered.json();
    const verifier = randomUUID() + randomUUID();
    const params = {
      client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', state: 'client-state-with-+&=?', resource: `${baseURL}/mcp`, scope: 'studio',
    };
    for (const decision of ['allow', 'deny']) {
      await page.goto(`/oauth/authorize?${new URLSearchParams(params)}`);
      await page.getByRole('button', { name: decision === 'allow' ? 'Allow access' : 'Deny', exact: true }).click();
      await expect.poll(() => violations.length > 0 || callbacks.filter(url => url.pathname === '/connector/oauth/callback').length === (decision === 'allow' ? 1 : 2)).toBe(true);
      expect(violations).toEqual([]);
      await expect.poll(() => callbacks.filter(url => url.pathname === '/connector/oauth/callback').length).toBe(decision === 'allow' ? 1 : 2);
      await expect(page).toHaveTitle('OAuth client callback');
      const callback = callbacks.filter(url => url.pathname === '/connector/oauth/callback').at(-1)!;
      expect(callback.searchParams.get('state')).toBe(params.state);
      if (decision === 'deny') {
        expect(callback.searchParams.get('error')).toBe('access_denied');
        expect(callback.searchParams.has('code')).toBe(false);
        continue;
      }
      expect(callback.searchParams.has('error')).toBe(false);
      const token = await page.request.post(`${baseURL}/oauth/token`, {
        headers: { Origin: baseURL! },
        form: { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: redirectUri,
          code: callback.searchParams.get('code')!, code_verifier: verifier, resource: params.resource },
      });
      expect(token.status()).toBe(200);
      const issued = await token.json();
      const initialized = await page.request.post(`${baseURL}/mcp`, {
        headers: { Authorization: `Bearer ${issued.access_token}`, Accept: 'application/json, text/event-stream' },
        data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-browser-test', version: '1.0.0' },
        } },
      });
      expect(initialized.status()).toBe(200);
      expect((await initialized.json()).result.serverInfo.name).toBe('design-studio-ai');
    }
  } finally {
    callbackServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => callbackServer.close(error => error ? reject(error) : resolve()));
  }
});
