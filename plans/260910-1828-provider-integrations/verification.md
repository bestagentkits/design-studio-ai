# Provider integration delivery evidence

Date: 2026-09-10. Base: 3545d18. Worktree: `/Volumes/GOON/codex/worktrees/56d8/design-studio-ai`.
Status: local implementation complete; preparing the authorized main PR. No deployment or live provider generation claimed.

## Delivered scope

- Gemini native image generation; preserved OpenAI generation/editing and speech; Grok base64 images; private Leonardo image generation with persisted asynchronous jobs and completion reuse.
- Official DeepSeek text generation for brief interviews and document proposals.
- Multiple owner-scoped custom connections: named IDs, HTTPS base URLs, OpenAI/Anthropic/Gemini-compatible formats, Bearer/header-key/Basic/no-auth selection, encrypted credentials and masked metadata.
- Credential retention for metadata updates; explicit replacement when endpoint/auth changes; guarded writes reject concurrent stale updates instead of restoring an old key.
- Settings, brief and editor provider selection; immediate connection refresh; capability filtering and actionable failures.
- Shared REST/OpenAPI/schema, CLI, MCP and WebMCP inputs and discovery. MCP `list_provider_connections` requires API-key access. Existing OAuth and browser credential-management boundaries preserved.
- Additive migration; owning provider/deployment/agent guides, agent skill, public API/CLI documentation and generated llms references synchronized.

## Review

Spec compliance checked against each acceptance criterion in the plan. Read the pending source changes and new modules, followed credential storage/transport, native payloads, async jobs, owner isolation and consumer schemas. Fixed a brief selector that used a display label as its value; browser regression now verifies the custom ID survives selection. Also covered provider refresh after Settings, credential rotation races and actual image MIME detection.

The provider URL policy remains the existing operator HTTPS allowlist. Custom API formats are adapters for the documented protocols, not arbitrary response mapping. Provider-created media does not change the design document automatically or bypass brief approval.

## Verification performed

- `npm ci` and `npm ci --prefix packages/cli`; Node 25.2.1 satisfies declared Node >=24.
- `npm run build:cli`.
- `npm run typecheck`: passed.
- `npm test`: 157 passed, zero failures/skips. Includes CLI, real SQLite connection isolation/update behavior, native request contracts, media decoding/polling and real HTTP redirect rejection.
- `npm run build`: passed; 11 public HTML pages, 12 Markdown files and llms indexes regenerated from source.
- Chromium desktop and mobile: provider Settings/selection/brief regression plus existing onboarding workflow, 4 passed.
- Firefox desktop and WebKit mobile: provider Settings/selection/brief regression, 2 passed.
- `git diff --check`: passed. Changed owning-doc relative links checked; generated `llms-full.txt` contains new providers, custom auth and connection discovery.
- Inspected the mobile screenshot. No horizontal page overflow; fields, save and disconnect controls usable. Test screenshots use only local synthetic account/connection metadata and no credentials.

Browser command environment: `E2E_PORT=9019 PROVIDER_ALLOWED_ORIGINS=https://browser-provider.example`; cross-browser additionally uses `STUDIO_CROSS_BROWSER=1`. The normal 8791 port belonged to another checkout, so this worktree used deterministic port 9019. Harnesses stopped their owned servers and cleaned isolated databases.

## Limits

No live provider credentials were available or used. Tests verify local behavior and documented request contracts, not external model access, quota, image quality or successful billed generation. Custom origins need `PROVIDER_ALLOWED_ORIGINS` and protocol-compatible endpoints. New Gemini/Grok/Leonardo/custom image paths are prompt-only; existing OpenAI/fal source editing is preserved.

Dependency install reported eight high-severity findings in the existing root dependency tree; no dependency/lockfile changes or audit-clean claim. Build retains the existing dynamic-import chunking warning. Deployment must apply `0009-custom-providers.sql` while preserving `ENCRYPTION_KEY`.

Docs impact: minor; owning surfaces updated.
Unresolved questions: none.

## Shipping preflight

- Refreshed origin/main: still 3545d18; no migration numbering conflict.
- CI harness now supplies its reserved test provider origin without external environment setup.
- Source package, CLI and protocol versions bumped to 0.3.1; published 0.3.0 archive links remain valid until a separate archive release.
- AgentKit plan CLI unavailable in this shell; this plan directory remains the execution record.

Independent pre-landing review: [review.md](review.md), no actionable findings; 14 focused tests passed. Revalidated the current DeepSeek default using the official pricing page rather than stale search snippets.

Shipping verification reran 157 tests successfully on 0.3.1. Version assertions now compare the executable to the package manifest. Full E2E initially exposed a stale schema-key inventory and a second authentication worker caused by a screenshot override. The schema assertion now covers the added public provider inputs; the provider workflow shares the existing authenticated worker. Production signup limits remain unchanged.

Final default-harness E2E on port 9019: Chromium desktop 31 passed; mobile 30 passed, one existing desktop-only appearance test skipped. No external provider allowlist environment override required. Typecheck, build, CLI tarball and skill archive passed. All owned test servers stopped.
