# Advanced Paint implementation and evidence

Current implementation/status update: [2026-09-11 checklist reconciliation](implementation-checklist-reconciliation.md). The measurements and remaining-work statements below describe their earlier execution snapshots; the reconciliation records later implementation and desktop evidence without claiming final CI, hardware or release acceptance.

Implemented in this delivery:

- Shared rectangle/lasso selection with inner feather and bounded precomputed byte masks; frozen brush coverage and fill sampling.
- Atomic tiled fill/selection erase: alpha-aware tolerance, contiguous/global membership, visible-layer sampling, masks and alpha locks, cancellable cooperative work. No partial draft returned after cancellation.
- Pen tilt spread; final start/end ink taper reconstructed from frozen source, preserving older pixels. The explicit `seal()` boundary precedes immutable tile extraction.
- Pixel/mask editing targets, mask creation/enable/remove, groups and lock controls, layer/group shared semantic operations with generation CAS and composite invalidation.
- Top-left canvas resize clips tiles and zeros partial-tile pixels so expanding cannot resurrect cropped pixels. Locked layers/groups block resizing.
- Account/project/painting-isolated IndexedDB raw/prepared recovery. Pending uploads survive failures; the staged record survives local acceptance and is removed when reopened document content matches. Old-account upload completion cannot enter a new account/project. Explicit discard removes the local record.
- Real feature-detected compositor worker using the shared trusted compositor, tile-by-tile requests and transferable copies; CPU fallback on unsupported/blocked workers. Session cleanup terminates active workers. Canvas context restoration reloads committed source.

## Verification

`npx tsx --test tests/painting-advanced*.test.ts tests/paint-runtime.test.ts tests/paint-live-stroke.test.ts`: 22/22 passed. Includes prior brush incremental/cancellation/generation/known-color checks, fill boundaries/mask/feather/cancel, taper and group-lock/layer command behavior.

`npm run typecheck`: passed after shared integration resolved the temporary diagram import error.

## Workload measurements

Local Node process; deterministic full-tile raster source at all layers, actual production compositor/runtime/fill. Repeated generated source bytes isolate pixel work, not network/decode or real project storage. RSS is process-level, not physical-device paint memory.

| Canvas / layers | Composite | 100-point bristle | Full contiguous fill | Max fill event-loop gap | Process RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2048² / 12 | 705 ms | 87 ms | 7107 ms | 14 ms | 162414592 B |
| 4096² / 24 | 4879 ms | 104 ms | 29233 ms | 33 ms | 341721088 B |

The first fill implementation measured 219/429 ms event-loop gaps. Chunk and tile-initialization yields reduced those to 14/33 ms, trading total duration for cancellation responsiveness.

Browser execution used the actual bundled production compositor wrapper and worker in isolated Playwright pages. Generated deterministic workload; no authenticated app or shared port touched. Worker loads observed for both sizes, and every engine returned known pixel `[90,140,180,255]`.

| Engine | 2048² / 12 elapsed, max main-thread gap | 4096² / 24 elapsed, max main-thread gap |
| --- | --- | --- |
| Chromium | 1074 ms, 5 ms | 7647 ms, 5 ms |
| Firefox | 920 ms, 30 ms | 6967 ms, 96 ms |
| WebKit | 691 ms, 9 ms | 5282 ms, 30 ms |

## Remaining evidence boundaries

These are compositor/runtime measurements, not a full editor interaction pass, physical iPad/Pencil tests, decoded-mask/history/export peak-memory acceptance, or production delivery evidence. Large canvases still take seconds to composite/fill, although the worker and cooperative fill keep the interaction thread available. Parent owns service/agent integration, broad test/build/E2E and final review. Browser mask editing, IndexedDB reload/account switching and canvas resize need full editor E2E coverage before claiming their integrated acceptance gates.

## Group checkbox interaction correction

The advanced editor E2E found `locator.check` observing a reverted group-lock checkbox during upload. `settings(edit)` applies the mutation synchronously, so the immediate cause was committed props rendering while the asynchronous upload ran. The later error snapshot already showed the checkbox checked after the eventual commit.

Controls now render the retained `recovery.settings` snapshot while persistence is pending; the raster session still uses its committed source. Group visibility/lock, layer membership and mask enable handlers also snapshot event values before passing mutation callbacks. Failed settings remain represented by the retained draft, and discard restores committed controls.

Verification after correction: `npm run typecheck` passed; `npx tsx --test tests/painting-advanced*.test.ts tests/paint-live-stroke.test.ts` passed 17/17; diff whitespace check passed. Parent owns the E2E server and rerun; no competing server started.

## Saved-history recovery correction

A persisted undo/redo painting retains its immutable tiles/settings but receives a new monotonic painting generation. Recovery previously used `paintSource` equality, which includes that generation, so reopening saved redo incorrectly offered already-persisted content as local recovery.

`paintingRecoveryMatches` now canonicalizes both paintings with the shared schema and compares editable content excluding painting generation and the derived composite. Pixel references/hashes, masks, layer/group settings and painting identity remain part of equality. Three new regression cases exercise the actual snapshot-restore generation path and preserve genuinely different recoverable content.

Checks: typecheck passed; 15 focused recovery/fill/layer-operation tests passed; diff check passed. The separate E2E Save-response timeout had `Saved` and `Live` checked in its error snapshot: the test's direct navigation re-enabled Live, allowing autosave before its redundant PUT waiter. Parent owns that test synchronization correction and the full E2E rerun.
