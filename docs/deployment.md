# Deployment and self-hosting

The live application is [studio.agentkit.best](https://studio.agentkit.best). Cloudflare and Node run the same [Hono handler](../server/index.ts), with runtime-specific transport composition in the [Worker entry point](../server/worker.ts) and [Node entry point](../server/node.ts). Runtime settings are owned by [.env.example](../.env.example), [wrangler.jsonc](../wrangler.jsonc), [compose.yaml](../compose.yaml), and the [Node entry point](../server/node.ts).

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

Missing browser configuration returns a capability error for server PNG/PDF/PPTX/video/GLB/glTF; JSON/HTML/SVG and React source ZIP do not require a browser. Verify health, sessions, persisted revisions, authenticated MCP, immutable publication, and actual export bytes after deployment. Release observations belong in the [finalization report](../plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md).

### Automatic production deployment

The [GitHub Actions workflow](../.github/workflows/ci.yml) verifies pull requests and pushes to `main`. A successful `main` run deploys to the `production` environment: it downloads the static assets built and tested by the verification job, applies pending D1 migrations, deploys the same commit with Wrangler, and checks public health/OAuth discovery. Pull requests never deploy. Deployments are serialized, and a superseded commit is skipped before deployment starts.

Configure repository or production-environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the account owning the resources in `wrangler.jsonc`. The token needs deployment access to Workers Scripts, the custom-domain zone/routes, and D1 migrations, with any binding permissions required by Wrangler. Keep its scope restricted to that account and zone. [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) describes CI authentication.

The workflow preserves dashboard variables with `--keep-vars` and does not upload or replace runtime secrets. Keep the existing `ENCRYPTION_KEY` and GitHub OAuth secrets on the Worker. CI's public probes do not create accounts, invoke paid providers, or prove a complete ChatGPT login; browser OAuth behavior is covered by the isolated verification suite.

### Beta deployment from dev

Pushes to `dev` run the separate [beta workflow](../.github/workflows/beta.yml). It runs the same verification, CLI packaging and browser checks before deploying the verified static artifact to [beta.studio.agentkit.best](https://beta.studio.agentkit.best). Beta documentation is built with its own `PUBLIC_SITE_URL`; its OAuth audience and callbacks use the beta origin.

The `beta` environment in [wrangler.jsonc](../wrangler.jsonc) owns a separate Worker, D1 database and R2 bucket. It does not share production accounts, sessions, stored provider keys or assets. Provision a separate stable `ENCRYPTION_KEY` on the beta Worker once and preserve it thereafter. GitHub/Google integrations need beta-specific approved callback/origin configuration; production OAuth secrets are not copied automatically.

The GitHub `beta` environment uses repository-level Cloudflare CI secrets unless environment-level overrides are configured. Beta deployments serialize independently of production and skip superseded `dev` commits. Migration/deploy commands must explicitly select beta:

```sh
npm run cf -- d1 migrations apply design-studio-ai-beta --remote --env beta
npm run cf -- secret put ENCRYPTION_KEY --env beta
PUBLIC_SITE_URL=https://beta.studio.agentkit.best npm run build
npm run cf -- deploy --env beta --keep-vars
```

Production remains deployed only from `main`. Back up beta data with its own encryption key; rolling back beta code must not reset its database or touch production bindings. Connector runtime probes and acceptance evidence remain separate from beta deployment health.

## Optional integrations

### GitHub sign-in

Create a GitHub OAuth App with callback `https://YOUR_ORIGIN/api/auth/github/callback`. Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_CALLBACK_URL` in the application runtime; the callback must exactly match `APP_URL`'s origin and this path. Keep `ENCRYPTION_KEY` configured for encrypted short-lived PKCE verifiers. For Cloudflare, set these values with Wrangler secrets; for Node, export them before starting the server. Compose forwards the three variables from its environment.

The sign-in dialog displays **Continue with GitHub** when configured. Requests use `read:user user:email`, S256 PKCE, a browser-bound state cookie, and a one-use ten-minute database record. The application uses the stable GitHub numeric ID and a verified GitHub email for new accounts; provider access tokens are used transiently and are not saved. An email collision does not merge accounts: sign in using the existing password and choose **Settings → Your account → Connect GitHub**. Linking requires the same active browser session through the callback. Disabling registration still permits sign-in for already-linked identities.

Operator reference: [GitHub's web application OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). Never put the client secret in client-side code, public configuration, or the repository.

### Design providers and Google Slides

[Providers](providers.md) require per-user BYOK keys and model access. Custom compatible origins require the operator's `PROVIDER_ALLOWED_ORIGINS` HTTPS allowlist. There is no general-purpose URL-fetch proxy. Connector transport primitives use DNS-pinned public HTTPS on Node and native public-only fetch on Cloudflare; keep `global_fetch_strictly_public` enabled in the Workers configuration. Do not replace that transport with a service or private-network binding. Connector management and execution are still under implementation.

Google browser authorization needs `GOOGLE_CLIENT_ID`, a Google OAuth web client with the application origin authorized, and the Slides API enabled. The user grants the presentations scope; access tokens are transient. API/CLI clients may supply an independently obtained short-lived token. Native Slides export currently rejects unsupported complex nodes and private image URLs.

### Google Fonts catalog

Optional `GOOGLE_FONTS_API_KEY` is a server-only Google Developer API key for full font catalog discovery. Export it for Node or configure a Cloudflare secret of that name. For Compose, pass it explicitly in the service environment when desired. Missing configuration uses a labeled curated catalog. Browser previews require access to `fonts.googleapis.com` and `fonts.gstatic.com`; cloud exports fetch bounded font assets server-side and embed them into the isolated renderer. Font loading does not expose the catalog key to the browser.

Design-system persistence requires the additive `0007-design-systems.sql` migration. Apply outstanding migrations before serving the new routes; preserve existing project and encryption data.

### Activity retention and optional PostHog

Activity records live in the application's database and require the additive observability migration. Apply outstanding [migrations](../migrations) before serving the new code; never reset existing projects to initialize telemetry. Queries exclude records older than 30 days. The [store maintenance owner](../server/observability-store.ts) removes old rows in bounded batches during activity, so exclusion is immediate at the query boundary while physical cleanup can lag on idle or heavily backlogged installations. Backups have their own retention policy.

Set `OBSERVABILITY_ADMIN_IDS` to a comma-separated list of explicit application user IDs only when those people need the global activity view. All other reads default to owner scope. Global access requires that operator's application session or API key; OAuth access remains owner-scoped even for the same account. Treat this setting as privileged access, independent of a browser navigation link.

Optional PostHog forwarding requires both server-runtime `POSTHOG_PROJECT_KEY` and `POSTHOG_HOST`. Use the intended PostHog ingestion origin for your project/region: an HTTPS origin without credentials, path, query, or fragment. Do not infer a host or claim analytics is enabled from a key alone. Keep the key in runtime secrets, not source, browser configuration, or documentation. Inject these variables into the Node process or Cloudflare runtime, and use the owning Compose configuration for containers.

[Forwarding](../server/observability-posthog.ts) sends only allowlisted client-event fields, including pseudonymous actor/project/trace IDs where applicable. It excludes free text, document content, full URLs, and credentials; person-profile creation and IP geolocation are disabled in the payload. This is not session replay or automatic capture. The receiver controls its own retention; the local 30-day rule does not delete copies held by PostHog.

Use the Activity coverage indicators to verify configured state, delivery failures, and last successful delivery. Configuration is not proof of receipt in PostHog; inspect the intended project after an authorized event. Forwarding failures do not change the product operation's result. Delivery/drop counters describe the current runtime instance and reset on restart, so they are not durable accounting. Provider token/cost fields can be unavailable; this view is operational evidence, not a complete billing ledger.

Custom provider connections require their exact HTTPS origin in `PROVIDER_ALLOWED_ORIGINS` (comma-separated). Users supply the API version path in Settings. Migration `0009-custom-providers.sql` adds connection metadata without rewriting keys; preserve the existing encryption secret. Unlisted origins remain blocked when saving and generating.

## Backups and rollback

Back up relational data, binary assets, and the encryption secret together. Stop Node writes before copying SQLite/files, or use a SQLite-consistent backup procedure; copying only an active database file may miss journaled changes. Use D1 backup/export and R2 object backups for Cloudflare. Missing assets or encryption keys cannot be repaired by a database-only restore.

Roll code back to a known deployment while preserving data and checking schema compatibility. Migrations are not automatically reversed. Rotate exposed API/provider tokens independently of the storage encryption key. Stop development/test processes started for verification when their work finishes.

## Dependency security

The initial audit reported five high-severity findings through upstream browser-download and PowerPoint dependencies, including `extract-zip` under `@cloudflare/puppeteer` and `image-size`. No compatible complete fix was available in that dependency tree. Run `npm audit` against the current lockfile and monitor upstream updates; the tree must not be described as audit-clean.

The affected browser-downloading code is not used by the Cloudflare runtime. PowerPoint raster inputs are application-generated PNGs; uploaded media passes type/signature validation, and cloud rendering blocks external fetches. These boundaries reduce exposure without erasing the upstream findings. Successful tests and deployment do not establish a clean dependency audit.

For additional browser checks, install Firefox/WebKit with `npx playwright install firefox webkit`, then run `STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/editor-ergonomics.spec.ts tests/observability-ui.spec.ts --project=firefox` (repeat with `--project=webkit`). Each invocation uses an isolated database; the default release suite covers Chromium desktop/mobile.


## Experimental external connector setup

`CONNECTORS_ENABLED=true` enables MCP setup, project bindings/sources, reviewed tool operations and persisted design runs owned by [connector-routes.ts](../server/connector-routes.ts). It is off by default; disabled execution/setup routes return `connector_unconfigured`; authorized operation/run inspection and cancellation remain available for recovery. Set it in the Node process environment or Cloudflare Worker variables only after applying all migrations. No production or beta flag is changed merely by a local build.

Outgoing OAuth publishes a first-party client metadata document at `/api/connectors/mcp/client-metadata`, using the HTTPS `APP_URL` origin and exact `/api/connectors/mcp/callback` redirect. Setup requires a signed-in browser session and matching Origin. The callback requires that same session. Successful setup verifies protocol access. People then select project tools and sources in the editor. Run steps execute only on explicit requests; no background queue or automatic model retry is started.

Node startup performs bounded connector retention and private-object cleanup after migration. Authenticated connector requests also perform maintenance for Workers; project deletion queues snapshot objects durably and attempts cleanup. Failed storage deletions remain queued for a later request or restart. Preserve the existing encryption key.


Operation arguments/results and run context are encrypted with the existing `ENCRYPTION_KEY`. Apply every migration before enabling routes; do not rewrite applied migration files. Private run payloads expire after seven days; completed operation payloads use the same retention period. Metadata remains available for recovery. An expired execution lease becomes `outcome_unknown`, not a retryable job. Outgoing MCP continuations retain the opaque server state and require new exact human approval.

The MCP client bounds catalog size, response size, schema depth, request duration and advertised tools. Model adapters preserve provider-native tool-call IDs and continuation data for OpenAI-compatible, Anthropic and Gemini protocols. Deterministic HTTP-peer tests establish those wire contracts; they do not establish that every model supports tools or that a real provider call succeeded. Keep the feature disabled on deployed environments until their separate live acceptance has been recorded.

### Stored Google Drive connections (experimental)

Stored Drive authorization uses separate `GOOGLE_CONNECTOR_CLIENT_ID` and `GOOGLE_CONNECTOR_CLIENT_SECRET`; it does not reuse the legacy Slides browser token. Register `${APP_URL}/api/connectors/google-drive/callback` on the OAuth web client, enable Drive, Slides and Picker APIs, and configure the consent screen/test users. The connector requests `openid`, `email` and `drive.file`, with offline access. Configure `GOOGLE_PICKER_APP_ID` as the same Google Cloud project's numeric project number and `GOOGLE_PICKER_API_KEY` as its browser-restricted Picker key. Permit the exact application origin on that key. Preserve `ENCRYPTION_KEY`.

The signed-in browser receives only a short-lived access token for Picker in memory. It never receives the refresh token or OAuth client secret. Picker selection does not grant access to folder descendants. Server reads intersect project and agent file selections and validate the selected account's access. Supported imports currently include Google Docs text, UTF-8 text/Markdown/JSON, image snapshots and text-based PDFs. PDF extraction is limited to 2 MiB, 20 pages and 256 KiB extracted text; its cooperative deadline is not a measured CPU budget. Local workerd has verified PDF extraction; edge account limits still need rollout validation. Image snapshots can be copied into isolated project assets through the shared media validator, without modifying the document.

A selected destination exposes `create_google_slides` through the shared approval workflow. It converts the saved revision using the same native conversion as legacy export; unsupported nodes/private images fail before creation. The service records a returned presentation ID before folder placement and content population. A partial or uncertain result is never automatically dispatched again. Inspect the recorded ID before replacement work. PDF/PPTX uploads use the actual renderer, private staged bytes and a preallocated Drive ID. Download the prepared file from the action review before approving. Apply the connector export-artifact migration; expiry/deletion queues staged objects for cleanup. An explicit reconciliation action for uncertain uploads reads the reserved file, verifies its destination, operation marker and actual byte hash, then settles the local status without uploading again. Partial native Slides results currently require manual inspection by their recorded presentation ID. These routes have isolated HTTP-peer evidence, not live Google acceptance; keep deployment enablement subject to the connector rollout gates.


### Stored GitHub App connections (experimental)

Configure `GITHUB_CONNECTOR_APP_ID`, `GITHUB_CONNECTOR_PRIVATE_KEY` (PEM), `GITHUB_CONNECTOR_CLIENT_ID`, `GITHUB_CONNECTOR_CLIENT_SECRET` and `GITHUB_CONNECTOR_WEBHOOK_SECRET` separately from Studio's GitHub login. Register `${APP_URL}/api/connectors/github/callback` and `${APP_URL}/api/connectors/github/webhook` on this App. Enable installation, installation-repository and GitHub App authorization events. Apply the webhook-delivery migration before receiving events. Signed duplicate deliveries are idempotent; interrupted revocation can finish on redelivery. Uninstall, suspension, repository removal and user authorization revocation invalidate affected local credentials/grants and in-flight work.

Install the App only on selected repositories. Source access needs contents read; React PR export additionally needs contents write and pull requests write. App permission upgrades require GitHub's own approval. Studio verifies user access before issuing a short-lived installation token restricted to one repository; tokens and the signing key never reach the browser. Account setup takes the numeric installation ID from GitHub's installation settings. Project setup lists accessible repositories, resolves a ref to a commit and selects explicit source paths or export directories.

React export stages the actual ZIP and file-change review before approval. It preserves unrelated files, blocks workflow/credential paths and symlink/submodule traversal, checks the base branch against the selected commit and records branch/tree/commit/PR identities. Unknown writes are not replayed. Read-only reconciliation can settle a known completed PR; otherwise inspect partial remote IDs. GitHub API errors, exhausted rate limits and changed access remain explicit failures. Local HTTP-peer tests and workerd RSA-signing evidence do not establish a successful live GitHub installation or PR.

MCP project discovery caches at most eight bounded catalogs for 30 seconds, partitioned by deployment, owner, connection/credential, principal and selected policy. Permission checks still run on cache hits; execution always reloads the tool schema before claiming the exact approval.
