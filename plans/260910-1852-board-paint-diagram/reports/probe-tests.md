# Focused probe verification — 2026-09-10

## Summary

The original 18 focused tests pass. Four fresh boundary tests add coverage; three pass and one exposes shared mutable empty-pixel state. Implementation changes remain with the controller. These are phase-01 feasibility probes, not full feature acceptance.

Environment: Node v25.2.1; branch `codex/board-paint-diagrams`; base HEAD `3545d18d06215c6c4e5e188761818bba98a2e688` plus uncommitted probe files.

## Commands and results

| Command | Result |
| --- | --- |
| `npx tsx --test tests/board-engine.test.ts tests/board-history.test.ts tests/paint-runtime.test.ts` | 18 passed; 0 failed/skipped; 950 ms |
| `npx tsx --test tests/board-probe-boundaries.test.ts` | 3 passed; 1 failed; 0 skipped; 340 ms |
| `npm run typecheck` | Passed initially; caught readonly-cast error in added test; passed after test correction |

## Findings

- Passing new coverage verifies rejected remote merges leave revision/local state intact, later nonconflicting snapshots remain mergeable, new edits invalidate old redo branches, and the sparse-tile budget applies across layers with atomic rejection.
- Failing `paint pixel snapshots cannot mutate empty pixels in the same or another runtime`: reading an unallocated pixel returns the module-level `empty` array. A JavaScript caller assigning red/alpha into that snapshot changes subsequent empty-pixel reads. Expected `[0,0,0,0]`; observed `[123,0,0,255]`. TypeScript readonly does not enforce runtime ownership. The test restores the mutated snapshot in `finally` to avoid contaminating other tests.
- Recommended fix: return detached pixel values at the public `pixel()` boundary for both direct-layer and composite reads, including transparent empty results. No implementation files changed by this tester.

## Limits and next step

No coverage percentage collected. No servers, build, full suite, E2E, provider requests, or physical-device checks run by this tester; controller owns broader validation. Rerun focused tests after the pixel snapshot fix. Existing behavior does not establish full phase-01 completion or browser/Pencil acceptance.

## Unresolved questions

None. One confirmed implementation defect awaits repair and rerun.
