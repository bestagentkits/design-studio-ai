import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker';
const check = (value, message) => { if (!value) throw new Error(message); };
async function rejects(run, pattern) {
  try { await run(); } catch (error) { check(pattern.test(error.message), `Unexpected rejection: ${error.message}`); return; }
  throw new Error('Expected rejection');
}
function provider(origin) {
  return {
    redirectUrl: `${origin}/callback`,
    clientMetadata: { redirect_uris: [`${origin}/callback`], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    clientInformation() { return { client_id: 'probe-client' }; },
    tokens() { return this.savedTokens; }, saveTokens(value) { this.savedTokens = value; },
    state() { return this.pendingState ??= crypto.randomUUID(); },
    saveCodeVerifier(value) { this.verifier = value; }, codeVerifier() { return this.verifier; },
    discoveryState() { return this.discovery; }, saveDiscoveryState(value) { this.discovery = value; },
    redirectToAuthorization(value) { this.authorizationUrl = value; },
  };
}
export async function probeOAuth(origin) {
  const passed = [], p = provider(origin), endpoint = `${origin}/mcp/good`;
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: p });
  const client = new Client({ name: 'oauth-probe', version: '1' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } }, jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
  });
  try {
    await rejects(() => client.connect(transport, { timeout: 5000 }), /Unauthorized|authorization|redirect/i);
    check(p.authorizationUrl?.searchParams.get('resource') === endpoint, 'Missing resource audience');
    check(p.authorizationUrl.searchParams.get('state') === p.pendingState, 'Missing state');
    check(p.authorizationUrl.searchParams.get('code_challenge_method') === 'S256', 'Missing PKCE');
    passed.push('401 protected-resource discovery and PKCE redirect');
    const visit = async url => {
      const response = await fetch(url, { redirect: 'manual' });
      check(response.status === 302, 'Authorization endpoint failed');
      return new URL(response.headers.get('location')).searchParams;
    };
    // State verification belongs to the application callback, not finishAuth().
    const finish = async params => {
      check(params.get('state') === p.pendingState, 'State mismatch');
      return transport.finishAuth(params);
    };
    const deniedUrl = new URL(p.authorizationUrl); deniedUrl.searchParams.set('deny', '1');
    await rejects(() => visit(deniedUrl).then(finish), /access_denied/);
    passed.push('authorization denial');
    const callback = await visit(p.authorizationUrl);
    const badState = new URLSearchParams(callback); badState.set('state', 'wrong');
    await rejects(() => finish(badState), /State mismatch/); passed.push('application callback state mismatch');
    const badIssuer = new URLSearchParams(callback); badIssuer.set('iss', `${origin}/attacker`);
    await rejects(() => finish(badIssuer), /issuer/i); passed.push('SDK callback issuer mismatch');
    const verifier = p.verifier; p.verifier = 'invalid-verifier';
    await rejects(() => finish(callback), /invalid_grant/); p.verifier = verifier;
    passed.push('peer rejects wrong PKCE verifier');
    await finish(callback);
    check(p.savedTokens.issuer === `${origin}/as/good`, 'Missing persisted issuer stamp');
    passed.push('authorization code exchange and issuer stamp');
    await rejects(() => finish(callback), /invalid_grant/); passed.push('peer rejects code replay');
    check(await auth(p, { serverUrl: endpoint }) === 'AUTHORIZED', 'Refresh failed');
    passed.push('resource-bound refresh rotation');
    const renewedTransport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider: p });
    await client.connect(renewedTransport, { timeout: 5000 });
    check((await client.listTools()).tools[0].name === 'sum', 'Tool discovery failed');
    check((await client.callTool({ name: 'sum', arguments: { a: 17, b: 25 } })).content[0].text === '42', 'Tool execution failed');
    passed.push('authenticated MCP discovery and call returns 42');
    const wrongAudience = await fetch(`${origin}/mcp/another`, { headers: { authorization: `Bearer ${p.savedTokens.access_token}` } });
    check(wrongAudience.status === 401, 'Peer allowed incorrect audience'); passed.push('peer rejects token audience mismatch');
    for (const mode of ['bad-issuer', 'bad-resource']) {
      await rejects(() => auth(provider(origin), { serverUrl: `${origin}/mcp/${mode}` }), mode === 'bad-issuer' ? /issuer/i : /resource.*match/i);
      passed.push(`SDK rejects ${mode} metadata`);
    }
    return { passed };
  } finally { await client.close(); await transport.close(); }
}
