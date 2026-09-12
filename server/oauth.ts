import { Hono } from "hono";
import { z } from "zod";
import {
  escapeHtml,
  fail,
  hash,
  id,
  now,
  origin,
  owner,
  rateLimit,
  secret,
} from "./security";
import type { Env } from "./types";
export const oauthRoutes = new Hono<Env>();
oauthRoutes.get("/.well-known/oauth-protected-resource", (c) =>
  c.json({
    resource: `${origin(c)}/mcp`,
    authorization_servers: [origin(c)],
    scopes_supported: ["studio"],
    bearer_methods_supported: ["header"],
  }),
);
oauthRoutes.get("/.well-known/oauth-protected-resource/mcp", (c) =>
  c.json({
    resource: `${origin(c)}/mcp`,
    authorization_servers: [origin(c)],
    scopes_supported: ["studio"],
    bearer_methods_supported: ["header"],
  }),
);
oauthRoutes.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: origin(c),
    authorization_endpoint: `${origin(c)}/oauth/authorize`,
    token_endpoint: `${origin(c)}/oauth/token`,
    registration_endpoint: `${origin(c)}/oauth/register`,
    revocation_endpoint: `${origin(c)}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["studio"],
  }),
);
oauthRoutes.post("/oauth/register", async (c) => {
  await rateLimit(c, "oauth-register", 20);
  const body = z
    .object({
      client_name: z.string().min(1).max(200).default("MCP client"),
      redirect_uris: z.array(z.string().url()).min(1).max(10),
      token_endpoint_auth_method: z.literal("none").optional(),
      grant_types: z
        .array(z.enum(["authorization_code", "refresh_token"]))
        .optional(),
      response_types: z.array(z.literal("code")).optional(),
    })
    .parse(await c.req.json());
  for (const uri of body.redirect_uris) {
    const url = new URL(uri);
    if (
      url.hash ||
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      fail(
        400,
        "invalid_redirect_uri",
        "Redirect URI must use HTTPS or an HTTP loopback host.",
      );
  }
  const clientId = id();
  await c.env.DB.prepare(
    "INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)",
  )
    .bind(clientId, body.client_name, JSON.stringify(body.redirect_uris), now())
    .run();
  return c.json(
    {
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
});
const authorizationSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
  resource: z.string().url(),
  scope: z.literal("studio").default("studio"),
});
oauthRoutes.on(["GET", "POST"], "/oauth/authorize", async (c) => {
  const raw = c.req.method === "GET" ? c.req.query() : await c.req.parseBody();
  const body = authorizationSchema.parse(raw);
  if (body.resource !== `${origin(c)}/mcp`)
    fail(400, "invalid_target", "Resource must be the canonical MCP endpoint.");
  const client = await c.env.DB.prepare(
    "SELECT * FROM oauth_clients WHERE id=?",
  )
    .bind(body.client_id)
    .first<{ id: string; name: string; redirect_uris: string }>();
  if (!client || !JSON.parse(client.redirect_uris).includes(body.redirect_uri))
    fail(400, "invalid_client", "Unknown client or redirect URI.");
  const user = c.get("user");
  if (!user) {
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Sign in to connect</title></head><body><h1>Sign in to Design Studio AI</h1><p>Sign in in another tab, then return and reload this consent page.</p><a href="/" target="_blank" rel="noopener">Open Design Studio AI</a></body></html>`,
      401,
    );
  }
  if (c.get("authMethod") !== "session")
    fail(403, "session_required", "OAuth consent requires a browser session.");
  if (c.req.method === "GET") {
    const callbackOrigin = new URL(body.redirect_uri).origin;
    // A URL host can contain CSP delimiters or wildcards; only emit a literal source.
    if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]+)?$/i.test(callbackOrigin))
      fail(400, "invalid_redirect_uri", "Redirect URI must have a literal HTTP(S) host.");
    const fields = Object.entries(body)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`,
      )
      .join("");
    c.header(
      "Content-Security-Policy",
      // Chromium checks form-action on the callback redirect as well as the POST.
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ${escapeHtml(client.name)}</title><style>body{font:17px system-ui;background:#18191c;color:#f4f4f5;max-width:520px;margin:80px auto;padding:24px}button{padding:12px 20px;margin:8px;background:#c8ef70;border:0;border-radius:8px}p{line-height:1.7}</style></head><body><h1>Connect ${escapeHtml(client.name)}?</h1><p>Signed in as ${escapeHtml(user.email)}.</p><p>This client will be able to read, create, edit, delete and publish your designs, manage assets, publish reviewed designs to Community, save or remix community designs, and use your configured AI providers. Community moderation is excluded. Provider requests can incur charges on your provider account.</p><p>Redirect: ${escapeHtml(body.redirect_uri)}</p><form method="post">${fields}<button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Deny</button></form></body></html>`,
    );
  }
  if (c.req.header("Origin") !== origin(c))
    fail(403, "invalid_origin", "Consent must come from this application.");
  const redirect = new URL(body.redirect_uri);
  if (body.state) redirect.searchParams.set("state", body.state);
  if (raw.decision !== "allow") {
    redirect.searchParams.set("error", "access_denied");
    return c.redirect(redirect.toString(), 302);
  }
  const code = secret();
  await c.env.DB.prepare(
    "INSERT INTO oauth_codes(hash,client_id,user_id,redirect_uri,challenge,resource,expires_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      await hash(code),
      body.client_id,
      owner(c),
      body.redirect_uri,
      body.code_challenge,
      body.resource,
      Date.now() + 300000,
    )
    .run();
  redirect.searchParams.set("code", code);
  return c.redirect(redirect.toString(), 302);
});
oauthRoutes.post("/oauth/token", async (c) => {
  await rateLimit(c, "oauth-token", 100);
  const raw = await c.req.parseBody();
  const clientId = z.string().min(1).parse(raw.client_id);
  const resource = z.string().url().parse(raw.resource);
  if (resource !== `${origin(c)}/mcp`)
    fail(400, "invalid_target", "Invalid token resource.");
  let userId: string;
  let family: string;
  if (raw.grant_type === "authorization_code") {
    const body = z
      .object({
        code: z.string().min(20),
        redirect_uri: z.string().url(),
        code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      })
      .parse(raw);
    const code = await c.env.DB.prepare(
      "DELETE FROM oauth_codes WHERE hash=? AND client_id=? AND redirect_uri=? AND challenge=? AND resource=? AND expires_at>? RETURNING user_id",
    )
      .bind(
        await hash(body.code),
        clientId,
        body.redirect_uri,
        await hash(body.code_verifier),
        resource,
        Date.now(),
      )
      .first<{ user_id: string }>();
    if (!code)
      fail(
        400,
        "invalid_grant",
        "Code is invalid, expired, already used, or PKCE does not match.",
      );
    userId = code.user_id;
    family = id();
  } else if (raw.grant_type === "refresh_token") {
    const refresh = z.string().min(20).parse(raw.refresh_token);
    const token = await c.env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE hash=? AND client_id=? AND resource=? AND kind=? AND expires_at>? RETURNING user_id,family",
    )
      .bind(await hash(refresh), clientId, resource, "refresh", Date.now())
      .first<{ user_id: string; family: string }>();
    if (!token)
      fail(400, "invalid_grant", "Refresh token is invalid or expired.");
    userId = token.user_id;
    family = token.family;
    await c.env.DB.prepare("DELETE FROM oauth_tokens WHERE family=?")
      .bind(family)
      .run();
  } else
    return fail(
      400,
      "unsupported_grant_type",
      "Use authorization_code or refresh_token.",
    );
  const access = secret();
  const refresh = secret();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      await hash(access),
      userId,
      clientId,
      resource,
      "access",
      Date.now() + 3600000,
      family,
    ),
    c.env.DB.prepare(
      "INSERT INTO oauth_tokens(hash,user_id,client_id,resource,kind,expires_at,family) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      await hash(refresh),
      userId,
      clientId,
      resource,
      "refresh",
      Date.now() + 30 * 86400000,
      family,
    ),
  ]);
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refresh,
    scope: "studio",
  });
});
oauthRoutes.post("/oauth/revoke", async (c) => {
  const body = z
    .object({ token: z.string(), client_id: z.string() })
    .parse(await c.req.parseBody());
  await c.env.DB.prepare(
    "DELETE FROM oauth_tokens WHERE family IN (SELECT family FROM oauth_tokens WHERE hash=? AND client_id=?)",
  )
    .bind(await hash(body.token), body.client_id)
    .run();
  return c.json({ ok: true });
});
