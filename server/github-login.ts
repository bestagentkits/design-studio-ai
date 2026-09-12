import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, User } from './types';
import { ApiError, createSession, decrypt, encrypt, fail, hash, id, now, origin, passwordHash, rateLimit, secret } from './security';
import { claimCommunityAdminEmails } from './community-admin-grants';

export const githubRoutes = new Hono<Env>();
const stateCookie = 'studio_github_state';
const cookiePath = '/api/auth/github';
const lifetime = 10 * 60 * 1000;
interface LoginState { verifier: string; link_user_id: string | null; session_hash: string | null }
export const githubProfileSchema = z.object({ id: z.number().int().positive().safe(), login: z.string().min(1).max(100), name: z.string().nullable().optional() });
const emailSchema = z.array(z.object({ email: z.string().email().max(254), primary: z.boolean(), verified: z.boolean() }));
export const verifiedGitHubEmails = (records:unknown) => emailSchema.parse(records).filter(item=>item.verified).map(item=>item.email.toLowerCase());
type GitHubProfile = z.infer<typeof githubProfileSchema>;

export function githubEnabled(c: Context<Env>) {
  return Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET && c.env.GITHUB_CALLBACK_URL);
}
function config(c: Context<Env>) {
  if (!githubEnabled(c)) fail(503, 'configuration_error', 'GitHub sign-in is not configured.');
  if (c.env.GITHUB_CALLBACK_URL !== `${origin(c)}/api/auth/github/callback`)
    fail(503, 'configuration_error', 'The GitHub callback must match this application origin and /api/auth/github/callback.');
  return { clientId: c.env.GITHUB_CLIENT_ID!, clientSecret: c.env.GITHUB_CLIENT_SECRET!, callback: c.env.GITHUB_CALLBACK_URL! };
}
function sessionUser(c: Context<Env>) {
  if (c.get('authMethod') !== 'session' || !c.get('user')) fail(401, 'unauthorized', 'Sign in to your account before connecting GitHub.');
  return c.get('user')!;
}
export async function beginGitHub(c: Context<Env>, link = false) {
  const settings = config(c), user = link ? sessionUser(c) : null;
  await rateLimit(c, 'github-login', 20);
  const state = secret(), browser = secret(), verifier = secret();
  const previous = getCookie(c, stateCookie);
  if (previous) await c.env.DB.prepare('DELETE FROM github_login_states WHERE browser_hash=?').bind(await hash(previous)).run();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM github_login_states WHERE expires_at<?').bind(Date.now()),
    c.env.DB.prepare('INSERT INTO github_login_states(hash,browser_hash,verifier,link_user_id,session_hash,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await hash(state), await hash(browser), await encrypt(c.env, verifier), user?.id ?? null, user ? await hash(getCookie(c, 'studio_session')!) : null, Date.now() + lifetime),
  ]);
  setCookie(c, stateCookie, browser, { httpOnly: true, secure: origin(c).startsWith('https:'), sameSite: 'Lax', path: cookiePath, maxAge: lifetime / 1000 });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.callback, scope: 'read:user user:email', state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString();
  return url.href;
}

export async function consumeGitHubState(c: Context<Env>, state: string) {
  const browser = getCookie(c, stateCookie);
  deleteCookie(c, stateCookie, { path: cookiePath });
  if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(state)) fail(400, 'invalid_state', 'GitHub sign-in expired. Start again.');
  const record = await c.env.DB.prepare('DELETE FROM github_login_states WHERE hash=? AND browser_hash=? AND expires_at>? RETURNING verifier,link_user_id,session_hash')
    .bind(await hash(state), await hash(browser), Date.now()).first<LoginState>();
  if (!record) fail(400, 'invalid_state', 'GitHub sign-in expired. Start again.');
  if (record.link_user_id && (c.get('authMethod') !== 'session' || c.get('user')?.id !== record.link_user_id || await hash(getCookie(c, 'studio_session') ?? '') !== record.session_hash))
    fail(403, 'link_session_changed', 'Your sign-in session changed. Start connecting GitHub again from Settings.');
  return record;
}

// Only identities and verified email addresses returned directly by GitHub reach this service.
export async function resolveGitHubUser(c: Context<Env>, profile: GitHubProfile, email: string | null, linkUserId: string | null = null): Promise<User> {
  const account = await c.env.DB.prepare('SELECT u.id,u.email,u.name FROM users u JOIN github_accounts g ON g.user_id=u.id WHERE g.github_id=?').bind(String(profile.id)).first<User>();
  if (account) {
    if (linkUserId && account.id !== linkUserId) fail(409, 'account_linked', 'This GitHub identity is already connected to another workspace.');
    await c.env.DB.prepare('UPDATE github_accounts SET login=? WHERE github_id=?').bind(profile.login, String(profile.id)).run();
    return account;
  }
  if (linkUserId) {
    const user = sessionUser(c);
    if (user.id !== linkUserId) fail(403, 'link_session_changed', 'Sign in to the same workspace before connecting GitHub.');
    try { await c.env.DB.prepare('INSERT INTO github_accounts(github_id,user_id,login,created_at) VALUES(?,?,?,?)').bind(String(profile.id), user.id, profile.login, now()).run(); }
    catch (error) { if (String(error).includes('UNIQUE')) fail(409, 'account_linked', 'A GitHub identity is already connected to this workspace.'); throw error; }
    return user;
  }
  if (!email) fail(400, 'email_required', 'GitHub must provide a verified email address to create your workspace.');
  if (await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())
    fail(409, 'email_exists', 'Sign in with your existing password, then connect GitHub from Settings.');
  if (c.env.ALLOW_REGISTRATION !== 'true') fail(403, 'registration_disabled', 'New workspace registration is disabled.');
  const user = { id: id(), email, name: (profile.name?.trim() || profile.login).slice(0, 100) };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(user.id, user.email, user.name, await passwordHash(secret()), now()),
      c.env.DB.prepare('INSERT INTO github_accounts(github_id,user_id,login,created_at) VALUES(?,?,?,?)').bind(String(profile.id), user.id, profile.login, now()),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) fail(409, 'account_linked', 'This identity was connected during another sign-in. Try signing in again.');
    throw error;
  }
  return user;
}

async function githubJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  // Workers supports manual/follow. Reject non-2xx without forwarding credentials.
  if (!response.ok) fail(502, 'github_unavailable', 'GitHub could not complete sign-in. Try again.');
  const text = await response.text();
  if (text.length > 256000) fail(502, 'github_unavailable', 'GitHub returned an unexpected response.');
  return JSON.parse(text) as unknown;
}
githubRoutes.get('/', async c => {
  try { return c.redirect(await beginGitHub(c)); }
  catch (error) { return c.redirect(`/?auth_error=${error instanceof ApiError ? error.code : 'github_unavailable'}`); }
});
githubRoutes.get('/status', async c => {
  const user = sessionUser(c);
  const account = await c.env.DB.prepare('SELECT login FROM github_accounts WHERE user_id=?').bind(user.id).first<{ login: string }>();
  return c.json({ enabled: githubEnabled(c), connected: Boolean(account), login: account?.login ?? null });
});
githubRoutes.post('/link', async c => c.json({ url: await beginGitHub(c, true) }));
githubRoutes.get('/callback', async c => {
  c.header('Referrer-Policy', 'no-referrer');
  let stage = 'state';
  try {
    const settings = config(c), state = await consumeGitHubState(c, c.req.query('state') ?? '');
    if (c.req.query('error')) fail(400, 'cancelled', 'GitHub sign-in was cancelled.');
    const code = c.req.query('code');
    if (!code || code.length > 512) fail(400, 'invalid_state', 'GitHub did not return an authorization code.');
    stage = 'verifier';
    const verifier = await decrypt(c.env, state.verifier);
    stage = 'token';
    const tokenResponse = await githubJson('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, code, redirect_uri: settings.callback, code_verifier: verifier }).toString(),
    });
    const token = z.object({ access_token: z.string().min(1), token_type: z.string() }).safeParse(tokenResponse);
    if (!token.success) {
      const code = (tokenResponse as {error?: unknown})?.error;
      console.warn('github_login_token_error', typeof code === 'string' && /^[a-z_]{1,60}$/.test(code) ? code : 'invalid_response');
    }
    if (!token.success || token.data.token_type.toLowerCase() !== 'bearer') fail(502, 'github_unavailable', 'GitHub could not complete sign-in. Try again.');
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.data.access_token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Design-Studio-AI' };
    stage = 'profile';
    const profile = githubProfileSchema.parse(await githubJson('https://api.github.com/user', { headers }));
    stage = 'email';
    const emails = emailSchema.parse(await githubJson('https://api.github.com/user/emails?per_page=100', { headers }));
    const email = (emails.find(item => item.primary && item.verified) ?? emails.find(item => item.verified))?.email.toLowerCase() ?? null;
    stage = 'identity';
    const user = await resolveGitHubUser(c, profile, email, state.link_user_id);
    await claimCommunityAdminEmails(c.env, user.id, verifiedGitHubEmails(emails));
    stage = 'session';
    await createSession(c, user);
    return c.redirect(state.link_user_id ? '/?github=connected' : '/');
  } catch (error) {
    console.warn('github_login_failed', {stage, code: error instanceof ApiError ? error.code : error instanceof z.ZodError ? 'invalid_response_schema' : 'internal_error'});
    deleteCookie(c, stateCookie, { path: cookiePath });
    const safeCodes = new Set(['cancelled', 'invalid_state', 'email_required', 'email_exists', 'account_linked', 'registration_disabled', 'link_session_changed', 'configuration_error']);
    return c.redirect(`/?auth_error=${error instanceof ApiError && safeCodes.has(error.code) ? error.code : 'github_unavailable'}`);
  }
});
