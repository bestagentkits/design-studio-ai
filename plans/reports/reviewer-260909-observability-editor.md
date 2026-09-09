# Observability and editor review

Reviewed working changes against `origin/main`, including new untracked modules, under the accepted full-scope plan. Read-only production review; fixes remain with their owners. Review focuses on privacy, authorization, accounting, correlation and concrete recovery behavior.

## Findings and fixes

1. **P2 — Concurrent completed-media poll can discard measured usage.** `server/providers.ts:487` makes `result_asset` visible before the usage-bearing finalization at line 497. A second poll can take the cached branch at line 471 and finalize the same span with only output bytes. `server/observability.ts:81-84` then rejects the original finalization because `finished_at` is already populated, permanently replacing available provider usage with unknown. Persist/recover usage with the cached result or permit safe one-time enrichment of missing measurements. Fixed: atomic completion preserves the first terminal outcome/timestamps and fills only missing measurements; duplicate and post-result error branches retain reported usage. Focused real SQLite regression passed in this review.
2. **P2 — Late trace response mutates a different page URL after unmount.** `src/app/observability-dashboard.tsx:47-55` guards competing trace requests, filters and close, but does not invalidate the counter on unmount. Start a delayed trace lookup, navigate to Templates or change identity, then let the lookup finish: the old component writes `trace` into the new current URL. Invalidate trace requests on unmount as well. Fixed in source; browser regression verification remains controller-owned.
3. **P2 — Changed filters can retain or mix previous-query data.** `src/app/observability-dashboard.tsx:42-45` changes filters without resetting summary/events/cursor. A failed next load leaves the old results displayed under the new scope/day controls. During the debounce interval, the old pagination control also remains enabled and can append new-filter results using the old cursor to the old list (`:25-28`). Clear results/cursor on a changed query, or explicitly track and display the query owning retained results. Fixed in source; browser regression verification remains controller-owned.
4. **P2 — Empty font search keyboard path throws. Fixed in source.** Originally `src/app/font-picker.tsx:72-73` set active index 0 when options were empty, then dereferenced `options[0].family`. Repro: search unknown family, ArrowDown, Enter. Current code preserves -1 for an empty list and uses optional selected-family access with custom-query fallback. Editor owner is adding regression coverage.

The earlier competing-trace response race is fixed in source by the trace generation guard. The unmount case above is distinct because its old generation ref remains live inside the pending promise.

## Fix status

| Finding | Current status | Evidence |
| --- | --- | --- |
| Completed-media poll usage race | Fixed and focused regression passed | `observability.ts:77-85` atomically enriches missing fields; test `media completion preserves late measurements in both poll orders without changing terminal outcomes` passes cached-first, usage-first, concurrent completion, zero-cost, repeated completion, error-first and summary counts |
| Trace response after unmount | Fixed in source | Dashboard cleanup increments both request generation refs on unmount; stale trace response checks its generation before state/URL writes |
| Previous-filter data/cursor retained | Fixed in source | `filter()` invalidates requests, clears summary/events/cursor/error and enters loading before debounce |
| Empty font search keyboard crash | Fixed in source; browser run pending | Empty-list index remains -1; optional option lookup falls back to query; `tests/editor-ergonomics.spec.ts:100-103` saves and reads custom family after ArrowDown/Enter |
| Competing trace requests | Fixed in source | Trace generation comparison precedes state/URL updates |

## Verified boundaries

- Owner filtering and configured operator gating remain server-side. OAuth cannot request all-account scope even for the configured account. CLI/MCP/WebMCP use the same APIs and validators.
- Client event input is strict/allowlisted, project references are owner-checked, and browser-supplied request IDs join only that actor's recorded trace.
- Internal correlation uses a server-only symbol; caller trace headers do not choose parent/root IDs. MCP semantic tool errors mark failure despite HTTP 200. Response request IDs survive the native SDK response.
- Usage remains nullable; zero is preserved; no price inference or private prompt/document/response payload is introduced by inspected instrumentation.
- `.env.example`, Compose and Node bindings now expose all three observability/PostHog configuration values. No outstanding Compose wiring finding.

## Evidence and limits

- Earlier independent real SQLite/HTTP/CLI/MCP/Chromium parity test passed, including owner separation, OAuth global denial, 30-day trace lookup and request-ID correlation (`tests/observability-parity.test.ts`).
- `npx tsx --test --test-name-pattern='media completion preserves late measurements' tests/observability.test.ts`: passed, 1 test, 0 failures, after the accounting fix.
- Backend post-fix report records 21 passing observability/provider/server tests plus typecheck, including concurrent completion; see [race regression evidence](../260909-0952-observability-editor/reports/tester-260909-media-usage-race.md).
- `git diff --check`: passed during review.
- Release test report records CLI build, typecheck and 147 passing unit/integration tests before the latest review fixes; parent owns final reruns, browser regressions and deployed verification. This review does not establish live provider usage or PostHog delivery.
- No new auth bypass or private-payload leak found in inspected paths. This is a scoped review, not a claim of universal security or browser coverage.

Review verdict: no unresolved correctness finding remains in the inspected source. Controller/editor browser results and final post-fix full checks remain separate pending verification gates.
