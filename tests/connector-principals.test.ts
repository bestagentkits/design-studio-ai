import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { app } from '../server/index';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { authenticate, createSession, hash, secret } from '../server/security';
import type { Bindings, Env, User } from '../server/types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';

const origin = 'https://principal.studio.example';
type Identity = { principal: ConnectorPrincipal | null; user: User | null; authMethod: string | null; tokenKind: string | null };
type OAuthTokens = { access_token: string; refresh_token: string };

test('authentication keeps stable private principals separate from public users', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-principals-'));
  const db = new SqliteDatabase(':memory:');
  const user = { id: 'owner', email: 'owner@example.com', name: 'Owner' };
  const other = { id: 'other', email: 'other@example.com', name: 'Other' };
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: origin, ENCRYPTION_KEY: secret() };
  // The inspector exists only in this isolated Hono app, never the production router.
  const inspector = new Hono<Env>();
  inspector.use('*', async (c, next) => { await authenticate(c); await next(); });
  inspector.get('/identity', c => c.json({ principal: c.get('principal'), user: c.get('user'), authMethod: c.get('authMethod'), tokenKind: c.get('tokenKind') }));
  inspector.post('/session/:user', async c => {
    const selected = c.req.param('user') === user.id ? user : other;
    await createSession(c, selected); return c.json({ ok: true });
  });
  const session = async (userId = user.id) => {
    const response = await inspector.request(`${origin}/session/${userId}`, { method: 'POST' }, env);
    assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0];
  };
  const identity = async (headers: HeadersInit = {}) => {
    const response = await inspector.request(`${origin}/identity`, { headers }, env);
    assert.equal(response.status, 200); return response.json() as Promise<Identity>;
  };
  const publicUser = async (headers: HeadersInit, expected: User | null) => {
    const response = await app.request(`${origin}/api/auth/me`, { headers }, env);
    assert.equal(response.status, 200);
    // Exact equality forbids additional token IDs, client/family IDs, digests or principal fields.
    assert.deepEqual(await response.json(), { user: expected });
  };
  const form = (path: string, body: Record<string, string>, cookie = '') => app.request(`${origin}${path}`, {
    method: 'POST', headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(body),
  }, env);
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    for (const account of [user, other]) await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)')
      .bind(account.id, account.email, account.name, 'not-used-by-authentication-test', new Date().toISOString()).run();
    const cookie = await session(), secondCookie = await session(), otherCookie = await session(other.id);

    await t.test('session principal is stable per session, distinct across sessions, and expires or revokes', async () => {
      const first = await identity({ Cookie: cookie }), second = await identity({ Cookie: secondCookie });
      assert.deepEqual(first, { principal: { kind: 'session', userId: user.id, sessionId: await hash(cookie.split('=')[1]) }, user, authMethod: 'session', tokenKind: null });
      assert.deepEqual(await identity({ Cookie: cookie }), first);
      assert.notDeepEqual(first.principal, second.principal); assert.deepEqual(second.user, user);
      await publicUser({ Cookie: cookie }, user); await publicUser({ Cookie: secondCookie }, user);
      await db.prepare('UPDATE sessions SET expires_at=? WHERE hash=?').bind(Date.now() - 1000, await hash(secondCookie.split('=')[1])).run();
      assert.equal((await identity({ Cookie: secondCookie })).principal, null);
      await publicUser({ Cookie: secondCookie }, null);
      const revoked = await session();
      await db.prepare('DELETE FROM sessions WHERE hash=?').bind(await hash(revoked.split('=')[1])).run();
      assert.deepEqual(await identity({ Cookie: revoked }), { principal: null, user: null, authMethod: null, tokenKind: null });
    });

    await t.test('API keys use distinct persistent token IDs and override another user cookie', async () => {
      const issued: { id: string; token: string }[] = [];
      for (const name of ['First connector', 'Second connector']) {
        const response = await app.request(`${origin}/api/tokens`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }, env);
        assert.equal(response.status, 201); issued.push(await response.json() as { id: string; token: string });
      }
      assert.notEqual(issued[0].id, issued[1].id);
      for (const key of issued) {
        const headers = { Authorization: `Bearer ${key.token}`, Cookie: otherCookie };
        const expected = { principal: { kind: 'api', userId: user.id, tokenId: key.id }, user, authMethod: 'token', tokenKind: 'api' };
        assert.deepEqual(await identity(headers), expected); assert.deepEqual(await identity(headers), expected);
        await publicUser(headers, user);
      }
      const revoked = await app.request(`${origin}/api/tokens/${issued[0].id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } }, env);
      assert.equal(revoked.status, 200);
      const headers = { Authorization: `Bearer ${issued[0].token}`, Cookie: cookie };
      assert.deepEqual(await identity(headers), { principal: null, user: null, authMethod: null, tokenKind: null });
      await publicUser(headers, null);
    });

    await t.test('OAuth rotation preserves family identity, while new consent creates a distinct family', async () => {
      const registered = await app.request(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1/callback'] }) }, env);
      assert.equal(registered.status, 201);
      const { client_id: clientId } = await registered.json() as { client_id: string };
      const issue = async () => {
        const verifier = secret();
        const consent = await form('/oauth/authorize', { client_id: clientId, redirect_uri: 'http://127.0.0.1/callback', response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256', resource: `${origin}/mcp`, scope: 'studio', decision: 'allow' }, cookie);
        assert.equal(consent.status, 302);
        const code = new URL(consent.headers.get('location')!).searchParams.get('code')!;
        const response = await form('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: 'http://127.0.0.1/callback', code, code_verifier: verifier, resource: `${origin}/mcp` });
        assert.equal(response.status, 200); return response.json() as Promise<OAuthTokens>;
      };
      const first = await issue();
      const firstHeaders = { Authorization: `Bearer ${first.access_token}`, Cookie: otherCookie };
      const before = await identity(firstHeaders);
      assert.equal(before.principal?.kind, 'oauth');
      assert.ok(before.principal && 'familyId' in before.principal);
      assert.equal(before.principal.clientId, clientId); assert.equal(before.principal.userId, user.id);
      assert.deepEqual(before.user, user); assert.equal(before.tokenKind, 'oauth');
      await publicUser(firstHeaders, user);
      const refreshed = await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource: `${origin}/mcp` });
      assert.equal(refreshed.status, 200);
      const rotated = await refreshed.json() as OAuthTokens;
      const rotatedHeaders = { Authorization: `Bearer ${rotated.access_token}`, Cookie: cookie };
      assert.notEqual(rotated.access_token, first.access_token);
      assert.deepEqual(await identity(rotatedHeaders), before); await publicUser(rotatedHeaders, user);
      await publicUser(firstHeaders, null); assert.equal((await identity(firstHeaders)).principal, null);
      const next = await issue(), nextHeaders = { Authorization: `Bearer ${next.access_token}` };
      const after = await identity(nextHeaders);
      assert.ok(after.principal && 'familyId' in after.principal);
      assert.notEqual(after.principal.familyId, before.principal.familyId);
      assert.equal(after.principal.clientId, clientId); await publicUser(nextHeaders, user);
      await db.prepare('UPDATE oauth_tokens SET expires_at=? WHERE hash=?').bind(Date.now() - 1000, await hash(next.access_token)).run();
      assert.equal((await identity({ ...nextHeaders, Cookie: cookie })).principal, null); await publicUser(nextHeaders, null);
      assert.equal((await form('/oauth/revoke', { token: rotated.refresh_token, client_id: clientId })).status, 200);
      assert.deepEqual(await identity(rotatedHeaders), { principal: null, user: null, authMethod: null, tokenKind: null });
      await publicUser(rotatedHeaders, null);
      assert.equal((await identity({ Authorization: `Bearer ${next.refresh_token}`, Cookie: cookie })).principal, null, 'Refresh tokens are not access credentials');
    });

    await t.test('invalid bearer credentials never fall back to an authenticated cookie', async () => {
      for (const authorization of ['Bearer invalid-token', 'Bearer first second', 'Bearer', 'Basic unsupported', '']) {
        const headers = { Authorization: authorization, Cookie: cookie };
        assert.deepEqual(await identity(headers), { principal: null, user: null, authMethod: null, tokenKind: null }, authorization);
        await publicUser(headers, null);
        assert.equal((await app.request(`${origin}/api/projects`, { headers }, env)).status, 401);
      }
      assert.deepEqual(await identity(), { principal: null, user: null, authMethod: null, tokenKind: null });
    });
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
