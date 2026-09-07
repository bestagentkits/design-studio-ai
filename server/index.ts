import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env, User } from "./types";
import {
  ApiError,
  authenticate,
  fail,
  hash,
  id,
  now,
  origin,
  owner,
  passwordHash,
  passwordMatches,
  rateLimit,
  secret,
} from "./security";
import { projectRoutes, published, serveAsset } from "./projects";
import { generationRoutes, providerRoutes } from "./providers";
import { oauthRoutes } from "./oauth";
import { googleRoutes } from "./google-slides";
import { handleMcp } from "./mcp";
import { exportRoutes } from './exports';
import { conversationRoutes } from './conversations';
export const app = new Hono<Env>();
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/oauth/"))
    c.header("Cache-Control", "no-store");
  await next();
});
app.use(
  "*",
  bodyLimit({
    maxSize: 21 * 1024 * 1024,
    onError: (c) =>
      c.json(
        {
          error: { code: "body_too_large", message: "Request exceeds 21 MB." },
        },
        413,
      ),
  }),
);
app.use("*", async (c, next) => {
  await authenticate(c);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (
    mutation &&
    (c.get("authMethod") === "session" ||
      c.req.path === "/api/auth/login" ||
      c.req.path === "/api/auth/register")
  ) {
    const trustedOrigins = [
      origin(c),
      ...(c.env.TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
    ];
    if (!trustedOrigins.includes(c.req.header("Origin") ?? ""))
      fail(
        403,
        "invalid_origin",
        "Request origin must match this application.",
      );
  }
  await next();
});
app.onError((error, c) => {
  if (c.req.path.startsWith("/oauth/")) {
    const code = error instanceof ApiError ? error.code : "invalid_request";
    const message =
      error instanceof ApiError
        ? error.message
        : "OAuth request validation failed.";
    return c.json(
      { error: code, error_description: message },
      (error instanceof ApiError ? error.status : 400) as ContentfulStatusCode,
    );
  }
  if (error instanceof ApiError)
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as ContentfulStatusCode,
    );
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: "invalid_input",
          message: "Request validation failed.",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
      },
      400,
    );
  if (error instanceof SyntaxError)
    return c.json(
      {
        error: {
          code: "invalid_json",
          message: "Request body is not valid JSON.",
        },
      },
      400,
    );
  console.error("Request failed", error.name);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected server error occurred.",
      },
    },
    500,
  );
});
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "design-studio-ai" }),
);
app.get("/api/config", (c) =>
  c.json({
    googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
    allowRegistration: c.env.ALLOW_REGISTRATION === "true",
  }),
);
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});
async function session(c: Parameters<typeof owner>[0], user: User) {
  const token = secret();
  await c.env.DB.prepare(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)",
  )
    .bind(await hash(token), user.id, Date.now() + 7 * 86400000)
    .run();
  setCookie(c, "studio_session", token, {
    httpOnly: true,
    secure: origin(c).startsWith("https:"),
    sameSite: "Lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
app.post("/api/auth/register", async (c) => {
  if (c.env.ALLOW_REGISTRATION !== "true")
    fail(
      403,
      "registration_disabled",
      "Registration is disabled by the operator.",
    );
  await rateLimit(c, "register", 5);
  const body = credentials.parse(await c.req.json());
  const user = {
    id: id(),
    email: body.email,
    name: body.name ?? body.email.split("@")[0],
  };
  const password = await passwordHash(body.password);
  try {
    await c.env.DB.prepare(
      "INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(user.id, user.email, user.name, password, now())
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      fail(409, "email_registered", "This email is already registered.");
    throw error;
  }
  await session(c, user);
  return c.json({ user }, 201);
});
app.post("/api/auth/login", async (c) => {
  await rateLimit(c, "login", 20);
  const body = credentials.parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE email=?")
    .bind(body.email)
    .first<User & { password: string }>();
  const valid = await passwordMatches(
    body.password,
    row?.password ??
      "pbkdf2:100000:missing-user:0000000000000000000000000000000000000000000",
  );
  if (!row || !valid)
    fail(401, "invalid_credentials", "Email or password is incorrect.");
  const user = { id: row.id, email: row.email, name: row.name };
  await session(c, user);
  return c.json({ user });
});
app.get("/api/auth/me", (c) => c.json({ user: c.get("user") }));
app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, "studio_session");
  if (token)
    await c.env.DB.prepare("DELETE FROM sessions WHERE hash=?")
      .bind(await hash(token))
      .run();
  deleteCookie(c, "studio_session", { path: "/" });
  return c.json({ ok: true });
});
app.use("/api/projects/*", async (c, next) => {
  owner(c);
  await next();
});
app.route("/api/projects", projectRoutes);
app.route("/api/projects", generationRoutes);
app.route("/api/projects", googleRoutes);
app.route('/api/projects', exportRoutes);
app.route('/api/projects', conversationRoutes);
app.get("/api/assets/:id", (c) => serveAsset(c, c.req.param("id")));
app.get("/published/:slug", (c) => published(c, c.req.param("slug")));
app.get("/published/:slug/assets/:id", (c) =>
  serveAsset(c, c.req.param("id"), c.req.param("slug")),
);
app.use('/api/providers/*', async (c, next) => { if (c.get('tokenKind') === 'oauth') fail(403, 'insufficient_scope', 'MCP authorization does not grant provider credential management. Use your account session or API key.'); await next(); });
app.use('/api/tokens/*', async (c, next) => { if (c.get('tokenKind') === 'oauth') fail(403, 'insufficient_scope', 'MCP authorization cannot create or manage permanent credentials.'); await next(); });
app.route("/api/providers", providerRoutes);
app.get("/api/tokens", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id,name,created_at as createdAt,last_used_at as lastUsedAt FROM api_tokens WHERE user_id=? ORDER BY created_at DESC",
  )
    .bind(owner(c))
    .all();
  return c.json({ tokens: rows.results });
});
app.post("/api/tokens", async (c) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100) })
    .parse(await c.req.json());
  const token = `dsa_${secret()}`;
  const tokenId = id();
  await c.env.DB.prepare(
    "INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(tokenId, owner(c), body.name, await hash(token), now())
    .run();
  return c.json({ id: tokenId, token }, 201);
});
app.delete("/api/tokens/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM api_tokens WHERE id=? AND user_id=?")
    .bind(c.req.param("id"), owner(c))
    .run();
  return c.json({ ok: true });
});
app.route("/", oauthRoutes);
app.all("/mcp", (c) => handleMcp(c, app));
app.notFound((c) => {
  if (
    c.req.path.startsWith("/api/") ||
    c.req.path.startsWith("/oauth/") ||
    c.req.path.startsWith("/published/")
  )
    return c.json(
      { error: { code: "not_found", message: "Route not found." } },
      404,
    );
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text(
    "Design Studio AI frontend is not built. Run npm run build.",
    404,
  );
});
export default app;
