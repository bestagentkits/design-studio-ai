# Persisted observability contract

Priority P1. Owner backend; dependency none. Read [architecture](../../docs/architecture.md), [deployment](../../docs/deployment.md), `server/index.ts`, `security.ts`, `types.ts`, `providers.ts`, `mcp.ts`, `node.ts`, `node-adapters.ts`, and migrations before implementation.

## Pre-implementation observations

- `index.ts` central middleware authenticates and catches errors, but only logs unexpected error name; no persisted trace owner exists.
- `completeText` returns provider `usage`/`usageMetadata`; it is not durable. Scope can change after billed generation, and generated output can fail validation: usage must survive those failures.
- MCP `callApi` calls the same app with a fresh request; propagate correlation and label parent/child spans without counting nested calls as independent user actions.
- Node explicitly maps environment and loads sorted migrations; Cloudflare uses D1. New bindings must reach both.

## Implementation

- [x] Define shared bounded query/client-event validators, safe span setters and event/result TypeScript contracts in a focused observability contract; IDs, parent/trace IDs, operation, authenticated actor ID/auth channel, owned project ID, timestamps, duration, outcome/status/error code, safe provider/model and measured usage with provenance.
- [x] Add migration with indexes for owner/time, trace, status and operation kind. Persist operation start before expensive work and final state afterwards; represent orphaned/stale runs as unknown/interrupted, never indefinitely active. Use 30-day bounded retention with rolling cleanup; bound query windows, pagination and writes.
- [x] Middleware generates safe request correlation, returns response request ID, normalizes route templates, and records success/failure including validation/auth/oversized requests. Explicit span helpers cover providers, brief interview, exports, media submission/poll/result and MCP tool outcomes. Distinguish transport 200 from MCP `isError`.
- [x] Keep costs/tokens nullable when unavailable; normalize known provider fields without double counting cached/total tokens or polls. Record provider success independently from proposal validation/save/export outcome. Do not infer quality or spend from call count.
- [x] Implement owner-scoped `/api/observability/summary`, `/api/observability/events`, `/api/observability/trace/:id`. Operator scope on these APIs requires `OBSERVABILITY_ADMIN_IDS` and session/API-key auth; deny OAuth global reads; authorization must use authenticated server identity, never request actor IDs/role headers/UI visibility. Document explicit operator scope; browser tool discovery must not accidentally expose unrestricted operator calls.
- [x] Use allowlisted safe error metadata only. Never persist request/response bodies, names/content, credentials/headers, arbitrary exception messages/stacks, provider URLs or SQL parameters. Treat caller-supplied correlation as untrusted and bounded.
- [x] Telemetry storage/export failures must not mask response, retry provider work, or break design operations; expose telemetry health/dropped-event status so gaps are visible. Protect telemetry APIs from generating self-amplifying records.

## Files and integration

Modify backend-owned files from plan index; create `server/observability.ts`/focused helpers, shared contract, new migration and focused tests. Parent integrates API reference, CLI, MCP tools and WebMCP using the same service. Retain current envelope/revision contracts; correlation can be additive header/metadata.

## Validation

- [x] `npx tsx --test tests/observability.test.ts`: real SQLite migrations, success/failure, parent/child traces, running/final states, unknown usage/cost, filters/retention and zero-vs-missing.
- [ ] Explicit stale-running lease transition experiment; implementation is source-reviewed, but the focused tests do not assert an elapsed request/provider lease.
- [x] Security scenarios: two owners, anonymous, ordinary user, configured operator, OAuth token; forged owner/operator/correlation; malicious error text and payload do not leak; persistence failure still returns intended response.
- [x] Span tests verify usage survives later validation failure; media completion tests cover both poll orders, concurrent completion and late enrichment without inflating calls/cost. Provider call-site review confirms capture precedes proposal validation/revision checks; successful live provider generation is separate evidence.
- [x] Run typecheck, existing server/provider/security/collaboration tests; full suite in phase 5.

Risk/rollback: additive migration only; disable optional export/config while retaining operational data. Document retention and failure behavior; preserve encryption key. No rollback by dropping deployed user tables.

## Acceptance reconciliation — 2026-09-09

Status: implementation and local contract checks complete. See [acceptance evidence](reports/acceptance.md).

- Owners: `src/shared/observability.ts`, `server/observability*.ts`, `migrations/0008-observability.sql`, provider/export/MCP instrumentation, Node/Compose bindings.
- [Final unit gates](reports/tester-260909-final-ship-gates.md): CLI build, typecheck and 148 passing tests after the accounting repair.
- [Accounting regression](reports/tester-260909-media-usage-race.md): original cached-first loss reproduced; atomic missing-field enrichment passes serial/concurrent cases, preserves first terminal outcome and measured zero.
- [Parity evidence](../reports/tester-260909-observability-parity.md): actual CLI/MCP/browser calls, shared trace IDs, 30-day lookup, owner separation and operator/OAuth boundary.
- Stale-running lease transitions are implemented in `maintainTelemetry`; tests cover queued/final/retention/storage-loss behavior, not a wall-clock 24-hour provider job. Real provider receipt, PostHog delivery and deployment remain phase 5 evidence.
