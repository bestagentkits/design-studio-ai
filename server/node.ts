import { maintainConnectorState } from './connector-retention';
import { cleanupConnectorObjects } from './connector-object-cleanup';
import { createNodeConnectorFetch } from './connector-transport-node';
import { serve } from "@hono/node-server";
import { materializeNodeRequest } from './node-request';
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { app } from "./index";
import { FileBucket, SqliteDatabase, staticAssets } from "./node-adapters";
import type { Bindings } from "./types";
import { launchExportBrowser } from './export-node';
const dataDir = resolve(process.env.DATA_DIR ?? "data");
await mkdir(dataDir, { recursive: true });
const db = new SqliteDatabase(resolve(dataDir, "studio.sqlite"));
await db.exec(
  "CREATE TABLE IF NOT EXISTS studio_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
);
for (const name of (await readdir(resolve("migrations")))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  if (
    await db
      .prepare("SELECT name FROM studio_migrations WHERE name=?")
      .bind(name)
      .first()
  )
    continue;
  const sql = await readFile(resolve("migrations", name), "utf8");
  db.native.exec("BEGIN IMMEDIATE");
  try {
    db.native.exec(sql);
    db.native
      .prepare("INSERT INTO studio_migrations(name,applied_at) VALUES(?,?)")
      .run(name, new Date().toISOString());
    db.native.exec("COMMIT");
  } catch (error) {
    db.native.exec("ROLLBACK");
    throw error;
  }
}
const port = Number(process.env.PORT ?? 8787);
const env: Bindings = {
  CONNECTORS_ENABLED: (() => { const { env: variables } = process; return variables.CONNECTORS_ENABLED; })(),
  CONNECTOR_FETCH: createNodeConnectorFetch(),
  GOOGLE_FONTS_API_KEY: (() => { const { env: variables } = process; return variables.GOOGLE_FONTS_API_KEY; })(),
  DB: db,
  ASSETS_BUCKET: new FileBucket(resolve(dataDir, "assets")),
  ASSETS: staticAssets(resolve("dist")),
  EXPORT_BROWSER: launchExportBrowser,
  APP_URL: process.env.APP_URL ?? `http://localhost:${port}`,
  ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION ?? "true",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  PROVIDER_ALLOWED_ORIGINS: process.env.PROVIDER_ALLOWED_ORIGINS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  OBSERVABILITY_ADMIN_IDS: process.env.OBSERVABILITY_ADMIN_IDS,
  POSTHOG_PROJECT_KEY: process.env.POSTHOG_PROJECT_KEY,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
  TRUSTED_ORIGINS:
    process.env.TRUSTED_ORIGINS ??
    (process.env.NODE_ENV === "production"
      ? ""
      : "http://localhost:5173,http://127.0.0.1:5173"),
};
await maintainConnectorState(env);
await cleanupConnectorObjects(env);
const server = serve(
  {
    fetch: (request, connection) => {
      // The socket is authoritative on self-hosted Node; never trust a client-supplied Cloudflare IP header.
      request.headers.set(
        "CF-Connecting-IP",
        connection.incoming.socket.remoteAddress ?? "local",
      );
      return app.fetch(materializeNodeRequest(request), env);
    },
    // Preserve native fetch Response identity for outgoing OAuth SDK error parsing.
    overrideGlobalObjects: false,
    port,
    hostname: process.env.HOST ?? "127.0.0.1",
  },
  () =>
    console.log(
      `Design Studio AI listening on http://${process.env.HOST ?? "127.0.0.1"}:${port}`,
    ),
);
const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
