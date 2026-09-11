# Isolated feasibility probe review

Status: DONE_WITH_CONCERNS. Reviewed source only; main agent owns verification runs.
Scope: geometry, CPU paint/pixel runtime, history, browser probe and their tests. This is a partial Phase 01 probe, not acceptance of Phase 01 or the later public features.

## Findings

1. **P2 — Long gestures silently lose their tail.** `scripts/board-engine-probe.ts:45` stops appending input at 4096 samples while continuing the gesture; lines 48–54 commit the truncated points and report success. A long Pencil gesture with coalesced events can therefore display/commit only its first section with no rejection. The shared geometry limit is appropriate; silently discarding input in the caller is not. Cancel the entire pending gesture with an explicit sample-budget message when another sample would exceed the cap, or implement a documented bounded resampling policy that preserves the endpoint. Add a browser regression for overflow with no partial commit and recovery on the next gesture.

2. **P2 — Release coordinates are discarded.** `scripts/board-engine-probe.ts:48–53` commits previously collected samples without consuming the release event. A pointer-up at coordinates different from the last delivered move leaves the stroke short; a down/up sequence with different coordinates and no intermediate move commits a dot. Append the final position before commit, within the same sample budget. Preserve appropriate last-known pen pressure because pointer-up commonly reports zero; do not manufacture a zero-pressure final stamp. Add a browser test with distinct down/move/up coordinates and inspect the committed path or paint pixels.

## Checked boundaries and limits

- Geometry validates numeric SVG inputs, bounds point/segment/subdivision counts, and shares pressure-outline geometry with hit testing. No executable markup injection found in the reviewed numeric serializers.
- Paint validates before mutation and stages touched tiles until success. The retained-tile cap does not include copy-on-write clones; `paint-runtime-feasibility.md` explicitly acknowledges that temporary copies can double the allocation, so this is an unresolved production budget rather than a concealed violation of the probe contract.
- History clones caller state, keeps gesture drafts separate from incoming canonical state, and mutates stacks only after reconciliation succeeds. Reviewed tests cover remote overlap conflict and non-overlap preservation. No additional actionable history defect found in this pass.
- Browser probe places all raster content below vectors and provides vector-only undo. It does not establish arbitrary mixed z-order, interleaved paint/diagram undo, engine adoption, canonical public-operation parity, or real iPad/Pencil quality. The static cubic path is rendered, not interactively editable; the browser test title should not be treated as evidence of curve-edit controls.
- Browser tests assert two local workflows and pixels; they do not compare browser output with offline/headless exported files. No export fidelity or universal browser-support conclusion follows.

## Disposition

Fix the two input-loss cases before relying on this probe for gesture evidence. Other missing functionality remains explicitly outside this bounded review; retain it as open Phase 01/later-phase acceptance, rather than claiming full completion.

Unresolved questions: physical-device behavior and full workload/caching evidence remain unmeasured by this source review.


## Follow-up review — tile cache and GIF decoder

Previous input findings: addressed in source. Pointer-move overflow now cancels with an explicit no-commit message; pointer-up appends the release location using previous pressure. Main owns browser regression execution.

### New findings

1. **P1 — GIF preflight allows unbounded metadata-object overhead within the byte budget.** `src/shared/gif-bounds.ts:14` collects a Uint8Array view for every subblock, including ignored comments (line 43), before the working-memory admission check (52–53). A source below 20 MiB can contain roughly ten million one-byte subblocks, creating millions of live JS objects while the estimate charges only four times source bytes. Separate repeated extension blocks also create parser frame objects in `js-binary-schema-parser` even though `maxFrames` counts images only. Cap cumulative subblocks and extension blocks before allocation/parser entry, or stream ignored blocks and still bound parser metadata count. Add small-budget adversarial tests; do not run an OOM-sized repro. This is a current bounded-decoder issue, not a request for public-service infrastructure.

2. **P2 — Valid intervening extensions break transparent pixels.** `src/shared/gif-timeline.ts:17–19` trusts `decompressFrame` alpha, but gifuct associates GCE only with the image in the same parser-loop object. Two comment blocks between GCE and image split that association. The independent scanner retains `transparent=true`, while decoded patch alpha becomes opaque. Verified with a real 1x1 GIF byte stream: without comments, rendered pixel `[0,0,0,0]`; with two one-character comment blocks, `[0,0,0,255]`, although frame metadata still reports transparency. Preserve the transparent palette index in validated metadata and derive patch alpha from that index/pixels, or normalize GCE association before decompression. Cover multiple intervening comments/application blocks.

3. **P2 — Rejecting an async tile callback leaves its rejection unhandled.** `src/shared/paint-tile-cache.ts:54–55` throws the synchronous-only error without observing a returned promise. TypeScript permits async functions where a void-returning callback is expected. Verified: awaiting/catching `cache.edit(key, async () => { throw Error('inner'); })` still triggers a separate `unhandledRejection` with `Error: inner`. Observe and consume the returned promise rejection while rejecting the unsupported edit, without adopting async mutations. Add a regression proving no unhandled rejection and no tile modification.

4. **P2 — Failed creation leaves a phantom empty tile.** `src/shared/paint-tile-cache.ts:42–43` installs a newly created zero tile before `edit` invokes the callback (53–54). If the callback throws, the edit rejects but `read(key)` succeeds with zeros. That tile is clean and therefore disappears without persistence after eviction; the same read then fails. Verified a failed `edit('new', () => { throw Error('cancel'); }, true)` followed by `read('new')` returns zero. Roll back newly created entries on failed edits, or stage creation until callback success. Test failed creation remains missing both before and after eviction.

### Checks and limits

Ran two small `node --import tsx --input-type=module` reproductions: transparency with intervening comments; failed cache creation and async rejection observation. No full suites or browsers rerun. Inspected actual gifuct/parser sources to establish the GCE association and metadata-allocation paths. Buffer-to-Uint8Array normalization and public paint pixel/tile cloning remove the reviewed aliasing routes. No additional copyTile defect found.

Status: DONE_WITH_CONCERNS. Fix the four concrete findings and retain unmeasured device/workload acceptance as open.


## Final disposition check

Status: DONE. All four follow-up findings are addressed in the reviewed source:

- GIF preflight now limits blocks to 2,048 and cumulative subblocks to 65,536 before retaining views or entering the third-party parser. Subblock/object allowances and a post-image-data estimate bound the previously uncontrolled metadata path. These remain engineering estimates, not measured process-peak memory.
- Validated GCE metadata retains the transparent palette index; decoded alpha is explicitly reconstructed from that metadata and decoded pixel indices, removing parser grouping as transparency authority.
- Unsupported asynchronous cache edits attach a rejection handler to the returned promise before rejecting the synchronous-only API.
- Failed cache creation removes the newly created entry; existing committed entries remain intact.

Regression sources cover multiple intervening comments, reduced metadata limits, rejected synchronous creation and rejected asynchronous creation. This final check is source inspection only; main agent owns their execution results. Prior gesture fixes remain addressed. No unresolved findings from this bounded review; full Phase 01/device/production acceptance is not implied.
