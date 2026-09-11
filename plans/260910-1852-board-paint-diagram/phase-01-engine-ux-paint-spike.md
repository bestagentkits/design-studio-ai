# Phase 01 — Engine, UX and paint feasibility spike

Status: in-progress. Priority: P1. Provisional effort: 3–5 engineering days; bounded investigation, not full implementation.
Dependencies: None; planning outcome, architecture and acceptance matrix already recorded.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

## Requirements and design

Prove or reject the Excalidraw adapter against required behavior before locking engine-dependent code. Preserve a native SVG/Canvas and permissive geometry/layout route if it fails. tldraw supplies comparison tasks only; no SDK activation, paid service or license purchase. Investigate Dagre plus native obstacle/port/tree/radial strategies; ELK.js is not the default MIT choice.

Use the exact normal/stress Board, iPad Paint 2048²/12-layer, desktop Paint 4096²/24-layer and GIF workloads in [acceptance](acceptance-matrix.md). Determine sRGB interchange, alpha/compositing/mixing math, algorithm version, seeded brush behavior, measured cache budgets, cancellation and asset/history retention policy.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/package.json`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/package-lock.json`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/canvas-gestures.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/document-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/document-merge.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/build-renderer.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/playwright.config.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/run-e2e.mjs`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-engine-adapter.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/board-geometry.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/paint-runtime.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/board-engine.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/board-engine-ui.spec.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Completed bounded substeps (not substitutes for the broader gates below):

- [x] Inspect Excalidraw 0.18.1 actual tarball/runtime; select native SVG/Canvas because arbitrary editable Bézier geometry is unsupported. See [engine evidence](reports/engine-adoption.md).
- [x] Implement/test native cubic and pressure geometry, isolated gesture-history reconciliation and real CPU textured/mixing paint primitives.
- [x] Implement/test bounded GIF decoding/timeline/disposal using actual GIF bytes; add explicit metadata allocation bounds.
- [x] Prove temporary-file-backed tile eviction/reload with 1,536 logical tiles and eight resident tiles. This is separate from production stroke/store integration.
- [x] Integrate real CPU strokes with immutable local tile writes and generation checks; process 1,536 actual strokes across 24 layers, reload evicted source pixels and verify monotonic undo. This does not close browser/physical-device performance or server persistence gates.
- [x] Correct rejected demo with timestamp-speed ink, smoothed/tapered outlines, live bristle/dry/wash/smudge drafts, brush/layer controls and local paint/vector undo. See [quality evidence](reports/drawing-quality-correction.md); this is not a parity/ship claim.
- [x] Install both dependency trees; record MacBookPro18,3/M1 Pro, 16 GiB RAM, macOS 26.6.2, Node 25.2.1; run automated evidence recorded in [progress](reports/implementation-progress.md).

Remaining integration and quality gates:

- [ ] Refresh worktree/HEAD and instructions; record actual desktop/iPad/iPadOS/Pencil/browser versions. Install only during implementation, using Node >=24 and both npm trees; reserve one E2E harness.
- [ ] Pin a released Excalidraw package and inspect its actual shipped types, license, self-hosted fonts/assets and React 19/Vite behavior. Record package/hash and avoid relying on master/unmerged GIF PRs.
- [ ] Build the smallest real adapter probe: typed IDs, pressure/paths, curve editing, text, grouping, roughness/seed, flips, locks, bindings and stable z-order. Canonical round-trip must preserve required fields without an opaque second scene.
- [ ] Probe one gesture/one history entry, SDK update echo suppression, host shortcut ownership, interleaved paint/diagram actions, remote projection updates and undo after remote writes. Do not invent SDK history import/rebase APIs.
- [ ] Probe animated GIF and paint surfaces under mixed vector z-order, clipping, transforms and hit-testing; inspect poster/time rendering and trusted browserless/headless output.
- [ ] Probe real textured pressure strokes, two-color pickup/deposit/smudge and independently editable layers using sparse 512px tiles. Measure stated workloads; record decode/asset/request/cache budgets and cancellation/context-loss recovery.
- [ ] Exercise real Pencil pressure/tilt, palm/touch arbitration, two-finger navigation, IME/text and desktop keyboard; record reference-task comparisons. Phone basic operations stay in the test set.
- [ ] Produce an adoption decision with pass/fail evidence per probe, exact algorithm/retention choices and updated phase estimates. Failed Excalidraw fit selects the native route with unchanged requirements; unresolved hardware blocks its quality claim.

## Prototype parity boundary

The spike must prove canonical operation round-trip and server/headless feasibility through the existing `src/shared/operations.ts`, `server/mcp.ts`, `src/app/browser-design-tools.ts`, `packages/cli/src/dsa.ts` and `src/shared/api-reference.ts` owners. No prototype-only public contract or UI control is released. Any public capability retained from the spike requires the same minimum REST/MCP/CLI/WebMCP tests and owning docs update as Phase 02; production parity cannot wait until Phase 07.

## Future validation — not run

After proposed probes exist: `npm run typecheck`; `npx tsx --test tests/board-engine.test.ts`; `npm run build`; `npm run test:e2e -- tests/board-engine-ui.spec.ts --project=desktop`. Install required browser binaries during implementation, then explicitly run `STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/board-engine-ui.spec.ts --project=webkit` and the corresponding `--project=firefox` sequentially.

Capture canonical diffs, real rendered pixels/exports, measured frame/input/memory results and physical-device recordings. Synthetic pointer tests are useful automation but do not prove Pencil/palm quality.

## Success criteria

Evidence identifies a viable engine route for every requested primitive and history boundary, a workable real paint algorithm and explicit budgets. All failed/unmeasured gates are visible; later phases receive a concrete decision instead of claiming the spike delivered the product.

## Risks, security and rollback

A short spike may expose native work larger than estimates; keep its timebox, report evidence and re-estimate. No new public controls or write capability are enabled from an unfinished probe. Isolate/revert prototype wiring while preserving recordings/test corpus; retain existing editor and data untouched. No permission to deploy or remove requested features follows from the spike.

## Unresolved evidence / next step

User has no iPad available and delegated baseline selection. Use iPad Air 11-inch M2 + Apple Pencil Pro, with stable supported iPadOS/Safari at actual testing. [Apple compatibility](https://support.apple.com/en-euro/108937). Synthetic WebKit tests do not close physical-device acceptance. Continue independent engineering; do not request the same device preference again.

Pinned package fit, physical-device evidence, paint math/budgets and retention decisions are this phase's deliverables. Product priorities are already confirmed. Pass the evidence decision to Phase 02; later engine-dependent implementation remains gated.
