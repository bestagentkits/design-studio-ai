# Media usage completion race — 2026-09-09

Status: DONE. Reviewer finding reproduced and repaired; no scope reduction.

- Cause: cached media polls could finalize a span before the originating poll supplied provider usage; the first-terminal guard permanently discarded subsequent measurements.
- Controller applied source fix in `server/observability.ts`: atomic SQL preserves the first terminal status/timestamps while filling only missing measurements. Null cannot replace a measurement; zero remains measured; one span remains one provider call.
- Controller updated `server/providers.ts`: completed-result validation, download, media type, storage and persistence failures retain available provider usage; duplicate-result polls also supply usage.
- Added real SQLite regression in `tests/observability.test.ts`: cached-first and measured-first orders, concurrent completions, error-first late usage enrichment, stable terminal timestamps/status, null preservation, zero costs, and exact summary counts/totals.

## Evidence

- Before source fix: new regression failed `null !== 12`, proving cached-first usage loss.
- After source fix: `npx tsx --test tests/observability.test.ts tests/provider-capabilities.test.ts tests/server.test.ts` — **21 passed, 0 failed, 0 skipped**.
- `npm run typecheck` — passed, application/server and CLI.
- `git diff --check` — passed.
- Partial usage does not fabricate a total: `providerUsage` derives total only when both input and output exist. Regression verifies input 5 alone followed by reported total 7 retains total 7.
- No live provider download failure was induced; error-path retention confirmed by source review and SQLite finalization tests. Existing provider transport/isolation tests passed.
- All commands exited; no background process or E2E port started.

The earlier 147-test full-suite evidence predates this repair. Controller owns final full release gates.

Unresolved questions: none.
