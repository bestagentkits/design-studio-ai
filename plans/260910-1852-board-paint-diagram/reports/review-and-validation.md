# Plan review and validation

Date: 2026-09-10. Baseline: detached HEAD `3545d18`. Scope: planning documents only.

## Confirmed decisions

- Full textured painting, actual color mixing and multiple editable paint layers remain required.
- Flowchart, architecture, user flow and mind map have equal completion requirements.
- MIT/self-host first; tldraw is a UX reference, not a required SDK or paid fallback.
- Desktop and physical iPad/Apple Pencil are primary; phones retain basic operations.
- No unanswered product preference blocks planning. Engine and physical-device evidence remain future execution gates.

## Review disposition

The four independent source reviews examined the architecture/acceptance draft before the phase files were available. Their reports retain that historical limitation. The controller subsequently read all nine completed phases, reconciled the findings and added execution tasks; no runtime behavior was proved by review.

| Review finding | Disposition | Execution coverage |
| --- | --- | --- |
| Public payload exposes hidden/masked paint source | Accepted: sanitized visible projection and asset access policy | 02, 08, PUB-1 |
| Concurrent jobs exceed preflight-only resource budgets | Accepted: atomic bytes/execution-slot reservations, deadlines and lease checks | 02, 06, SAVE-4 |
| Version check and CAS observe different revisions | Accepted: bind both to observed row revision | 02, SAVE-1 |
| Undo restores stale schema/generation | Accepted: new monotonic transaction, upgrade legacy history | 02, 03, 06, SAVE-3 |
| Lost acknowledgement duplicates smudge | Accepted: operation ID/hash and durable receipt/status | 02, 06, SAVE-3 |
| Live-sync response arrives mid-gesture | Accepted: immutable gesture base, separate delta, safe cancellation/reconciliation | 03, 06, SAVE-5 |
| Existing reusable composition drops v2 dependencies | Accepted: preserve token/v1 insertion; reject unsupported capture before save | 02, COMPAT-1 |
| React archive misses source/dependency closure | Accepted: update executable manifest owner and independently build/run generated package | 08, EXPORT-1 |
| Board-only label font omitted | Accepted: shared reachable-font discovery and readiness | 04, 08, EXPORT-1 |
| Offline CLI cannot resolve private paint bytes | Accepted: browserless vectors/local verified media; actionable missing/stale-media error | 08, EXPORT-2 |

Source reports: [security](review-security.md), [failure modes](review-failure-modes.md), [assumptions](review-assumptions.md), [scope/contracts](review-scope-contracts.md).
Final decisions: [architecture](../architecture.md), [acceptance](../acceptance-matrix.md), [execution index](../plan.md).

No requested capability was removed. Library packaging and a portable offline asset archive are not inferred additions; editable page embedding and existing export capability boundaries remain explicit.

## Checks actually performed

- Read all nine phase files; checked pending status, dependency order and coverage against accepted scope and review findings.
- Verified estimate sum: 56–88 engineering days, provisional rather than a delivery date; re-estimate after engine evidence.
- Verified 147 existing-owner references across phases, covering 86 unique existing files; proposed files are separately labeled.
- Mechanically checked local Markdown targets and trailing whitespace across the plan package; no broken local links or whitespace errors.
- Verified index remains under 80 lines and all nine phases are pending.
- Checked commands against package scripts, Playwright project names and existing renderer/CLI prerequisite rules.
- `git diff --check` passed; because the plan directory is untracked, the separate full-file whitespace check also ran. Git status contains only the new plan directory.

No product tests, builds, benchmarks, dependency installations, servers, commits, release or deployment ran for this planning task. The `ak` executable is unavailable (`command not found`); no CLI task/journal persistence is claimed. Checklists and this report are local planning records.

## Remaining execution evidence

Pin and inspect the actual package/API/license; prove canonical adapter/history/GIF behavior; measure real Pencil/input and paint workloads; fix paint math, resource/retention configuration and package fit in Phase 01. Later phases must produce their own test, artifact and device evidence. These are planned work, not unresolved user approvals.
