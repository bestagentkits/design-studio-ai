import type { Context } from "hono";
import type { Env, Bindings, User } from "./types";
import { getCookie } from "hono/cookie";
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
const encoder = new TextEncoder();
export const b64 = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export const unb64 = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export const secret = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async (value: string) =>
  b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
export async function passwordHash(password: string, salt = secret()) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2:100000:${salt}:${b64(new Uint8Array(bits))}`;
}
export async function passwordMatches(password: string, stored: string) {
  const salt = stored.split(":")[2];
  const actual = await passwordHash(password, salt);
  let mismatch = actual.length ^ stored.length;
  for (let i = 0; i < actual.length; i++)
    mismatch |= actual.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return mismatch === 0;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export const owner = (c: Context<Env>) =>
  c.get("user")?.id ??
  fail(401, "unauthorized", "Sign in or supply an API token.");
export const origin = (c: Context<Env>) =>
  c.env.APP_URL ? new URL(c.env.APP_URL).origin : new URL(c.req.url).origin;
export async function authenticate(c: Context<Env>) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  const cookie = getCookie(c, "studio_session");
  c.set("user", null);
  c.set("authMethod", null);
  c.set('tokenKind', null);
  if (bearer) {
    const digest = await hash(bearer);
    const api = await c.env.DB.prepare(
      "SELECT u.id,u.email,u.name FROM users u JOIN api_tokens t ON t.user_id=u.id WHERE t.hash=?",
    )
      .bind(digest)
      .first<User>();
    const oauth = api
      ? null
      : await c.env.DB.prepare(
          "SELECT u.id,u.email,u.name FROM users u JOIN oauth_tokens t ON t.user_id=u.id WHERE t.hash=? AND t.kind=? AND t.resource=? AND t.expires_at>?",
        )
          .bind(digest, "access", `${origin(c)}/mcp`, Date.now())
          .first<User>();
    c.set("user", api ?? oauth);
    c.set("authMethod", api || oauth ? "token" : null);
    c.set('tokenKind', api ? 'api' : oauth ? 'oauth' : null);
  } else if (cookie) {
    const user = await c.env.DB.prepare(
      "SELECT u.id,u.email,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>?",
    )
      .bind(await hash(cookie), Date.now())
      .first<User>();
    c.set("user", user);
    c.set("authMethod", user ? "session" : null);
  }
}
export async function rateLimit(c: Context<Env>, action: string, limit = 10) {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
      Date.now(),
    ),
    c.env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at<?").bind(
      Date.now(),
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(
      Date.now(),
    ),
    c.env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at<?").bind(
      Date.now(),
    ),
  ]);
  const key = await hash(
    `${action}:${c.req.header("CF-Connecting-IP") ?? "local"}`,
  );
  const expiry = Date.now() + 15 * 60 * 1000;
  const row = await c.env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count",
  )
    .bind(key, expiry, Date.now(), Date.now())
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit)
    fail(429, "rate_limited", "Too many attempts. Try again in 15 minutes.");
}
async function encryptionKey(env: Bindings) {
  if (!env.ENCRYPTION_KEY)
    fail(
      503,
      "encryption_unconfigured",
      "Set ENCRYPTION_KEY before storing provider credentials.",
    );
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = unb64(env.ENCRYPTION_KEY!);
  } catch {
    return fail(
      503,
      "encryption_unconfigured",
      "ENCRYPTION_KEY must be a base64 encoded 32-byte key.",
    );
  }
  if (raw.length !== 32)
    fail(
      503,
      "encryption_unconfigured",
      "ENCRYPTION_KEY must be a base64 encoded 32-byte key.",
    );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encrypt(env: Bindings, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    encoder.encode(value),
  );
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}
export async function decrypt(env: Bindings, value: string) {
  const [iv, data] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await encryptionKey(env),
      unb64(data),
    ),
  );
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
