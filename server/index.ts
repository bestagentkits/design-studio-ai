import { documentSaveSchema } from '../src/shared/document-save-contract';
import {documentWriteSchema} from '../src/shared/document-write';
import {motionProposalSchema} from '../src/shared/motion-proposal';
import {exportOptionsSchema} from '../src/shared/export-contract';
import { providerSettingsSchema, providerIdSchema, builtInProviders } from '../src/shared/providers';
import { mediaInputSchema, generationInputSchema, providerInterviewSchema } from '../src/shared/provider-requests';
import { telemetryQuerySchema, clientEventSchema } from '../src/shared/observability';
import { observabilityMiddleware, bindTelemetryActor, errorCode } from './observability';
import { observabilityRoutes } from './observability-routes';
import { isObservabilityOperator } from './observability-queries';
import { posthogConfig } from './observability-posthog';
import { openApiDocument } from '../src/shared/api-reference';
import { collaborationRoutes } from './collaboration';
import { designSystemRoutes } from './design-systems';
import { discoveryRoutes } from './discovery';
import { designSystemSchema, systemApplySchema, systemUpdateSchema } from '../src/shared/design-systems';
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
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
  createSession,
} from "./security";
import { projectRoutes, published, serveAsset } from "./projects";
import { generationRoutes, providerRoutes } from "./providers";
import { oauthRoutes } from "./oauth";
import { googleRoutes } from "./google-slides";
import { handleMcp } from "./mcp";
import { exportRoutes } from './exports';
import { conversationRoutes } from './conversations';
import { githubRoutes, githubEnabled } from './github-login';
import { documentSchema } from '../src/shared/schema';
import { operationsSchema } from '../src/shared/operations';
import { themes, templates, blocks } from '../src/shared/catalog';
import { briefRoutes } from './briefs';
import { interviewSchema, scopeSchema } from '../src/shared/brief';
import { inspectDesign } from '../src/shared/design-checks';
import { projectRow } from './projects';
export const app = new Hono<Env>();
app.use("*", observabilityMiddleware);
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
  await bindTelemetryActor(c);
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
  c.set("telemetryErrorCode", errorCode(error));
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
app.get('/api/openapi', c => c.json(openApiDocument({'PUT /api/projects/{id}/document':z.toJSONSchema(documentWriteSchema),'POST /api/projects/{id}/export':z.toJSONSchema(exportOptionsSchema), 'PUT /api/providers/{provider}': z.toJSONSchema(providerSettingsSchema), 'POST /api/projects/{id}/media': z.toJSONSchema(mediaInputSchema), 'POST /api/projects/{id}/generate': z.toJSONSchema(generationInputSchema), 'POST /api/projects/{id}/brief/interview': z.toJSONSchema(providerInterviewSchema), document: z.toJSONSchema(documentSchema), operations: z.toJSONSchema(operationsSchema), designSystem: z.toJSONSchema(designSystemSchema), 'POST /api/observability/client-events': z.toJSONSchema(clientEventSchema), 'POST /api/design-systems': z.toJSONSchema(designSystemSchema), 'PUT /api/design-systems/{id}': z.toJSONSchema(systemUpdateSchema), 'POST /api/design-systems/{id}/apply': z.toJSONSchema(systemApplySchema) })));
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "design-studio-ai" }),
);
app.get('/api/schema', c => c.json({ supportedDocumentVersions: [1,2], documentSave:z.toJSONSchema(documentWriteSchema), providers: builtInProviders, providerId: z.toJSONSchema(providerIdSchema), providerSettings: z.toJSONSchema(providerSettingsSchema), mediaInput: z.toJSONSchema(mediaInputSchema), generationInput: z.toJSONSchema(generationInputSchema), documentWrite:z.toJSONSchema(documentWriteSchema),motionProposal:z.toJSONSchema(motionProposalSchema),exportInput:z.toJSONSchema(exportOptionsSchema), providerInterview: z.toJSONSchema(providerInterviewSchema), document: z.toJSONSchema(documentSchema), operations: z.toJSONSchema(operationsSchema), designSystem: z.toJSONSchema(designSystemSchema), interview: z.toJSONSchema(interviewSchema), scope: z.toJSONSchema(scopeSchema), observabilityQuery: z.toJSONSchema(telemetryQuerySchema), clientEvent: z.toJSONSchema(clientEventSchema) }));
app.get('/api/catalog', c => c.json({ themes, templates, blocks }));
app.get("/api/config", (c) =>
  c.json({
    googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
    allowRegistration: c.env.ALLOW_REGISTRATION === "true",
    githubEnabled: githubEnabled(c),
    observability: { operator: isObservabilityOperator(c), retentionDays: 30 },
    analytics: { enabled: true, posthogConfigured: !!posthogConfig(c.env) },
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
app.route('/api/observability', observabilityRoutes);
app.route('/api/auth/github', githubRoutes);
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
  await createSession(c, user);
  c.set("user", user); c.set("authMethod", "session");
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
  await createSession(c, user);
  c.set("user", user); c.set("authMethod", "session");
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
app.route('/api/design-systems', designSystemRoutes);
app.route('/api', discoveryRoutes);
app.route("/api/projects", collaborationRoutes);
app.route("/api/projects", generationRoutes);
app.route("/api/projects", googleRoutes);
app.route('/api/projects', exportRoutes);
app.route('/api/projects', conversationRoutes);
app.route('/api/projects', briefRoutes);
app.get('/api/projects/:id/checks', async c => {
  const project = await projectRow(c, c.req.param('id'));
  return c.json({projectId:project.id, revision:project.revision, ...inspectDesign(JSON.parse(project.document))});
});
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
