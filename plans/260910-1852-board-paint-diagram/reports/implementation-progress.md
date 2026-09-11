# Creative tools feasibility history

This is historical feasibility evidence. Current production work is recorded in [production integration](production-integration.md); its status supersedes the pending-production descriptions below.

Date: 2026-09-10. Branch: `codex/board-paint-diagrams`, based on `3545d18`. Status: **in progress; partial Phase 01 only**. The user authorized implementation of the complete plan; remaining scope has not been removed or declared delivered.

Update 2026-09-11: the user rejected the primitive drawing demo. The [quality correction](drawing-quality-correction.md) now replaces fixed-width mouse input with smooth speed-sensitive ink, adds incremental live paint profiles and unified local paint/vector undo/redo, plus brush/layer controls and a responsive lab. Its evidence supersedes the vector-only undo/release-only paint descriptions below, which record the initial spike. Full product scope remains unfinished.

## Implemented and reviewable

- Native typed cubic paths, pressure outlines, camera conversion, transformed anchors and matching geometric hit tests: `src/shared/board-geometry*.ts`.
- Gesture draft/history feasibility with a fixed base and safe remote reconciliation: `src/app/board-history.ts`. Tests cover late sync, cancel, conflicting undo, duplicate echo and redo invalidation. This generic JSON prototype still clones document snapshots; it is not the production paint journal or a v2 monotonic-generation implementation.
- Real bounded CPU textured/pressure paint, color pickup/deposit, source-over and independent ordered/hidden/locked layers: `src/shared/paint-runtime.ts`, `paint-pixels.ts`. Pixels are real RGBA; no provider output is simulated.
- Serialized bounded LRU tile cache with an explicit backing-store interface, dirty eviction, failed-write recovery, explicit new-tile creation and defensive byte copies: `src/shared/paint-tile-cache.ts`. Actual temporary files test persistence. Browser IndexedDB and project/server asset transactions are not implemented.
- Integrated paged CPU strokes: `src/shared/paged-paint-runtime.ts` loads the affected layer's finite tile region, snapshots inputs before awaits, writes immutable new tiles and publishes its local manifest only after all writes succeed with unchanged generation. Abort/failure/conflict preserves committed pixels. Undo/redo references immutable bytes and increments generation. Metadata history is bounded to 80 entries; at most 64 source tiles plus dirty copies enter a stroke workspace, separate from the eight-tile read cache. This local feasibility class has no server receipts, asset ownership, garbage collection, sample-visible-layer mixing, worker interruption or browser persistence; orphaned/undo bytes are retained until the temporary test store is removed.
- Real GIF byte decode, bounded block/LZW validation, transparency/disposal, deterministic frame sampling and pause/loop/poster semantics: `src/shared/gif-bounds.ts`, `gif-timeline.ts`. Exact `gifuct-js@2.1.2` and its locked `js-binary-schema-parser@2.0.3` declare MIT; no tldraw/Excalidraw dependency was added.
- Local browser probe for drawing, vector-only undo, paint on pointer release and three owned local GIF uploads/seek/play/pause. This deliberately is not a production editor route, save workflow or polished Studio interface.

Build/open the offline probe:

```sh
node scripts/probes/build-creative-probe.mjs
```

Output: `artifacts/creative-probe.html` (ignored generated artifact). It loads without a server. A real Chromium run loaded it, drew a stroke, captured `artifacts/creative-probe.png` and observed no page errors. The screenshot was visually inspected. No external uploads occur from this probe.

## Engine and hardware decision

[Released Excalidraw evidence](engine-adoption.md) establishes a concrete arbitrary Bézier-path mismatch. The planned native fallback is selected. This is not a claim that native interaction quality already matches tldraw or Excalidraw.

User has no iPad available and delegated the test recommendation. Proposed baseline: **iPad Air 11-inch M2 + Apple Pencil Pro**, Safari on the stable supported iPadOS available at the actual test date. [Apple compatibility](https://support.apple.com/en-euro/108937). No physical Pencil/palm/tilt test ran. Continue independent development without requesting this preference again.

Host observed: MacBookPro18,3, Apple M1 Pro, 16 GiB RAM, macOS 26.6.2, Node 25.2.1. Headless browser evidence is not physical input-to-display latency.

## Measurements and their limits

| Probe | Observed result | Meaning |
| --- | --- | --- |
| CPU 2048², 12 layers, short actual stroke in each of 192 tiles | 192 strokes, 192 MiB resident tile bytes, 348.75 ms total; p95 stroke compute 3.56 ms | Node CPU feasibility, not iPad FPS or full-frame compositing |
| CPU 4096², 24 layers with 256-tile resident cap | Rejects at 256 tiles with explicit budget error | In-memory brush prototype cannot hold the requested 1,536-tile workload |
| Separate compressed-file-backed cache, 1,536 repeated actual brush tiles | 1.5 GiB logical RGBA; 8 MiB cache-resident tiles; 10,159,104 compressed bytes; 8,446.91 ms; four full-byte reloads match | Out-of-core storage feasibility; excludes temporary buffers/process RSS and does not integrate brush execution with paging |
| Integrated paged 4096² / 24-layer runtime, 1,536 actual textured strokes, compressed-file writes | 1,536 committed tiles; 8,982,777 stored bytes; 150,568.97 ms total; p95 transaction 264.22 ms; 2 MiB cached at end (8 MiB cap); ending RSS 226,869,248 bytes | Evicted source pickup/deposit and full-byte undo pass. Machine contended with other checkouts/tests. Transaction includes durability, not input latency. Ending RSS is not peak memory; real-time quality remains unproven |

Reproduce using `npx tsx scripts/probes/paint-performance.ts`, `npx tsx scripts/probes/paint-storage-performance.ts`, and `npx tsx scripts/probes/paged-paint-performance.ts`. The last command integrates actual stroke computation and paging; it establishes functional processing of the requested tile count, not live browser/device performance. The original in-memory runtime still correctly rejects its resident cap.

## Verification

- `npm ci` and `npm ci --prefix packages/cli` succeeded; Node meets the declared >=24 requirement.
- Focused geometry/history/pixel boundaries passed after fixing no-op equality and shared transparent-pixel aliasing.
- Real disk cache tests found and now cover Node Buffer slice aliasing, failed creation, async callback rejection and failed persistence recovery.
- GIF tests now cover comments separating GCE/image metadata and bounded parser metadata allocations, in addition to real externally encoded dictionary growth and frame semantics.
- `npm run build:cli`, `npm run typecheck`, `npm run build` passed. Build reports the existing ineffective dynamic-import warning for `document-view.tsx`; no clean-warning claim.
- Full `npm test`: **182 passing tests, no failures**, including the paged-runtime addition and pre-clone input bound. Final run duration 98,518.57 ms on the shared host.
- Four isolated browser probe tests pass in desktop Chromium, mobile Chromium, WebKit and Firefox. They prove only the tested local probe interactions. WebKit runs the configured touch viewport; it does not prove iPad/Pencil compatibility or phone product usability.
- Final desktop Chromium rerun includes the GIF-input regression: **five tests passed**. The added input regression was not rerun in the other browsers; their earlier four-test results remain scoped to that earlier surface.
- `node --check` passed for both `.mjs` probe scripts; `git diff --check` passed. Generated HTML loaded offline without page errors.
- Initial E2E used 8791. A later attempt hit another checkout's active listener (`ba17`); no process was killed. Subsequent runs used a dedicated `E2E_PORT=19203` for this checkout. Owned harnesses close their own server; other checkouts are untouched.
- Dependency installation reports eight high-severity findings in the tree. No broad `audit fix`, dependency-clean claim or audit remediation was performed.

Review history: [code review](probe-code-review.md), [tester report](probe-tests.md). Historical findings remain visible; the fixes and reruns above supersede earlier failed snapshots. No product regressions were accepted to make tests pass.

The [paged runtime review](paged-paint-review.md) found input cloning before count validation. The guard now precedes cloning; a regression supplies an oversized uncloneable array and confirms the count error. Review disposition has no unresolved findings for this bounded class. GIF timeline input also now normalizes invalid values with feedback and recovers playback; its dedicated browser regression uses actual GIF bytes.

## Remaining work in the accepted scope

Phase 01 remains open for real interactive curve controls, text/groups/locks, integrated native history across paint/diagram/remote changes, true mixed z-order/transforms/hit testing, live paint preview with paged storage, 500/2,000-object and full layered-device performance, and definitive persistence/retention math. The local GIF probe only verifies raster layers below vectors; arbitrary interleaving and full workload quality remain open.

Phases 02–09 remain pending: canonical v2 and readers, owned asset/CAS/receipt integration, full Board editor, all four diagram families, catalog/emoji/sticker UX, advanced paint masks/blends/selections/fill, all public agent surfaces, provider preservation, export/publication fidelity, docs and release acceptance. No public capability or completed phase is claimed from isolated helper code.

Next engineering action: wire the fixed-generation paged runtime into live paint preview and native interactive scene/history, then measure render/input workloads. The local paged transaction now exists but does not supply production persistence. Carry the physical-device gate explicitly; do not treat the user's lack of an iPad as permission to declare it passed.

## Workflow and delivery state

All nine phase files were reconciled: 01 in progress; 02–09 pending. No commit, push, merge, release or deployment occurred. Docs impact: internal experimental primitives only; no public schema/API/UI change, so evergreen user docs remain unchanged and do not advertise these capabilities.

The `ak` executable is absent (`command not found`). CLI task/plan/journal persistence is unavailable; direct plan files and this technical record preserve progress. AgentWiki/social publishing was not requested and did not run. No memory files were changed.
