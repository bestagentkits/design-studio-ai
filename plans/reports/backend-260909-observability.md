# Backend observability delivery

Implemented shared validators/types, migration 0008, request/provider/export spans, real provider usage, owner/operator queries, first-party client events and optional PostHog forwarding. No commits or deployment performed by this worker.

## Contracts

- `/api/observability/summary`, `/events`, `/trace/:id`: shared query validator; owner scope default; `scope=all` requires configured `OBSERVABILITY_ADMIN_IDS` and session/API-key authentication. OAuth global access denied.
- `/api/observability/client-events`: strict allowlisted schema, same-origin, 2 KB bound, rate limit; project and trace references checked against owner. Anonymous events contain no supplied identities. Responses 202 with correlation ID.
- `/api/config`: `observability:{operator,retentionDays:30}`, `analytics:{enabled:true,posthogConfigured}`. First-party tracking works independently of PostHog configuration.
- `/api/schema`: additive `observabilityQuery`, `clientEvent`; OpenAPI client-event request generated from same schema.
- `withSpan(c, options, async span => ...)`; `span.set(...)` only accepts safe diagnostic/usage fields. `telemetryEnv(c, span)` carries server-only correlation for nested requests. No user-supplied headers can join traces.
- Final middleware restores `X-Request-ID` after native downstream responses, including MCP; failed MCP tools mark semantic request failure even when HTTP is 200.

## Measurement and privacy

Request/provider/media-job/export states are persisted. Owned project IDs attach after successful owner lookup. Unfinished requests become interrupted after 15 minutes; pending media jobs after 24 hours. Results arriving later can finalize the persisted media job. Repeated completed polls do not create additional provider calls.

Token values use validated provider-reported integers. Costs remain null unless explicit USD fields or OpenRouter's USD-denominated reported credits are present. No pricing multiplication, quality score or inferred retries. Text output records byte count only. No prompts, documents, credentials, raw URLs, response text, arbitrary error messages or DOM replay are recorded.

30-day queries and bounded rolling physical cleanup. Storage write failures never fail product operations; telemetry reads return explicit unavailable errors. Runtime-local dropped/export counters reset on restart, stated in coverage. Client/CLI/WebMCP source hints are informational, not authorization.

PostHog requires both configured project key and safe HTTPS host. It receives explicit sanitized events through `/i/v0/e/`, with person-profile processing/geolocation disabled, 2-second timeout and no redirect forwarding. Controller subsequently verified the US project configuration endpoint with a negative control and selected `https://us.i.posthog.com`; live accepted event delivery remains a separate check.

## Verification

- `npm run typecheck`: passed.
- `npx tsx --test tests/observability.test.ts tests/provider-capabilities.test.ts tests/server.test.ts`: 20 passed, final rerun.
- `npx tsx --test tests/observability.test.ts tests/briefs.test.ts tests/collaboration.test.ts tests/security-boundaries.test.ts`: 28 passed.
- `git diff --check`: passed.
- Native CLI/MCP/WebMCP parity test delegated to guidance worker; full build/E2E/review/ship owned by controller.

## Verified external formats

- [PostHog capture API](https://posthog.com/docs/api/capture): explicit host, `/i/v0/e/`, project token, distinct ID, anonymous profile flag.
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting): returned token/cost fields and no extra request flag.
- [OpenRouter support](https://openrouter.ai/support): credits denominated in USD.

Remaining external evidence: configuration deployment and live accepted PostHog event, actual provider generation with user credentials, production rollout. Controller resolved the operator identity against the GitHub-linked account through read-only checks. Local test results do not establish those outcomes.
