# Deployment and self-hosting

The live application is [studio.agentkit.best](https://studio.agentkit.best). Cloudflare and Node run the same [Hono handler](../server/index.ts). Runtime settings are owned by [.env.example](../.env.example), [wrangler.jsonc](../wrangler.jsonc), [compose.yaml](../compose.yaml), and the [Node entry point](../server/node.ts).

## Local Node

Install Node 24+, then run `npm ci`, `npm ci --prefix packages/cli`, `npm run build:cli`, `npx playwright install chromium`, and `npm run build`. Linux may require `npx playwright install --with-deps chromium`.

Set the server process environment. PowerShell:

```powershell
$env:ENCRYPTION_KEY = '<your stable 32-byte base64 key>'
$env:APP_URL = 'http://localhost:8787'
$env:DATA_DIR = './data'
npm start
```

Bash:

```sh
export ENCRYPTION_KEY='<your stable 32-byte base64 key>'
export APP_URL='http://localhost:8787'
export DATA_DIR='./data'
npm start
```

Generate a key once using `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and store it securely. Keep it stable across restarts. The Node server does not load `.env` automatically. To load a dedicated local file explicitly, use `node --env-file=.env.local --import tsx server/node.ts`; never commit that file.

`APP_URL` must be the canonical external origin, including HTTPS behind a reverse proxy. It controls OAuth audience/URLs and origin checks. Node binds to `127.0.0.1` by default; use `HOST=0.0.0.0` for a container or trusted network. Port defaults to 8787. SQLite and assets persist under `DATA_DIR`; missing SQL migrations apply transactionally at startup. Set `ALLOW_REGISTRATION=false` to close public signup, and `NODE_ENV=production` for an exposed Node server. Configure `TRUSTED_ORIGINS` only for actual trusted application origins.

For development, run `npm run dev:api` and `npm run dev` separately. Vite proxies API requests. The Node adapter permits its local development origins on port 5173 when not in production mode.

## Docker Compose

[Dockerfile](../Dockerfile) builds the app, installs Chromium/dependencies, and runs as the non-root `node` user. [compose.yaml](../compose.yaml) requires an encryption key and mounts a persistent named volume.

Provide a dedicated Compose `.env` with the stable key and canonical `APP_URL`, or export those variables:

```sh
docker compose up --build -d
docker compose logs --tail=100 studio
```

Check `/api/health`, then authenticate and create/save/reload a project. The service exposes 8787 and stores data in `studio-data` at `/data`. `docker compose down` retains the volume; adding `--volumes` destroys it. Terminate TLS at a reverse proxy. Provider keys are entered per user in Settings, not baked into the image.

## Cloudflare

The committed [manifest](../wrangler.jsonc) owns custom-domain, D1, R2, static-asset, and Browser Rendering bindings. A different operator must provision their own resources and update the manifest. Custom-domain deployment requires control of its Cloudflare zone; cloud binary exports require Browser Rendering access.

The [Cloudflare helper](../scripts/cloudflare.mjs) loads local `.env` and `screenshots.env` when present. These are deployment credential sources and must remain ignored; they are not self-host configuration templates. Inject `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` securely. Never copy token values into docs or command history.

After provisioning the configured resources:

```sh
npm run cf -- d1 migrations apply design-studio-ai --remote
npm run cf -- secret put ENCRYPTION_KEY
npm run deploy
```

Enter the stable encryption key at Wrangler's prompt. Other installations must substitute their configured database name. Keep `APP_URL` synchronized with the custom domain. Deploy builds the application and trusted renderer; it does not automatically migrate D1. Apply required migrations before the code that uses them.

Missing browser configuration returns a capability error for server PNG/PDF/PPTX/video; JSON/HTML/SVG do not require a browser. Verify health, sessions, persisted revisions, authenticated MCP, immutable publication, and actual export bytes after deployment. Release observations belong in the [finalization report](../plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md).

## Optional integrations

[Providers](providers.md) require per-user BYOK keys and model access. Custom compatible origins require the operator's `PROVIDER_ALLOWED_ORIGINS` HTTPS allowlist. There is no general-purpose URL-fetch proxy.

Google browser authorization needs `GOOGLE_CLIENT_ID`, a Google OAuth web client with the application origin authorized, and the Slides API enabled. The user grants the presentations scope; access tokens are transient. API/CLI clients may supply an independently obtained short-lived token. Native Slides export currently rejects unsupported complex nodes and private image URLs.

## Backups and rollback

Back up relational data, binary assets, and the encryption secret together. Stop Node writes before copying SQLite/files, or use a SQLite-consistent backup procedure; copying only an active database file may miss journaled changes. Use D1 backup/export and R2 object backups for Cloudflare. Missing assets or encryption keys cannot be repaired by a database-only restore.

Roll code back to a known deployment while preserving data and checking schema compatibility. Migrations are not automatically reversed. Rotate exposed API/provider tokens independently of the storage encryption key. Stop development/test processes started for verification when their work finishes.

## Dependency security

The initial audit reported five high-severity findings through upstream browser-download and PowerPoint dependencies, including `extract-zip` under `@cloudflare/puppeteer` and `image-size`. No compatible complete fix was available in that dependency tree. Run `npm audit` against the current lockfile and monitor upstream updates; the tree must not be described as audit-clean.

The affected browser-downloading code is not used by the Cloudflare runtime. PowerPoint raster inputs are application-generated PNGs; uploaded media passes type/signature validation, and cloud rendering blocks external fetches. These boundaries reduce exposure without erasing the upstream findings. Successful tests and deployment do not establish a clean dependency audit.
