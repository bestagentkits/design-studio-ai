import { createHash, randomUUID } from 'node:crypto';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';

// Isolated contract peer: no accounts, provider credentials, or production storage.
export function createOAuthPeer(origin) {
  const codes = new Map(), tokens = new Map(), refresh = new Map();
  const counts = { pkce: 0, refresh: 0, authenticatedMcp: 0, rejectedGrant: 0 };
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'oauth-contract-peer', version: '1' });
    server.registerTool('sum', { inputSchema: z.object({ a: z.number(), b: z.number() }) },
      async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));
    return server;
  }, { responseMode: 'json', legacy: 'reject' });
  const issue = resource => {
    const access = randomUUID(), renewal = randomUUID();
    tokens.set(access, resource); refresh.set(renewal, resource);
    return Response.json({ access_token: access, refresh_token: renewal, token_type: 'Bearer', expires_in: 3600, scope: 'tools:read' });
  };
  return { counts, close: () => handler.close(), async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    const mode = path.split('/').at(-1);
    if (path.startsWith('/.well-known/oauth-protected-resource/')) return Response.json({
      resource: mode === 'bad-resource' ? `${origin}/unrelated` : `${origin}/mcp/${mode}`,
      authorization_servers: [`${origin}/as/${mode}`], scopes_supported: ['tools:read'],
    });
    if (path.startsWith('/.well-known/oauth-authorization-server/as/')) return Response.json({
      issuer: mode === 'bad-issuer' ? `${origin}/wrong-issuer` : `${origin}/as/${mode}`,
      authorization_endpoint: `${origin}/authorize/${mode}`, token_endpoint: `${origin}/token/${mode}`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
    if (path.startsWith('/authorize/')) {
      const p = url.searchParams;
      if (p.get('code_challenge_method') !== 'S256' || p.get('resource') !== `${origin}/mcp/${mode}` || p.get('client_id') !== 'probe-client') return new Response('Invalid authorization request', { status: 400 });
      const callback = new URL(p.get('redirect_uri'));
      callback.searchParams.set('state', p.get('state'));
      callback.searchParams.set('iss', `${origin}/as/${mode}`);
      if (p.get('deny') === '1') callback.searchParams.set('error', 'access_denied');
      else {
        const code = randomUUID();
        codes.set(code, { challenge: p.get('code_challenge'), resource: p.get('resource'), redirect: p.get('redirect_uri'), mode });
        callback.searchParams.set('code', code);
      }
      return Response.redirect(callback, 302);
    }
    if (path.startsWith('/token/')) {
      const p = new URLSearchParams(await request.text());
      if (p.get('grant_type') === 'refresh_token') {
        const resource = refresh.get(p.get('refresh_token'));
        if (resource && resource === p.get('resource')) {
          refresh.delete(p.get('refresh_token')); counts.refresh++; return issue(resource);
        }
      } else {
        const saved = codes.get(p.get('code'));
        const challenge = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
        if (saved && saved.mode === mode && saved.challenge === challenge && saved.resource === p.get('resource') && saved.redirect === p.get('redirect_uri') && p.get('client_id') === 'probe-client') {
          codes.delete(p.get('code')); counts.pkce++; return issue(saved.resource);
        }
      }
      counts.rejectedGrant++;
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (path.startsWith('/mcp/')) {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
      if (tokens.get(token) !== `${origin}${path}`) return new Response(null, { status: 401, headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${mode}", scope="tools:read"`,
      } });
      counts.authenticatedMcp++;
      return handler.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  } };
}
