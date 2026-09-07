import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { app } from '../server/index';
import { beginGitHub, consumeGitHubState, githubProfileSchema, resolveGitHubUser } from '../server/github-login';
import { ApiError, authenticate, decrypt, hash, secret } from '../server/security';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import type { Bindings, Env, User } from '../server/types';

test('GitHub login state and identity boundaries use real SQLite without provider success stubs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-github-login-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const base = 'https://studio.example';
  const env: Bindings = {
    DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: base, ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret(),
    GITHUB_CLIENT_ID: 'unit-client-id', GITHUB_CLIENT_SECRET: secret(), GITHUB_CALLBACK_URL: `${base}/api/auth/github/callback`,
  };
  // These helper routes exercise exported services with authenticated Hono contexts.
  // Synthetic profiles below are identity-unit inputs, not simulated GitHub HTTP replies.
  const services = new Hono<Env>();
  services.use('*', async (c, next) => { await authenticate(c); await next(); });
  services.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: { code: error.code } }, error.status as ContentfulStatusCode);
    throw error;
  });
  services.get('/begin', async c => c.json({ url: await beginGitHub(c, c.req.query('link') === 'true') }));
  services.post('/consume', async c => c.json(await consumeGitHubState(c, (await c.req.json()).state)));
  services.post('/resolve', async c => {
    const body = await c.req.json();
    return c.json({ user: await resolveGitHubUser(c, githubProfileSchema.parse(body.profile), body.email, body.linkUserId ?? null) });
  });
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string, bearer?: string, binding = env, origin = base) => app.request(base + path, {
    method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, binding);
  const invoke = (path: string, method = 'GET', body?: unknown, cookie?: string, bearer?: string) => services.request(base + path, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const start = async (cookie?: string, link = false) => {
    const response = await invoke(`/begin${link ? '?link=true' : ''}`, 'GET', undefined, cookie);
    assert.equal(response.status, 200);
    const url = new URL(((await response.json()) as { url: string }).url);
    const browserCookie = response.headers.get('set-cookie')!.split(';')[0];
    return { response, url, state: url.searchParams.get('state')!, browserCookie, cookie: [cookie, browserCookie].filter(Boolean).join('; ') };
  };
  const register = async (email: string) => {
    const password = secret();
    const response = await request('/api/auth/register', 'POST', { email, password, name: 'Password account' });
    assert.equal(response.status, 201);
    return { user: ((await response.json()) as { user: User }).user, cookie: response.headers.get('set-cookie')!.split(';')[0], password };
  };
  const errorCode = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
  };
  const count = async (table: 'users' | 'github_accounts' | 'github_login_states') => (await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>())!.total;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const alice = await register('alice@github-login.test');
    const bob = await register('bob@github-login.test');
    const tokenResponse = await request('/api/tokens', 'POST', { name: 'Unit API client' }, alice.cookie);
    assert.equal(tokenResponse.status, 201);
    const token = ((await tokenResponse.json()) as { token: string }).token;

    await t.test('authorization URL uses exact callback, browser cookie, hashed state, encrypted verifier and PKCE S256', async () => {
      const before = Date.now();
      const begun = await start();
      assert.equal(begun.url.origin, 'https://github.com');
      assert.equal(begun.url.pathname, '/login/oauth/authorize');
      assert.equal(begun.url.searchParams.get('redirect_uri'), `${base}/api/auth/github/callback`);
      assert.equal(begun.url.searchParams.get('client_id'), env.GITHUB_CLIENT_ID);
      assert.equal(begun.url.searchParams.get('scope'), 'read:user user:email');
      assert.equal(begun.url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(begun.url.searchParams.has('client_secret'), false);
      assert.match(begun.state, /^[A-Za-z0-9_-]{43}$/);
      const cookie = begun.response.headers.get('set-cookie')!;
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\/api\/auth\/github/); assert.match(cookie, /Max-Age=600/);
      const row = await db.prepare('SELECT * FROM github_login_states WHERE hash=?').bind(await hash(begun.state)).first<{ hash: string; browser_hash: string; verifier: string; expires_at: number; link_user_id: string | null; session_hash: string | null }>();
      assert.ok(row);
      assert.notEqual(row.hash, begun.state);
      assert.equal(row.browser_hash, await hash(begun.browserCookie.split('=')[1]));
      const verifier = await decrypt(env, row.verifier);
      assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(row.verifier, verifier);
      assert.equal(await hash(verifier), begun.url.searchParams.get('code_challenge'));
      assert.ok(row.expires_at >= before + 600000 && row.expires_at <= Date.now() + 600000);
      assert.equal(row.link_user_id, null); assert.equal(row.session_hash, null);
    });

    await t.test('wrong browser, missing browser and malformed state cannot consume valid state; matching state is one use', async () => {
      const begun = await start();
      await errorCode(await invoke('/consume', 'POST', { state: begun.state }), 400, 'invalid_state');
      await errorCode(await invoke('/consume', 'POST', { state: begun.state }, `studio_github_state=${secret()}`), 400, 'invalid_state');
      await errorCode(await invoke('/consume', 'POST', { state: 'short' }, begun.cookie), 400, 'invalid_state');
      assert.ok(await db.prepare('SELECT hash FROM github_login_states WHERE hash=?').bind(await hash(begun.state)).first());
      const results = await Promise.all([invoke('/consume', 'POST', { state: begun.state }, begun.cookie), invoke('/consume', 'POST', { state: begun.state }, begun.cookie)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      assert.match(results[0].headers.get('set-cookie')!, /Max-Age=0/);
      await errorCode(await invoke('/consume', 'POST', { state: begun.state }, begun.cookie), 400, 'invalid_state');
    });

    await t.test('state expires and a new attempt invalidates only the previous attempt in that browser', async () => {
      const expired = await start();
      await db.prepare('UPDATE github_login_states SET expires_at=? WHERE hash=?').bind(Date.now() - 1, await hash(expired.state)).run();
      await errorCode(await invoke('/consume', 'POST', { state: expired.state }, expired.cookie), 400, 'invalid_state');
      const first = await start();
      const otherBrowser = await start();
      const replacement = await start(first.browserCookie);
      await errorCode(await invoke('/consume', 'POST', { state: first.state }, first.cookie), 400, 'invalid_state');
      assert.equal((await invoke('/consume', 'POST', { state: replacement.state }, replacement.browserCookie)).status, 200);
      assert.equal((await invoke('/consume', 'POST', { state: otherBrowser.state }, otherBrowser.cookie)).status, 200);
    });

    await t.test('real routes expose status and configuration without secrets, and cancellation consumes state without a session', async () => {
      const configured = await request('/api/config');
      assert.equal(((await configured.json()) as { githubEnabled: boolean }).githubEnabled, true);
      const status = await request('/api/auth/github/status', 'GET', undefined, alice.cookie);
      assert.deepEqual(await status.json(), { enabled: true, connected: false, login: null });
      await errorCode(await request('/api/auth/github/status'), 401, 'unauthorized');
      await errorCode(await request('/api/auth/github/status', 'GET', undefined, undefined, token), 401, 'unauthorized');
      const redirect = await request('/api/auth/github');
      assert.equal(redirect.status, 302);
      const state = new URL(redirect.headers.get('location')!).searchParams.get('state')!;
      const cookie = redirect.headers.get('set-cookie')!.split(';')[0];
      const cancelled = await request(`/api/auth/github/callback?state=${state}&error=access_denied&error_description=private-data`, 'GET', undefined, cookie);
      assert.equal(cancelled.status, 302);
      assert.equal(cancelled.headers.get('location'), '/?auth_error=cancelled');
      assert.equal(cancelled.headers.get('referrer-policy'), 'no-referrer');
      assert.ok(!cancelled.headers.get('set-cookie')!.includes('studio_session='));
      assert.match(cancelled.headers.get('set-cookie')!, /Max-Age=0/);
      assert.equal((await request(`/api/auth/github/callback?state=${state}&error=access_denied`, 'GET', undefined, cookie)).headers.get('location'), '/?auth_error=invalid_state');
      const missingCode = await start();
      assert.equal((await request(`/api/auth/github/callback?state=${missingCode.state}`, 'GET', undefined, missingCode.cookie)).headers.get('location'), '/?auth_error=invalid_state');
      await errorCode(await invoke('/consume', 'POST', { state: missingCode.state }, missingCode.cookie), 400, 'invalid_state');
    });

    await t.test('missing provider config and mismatched callback fail before creating state', async () => {
      const before = await count('github_login_states');
      for (const overrides of [{ GITHUB_CLIENT_ID: undefined }, { GITHUB_CLIENT_SECRET: undefined }, { GITHUB_CALLBACK_URL: undefined }, { GITHUB_CALLBACK_URL: 'https://other.example/api/auth/github/callback' }]) {
        const binding = { ...env, ...overrides };
        const response = await request('/api/auth/github', 'GET', undefined, undefined, undefined, binding);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/?auth_error=configuration_error');
        assert.equal(await count('github_login_states'), before);
      }
      const disabled = await request('/api/config', 'GET', undefined, undefined, undefined, { ...env, GITHUB_CLIENT_ID: undefined });
      assert.equal(((await disabled.json()) as { githubEnabled: boolean }).githubEnabled, false);
    });

    await t.test('link initiation requires an actual same-origin cookie session, and callback binds the exact session', async () => {
      await errorCode(await request('/api/auth/github/link', 'POST'), 401, 'unauthorized');
      await errorCode(await request('/api/auth/github/link', 'POST', undefined, undefined, token), 401, 'unauthorized');
      await errorCode(await request('/api/auth/github/link', 'POST', undefined, alice.cookie, token), 401, 'unauthorized');
      await errorCode(await request('/api/auth/github/link', 'POST', undefined, alice.cookie, undefined, env, 'https://attacker.example'), 403, 'invalid_origin');
      const response = await request('/api/auth/github/link', 'POST', undefined, alice.cookie);
      assert.equal(response.status, 200);
      const state = new URL(((await response.json()) as { url: string }).url).searchParams.get('state')!;
      const browserCookie = response.headers.get('set-cookie')!.split(';')[0];
      const consumed = await invoke('/consume', 'POST', { state }, `${alice.cookie}; ${browserCookie}`);
      assert.equal(consumed.status, 200);
      const record = await consumed.json() as { link_user_id: string; session_hash: string };
      assert.equal(record.link_user_id, alice.user.id);
      assert.equal(record.session_hash, await hash(alice.cookie.split('=')[1]));

      const changed = await start(alice.cookie, true);
      await errorCode(await invoke('/consume', 'POST', { state: changed.state }, `${bob.cookie}; ${changed.browserCookie}`), 403, 'link_session_changed');
      await errorCode(await invoke('/consume', 'POST', { state: changed.state }, changed.cookie), 400, 'invalid_state');
      const renewed = await start(alice.cookie, true);
      const relogin = await request('/api/auth/login', 'POST', { email: alice.user.email, password: alice.password });
      assert.equal(relogin.status, 200);
      const renewedCookie = relogin.headers.get('set-cookie')!.split(';')[0];
      assert.notEqual(renewedCookie, alice.cookie);
      await errorCode(await invoke('/consume', 'POST', { state: renewed.state }, `${renewedCookie}; ${renewed.browserCookie}`), 403, 'link_session_changed');
      const loggedOut = await start(alice.cookie, true);
      await errorCode(await invoke('/consume', 'POST', { state: loggedOut.state }, loggedOut.browserCookie), 403, 'link_session_changed');
    });

    await t.test('numeric GitHub identity is stable across login and verified-email changes; profile validation rejects unsafe IDs', async () => {
      for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123']) assert.equal(githubProfileSchema.safeParse({ id, login: 'profile' }).success, false);
      const before = await count('users');
      const first = await invoke('/resolve', 'POST', { profile: { id: 7001, login: 'first-login', name: 'GitHub unit user' }, email: 'new@github-login.test' });
      assert.equal(first.status, 200);
      const user = ((await first.json()) as { user: User }).user;
      assert.equal(await count('users'), before + 1);
      const stored = await db.prepare('SELECT password FROM users WHERE id=?').bind(user.id).first<{ password: string }>();
      assert.match(stored!.password, /^pbkdf2:100000:/);
      for (const email of [null, 'changed@github-login.test', alice.user.email]) {
        const response = await invoke('/resolve', 'POST', { profile: { id: 7001, login: 'renamed-login', name: 'New name' }, email });
        assert.equal(response.status, 200);
        assert.deepEqual(((await response.json()) as { user: User }).user, user);
      }
      assert.equal((await db.prepare('SELECT login FROM github_accounts WHERE github_id=?').bind('7001').first<{ login: string }>())!.login, 'renamed-login');
      assert.equal(await count('users'), before + 1);
    });

    await t.test('email collision does not auto-link; missing verified email and disabled registration cannot create identities', async () => {
      const users = await count('users'), accounts = await count('github_accounts');
      await errorCode(await invoke('/resolve', 'POST', { profile: { id: 7002, login: 'collision' }, email: alice.user.email }), 409, 'email_exists');
      await errorCode(await invoke('/resolve', 'POST', { profile: { id: 7003, login: 'no-email' }, email: null }), 400, 'email_required');
      env.ALLOW_REGISTRATION = 'false';
      try {
        await errorCode(await invoke('/resolve', 'POST', { profile: { id: 7004, login: 'registration-closed' }, email: 'closed@github-login.test' }), 403, 'registration_disabled');
        assert.equal((await invoke('/resolve', 'POST', { profile: { id: 7001, login: 'existing' }, email: null })).status, 200);
      } finally { env.ALLOW_REGISTRATION = 'true'; }
      assert.equal(await count('users'), users); assert.equal(await count('github_accounts'), accounts);
    });

    await t.test('explicit linking is unique in both directions and preserves the password workspace', async () => {
      const input = { profile: { id: 8001, login: 'alice-github' }, email: null, linkUserId: alice.user.id };
      await errorCode(await invoke('/resolve', 'POST', input, undefined, token), 401, 'unauthorized');
      await errorCode(await invoke('/resolve', 'POST', input, bob.cookie), 403, 'link_session_changed');
      const linked = await invoke('/resolve', 'POST', input, alice.cookie);
      assert.equal(linked.status, 200);
      assert.deepEqual(((await linked.json()) as { user: User }).user, alice.user);
      assert.equal((await invoke('/resolve', 'POST', input, alice.cookie)).status, 200);
      await errorCode(await invoke('/resolve', 'POST', { ...input, linkUserId: bob.user.id }, bob.cookie), 409, 'account_linked');
      await errorCode(await invoke('/resolve', 'POST', { ...input, profile: { id: 8002, login: 'second-github' } }, alice.cookie), 409, 'account_linked');
      const status = await request('/api/auth/github/status', 'GET', undefined, alice.cookie);
      assert.deepEqual(await status.json(), { enabled: true, connected: true, login: 'alice-github' });
      const login = await request('/api/auth/login', 'POST', { email: alice.user.email, password: alice.password });
      assert.equal(login.status, 200);
      assert.deepEqual(((await login.json()) as { user: User }).user, alice.user);
    });

    await t.test('concurrent first sign-ins cannot create duplicate identities or orphan workspaces', async () => {
      const users = await count('users'), accounts = await count('github_accounts');
      const results = await Promise.all([
        invoke('/resolve', 'POST', { profile: { id: 9001, login: 'concurrent-user' }, email: 'concurrent-one@github-login.test' }),
        invoke('/resolve', 'POST', { profile: { id: 9001, login: 'concurrent-user' }, email: 'concurrent-two@github-login.test' }),
      ]);
      assert.ok(results.some(result => result.status === 200));
      assert.ok(results.every(result => [200, 409].includes(result.status)));
      assert.equal(await count('users'), users + 1);
      assert.equal(await count('github_accounts'), accounts + 1);
      const stored = await db.prepare('SELECT user_id FROM github_accounts WHERE github_id=?').bind('9001').first<{ user_id: string }>();
      assert.ok(stored);
      for (const result of results.filter(result => result.status === 200)) assert.equal(((await result.json()) as { user: User }).user.id, stored.user_id);
    });
  } finally {
    db.close();
    const target = resolve(directory), temporaryRoot = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(temporaryRoot) && target.split(sep).pop()!.startsWith('studio-github-login-'));
    await rm(target, { recursive: true, force: true });
  }
});
