# Observability client parity

Status: DONE

## Scope

Added only `tests/observability-parity.test.ts` for the test assignment. Uses all real SQL migrations, isolated in-memory SQLite, file bucket in a temporary directory, application server on `127.0.0.1:0`, actual CLI subprocesses, actual HTTP MCP tools, and headless Chromium executing the bundled browser-tool registration. No provider calls, production accounts, mocked business APIs, or E2E port 8791.

## Covered behavior

- MCP tool failure returns `isError`; response request ID locates persisted root HTTP, MCP tool, and internal HTTP child events with matching trace/channel/actor and correct parent IDs.
- CLI summary/events/trace and MCP trace retrieve a real recorded trace aged 20 days using a 30-day lookback; default trace lookup excludes it.
- Nullable unmeasured cost and reported retention are preserved.
- Browser tools read the same trace through a real owner session; sanitized client-event submission is absent from registered browser tools.
- Another owner cannot read the trace, filter into the original owner's project, or request global activity.
- An explicitly configured operator API key can request global activity; the same account's OAuth credential remains owner-scoped.
- Browser registrations, Chromium, ephemeral HTTP listener and temporary data are cleaned in all outcomes.

## Finding and verification

Initial test found `/mcp` missing `X-Request-ID` on its native SDK Response. Backend owner fixed the middleware to set the header after downstream response finalization; original regression assertion remains.

Final checks against rebuilt v0.3.0 CLI:

- `npm run build:cli`: pass.
- `npx tsx --test tests/observability-parity.test.ts`: 1 passed, 0 failed/skipped; 3.27 seconds test duration.
- `npx tsc --noEmit`: pass.
- `git diff --check -- tests/observability-parity.test.ts`: pass.

Browsers tested: headless Chromium for tool execution; no claim of UI workflow, Firefox, Safari, live provider, PostHog receipt, or deployment verification.

Unresolved questions: none.
