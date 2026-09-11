# Paged Paint prototype review

Status: DONE_WITH_CONCERNS. Scope is the internal Phase 01 runtime, CPU kernel, tile cache and focused tests; no production receipts, GC, asset ownership or unified history claims.

## Finding

**P2 — Reject oversized point input before cloning it.** `src/shared/paged-paint-runtime.ts:46–47` clones the entire input before `validatePaintInput` checks the 10,000-point limit. An invalid oversized gesture therefore allocates a second arbitrarily large point graph before rejection, defeating the admission limit at this entry point. Add a cheap array/count check before cloning; retain validation of the cloned snapshot before storage access. No need to weaken snapshot isolation or move validation after an await.

## Verified invariants

- **Workspace:** dimensions are checked by PaintRuntime construction; an affected-layer bounding box loads at most 64 source tiles for 4096². CPU dirty tiles use copy-on-write. The LRU cache is separately bounded by its configured capacity. Cache-resident reporting is not total process/workspace memory; source tiles, dirty copies, temporary reads/writes and caller-retained copies remain separate.
- **Immutable source:** layer tile references are captured in the before snapshot; all input/settings are cloned before the first await. CPU sampling reads the original loaded generation while deposits go to draft copies. Writes receive unique UUID keys and detached tile bytes.
- **Atomic publication:** generation/abort checks bracket async work and run again immediately before swapping the layer index. A failed tile write leaves the live index unchanged. Structural changes increment generation, invalidate pixel-only history and force pending work to reject. Successful staged writes may remain unreferenced after cancellation; that retention issue is explicitly outside this prototype review.
- **Undo/redo:** operations reject while a stroke is busy; snapshots hold immutable tile references, and successful undo/redo increment rather than restore generation. A new dirty stroke clears redo. Failed writes do not push history.
- **Await aliases:** source points/settings are detached before any await; storage reads are normalized/copied by the cache and loadTile; outgoing persisted bytes come from copyTile. A caller retaining input or a returned tile cannot mutate the runtime's committed pixel buffers through these paths.

## Checks actually run

`npx tsx --test tests/paged-paint-runtime.test.ts`: **4 passed, 0 failed**. Tests exercise real disk-backed tile-boundary equivalence/eviction/undo, second-write failure, abort and structural change during durable writes, invalid numeric input and imported-buffer isolation. This run does not measure physical-device latency, cancellation during synchronous CPU execution, process-peak memory or complete workload acceptance.

Unresolved questions: none for the bounded design; the pre-clone admission ordering above needs correction before closing review.


## Final disposition

Status: DONE. The P2 is addressed: `PagedPaintRuntime.stroke` now rejects non-arrays, empty input and counts above 10,000 before structuredClone, while retaining full validation of the detached snapshot. The regression passes 10,001 uncloneable entries and expects the point-count error, directly distinguishing early admission from a cloning failure. Verified changed source/test lines; no duplicate test run performed because root owns the ongoing full validation. No unresolved findings from this bounded review. Public/browser integration and full device acceptance remain outside this disposition.
