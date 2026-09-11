# Phase 06 — Advanced textured, mixed-color and layered Paint

Status: in progress. Priority: P1. Provisional effort: 12–20 engineering days.
Dependencies: Phases 01–03: measured brush/runtime choice, generation CAS, immutable assets/history and Board embeds.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

Current implemented subset and remaining gates: [production integration](reports/production-integration.md). Open checklist rows contain requirements beyond the current slice; they are not silently waived.

Current delivery update: Selection/feather/fill, mask/group editing, durable scoped drafts and compositor workers are implemented; see [delivery and actual workload measurements](reports/advanced-paint-delivery.md). Full editor E2E and physical-device quality remain distinct gates.

## Requirements and design

Deliver real textured brushes and color pickup/deposit/smudge, ink taper, pressure/tilt response and editable raster layers. Include layer opacity/order/groups/masks/alpha lock/clipping and defined normal/multiply/screen/overlay modes at minimum; locked content is protected by shared mutations.

Selections (rectangle/lasso/feather), eraser and fill honor masks/locks and transparent boundaries. Fill exposes tolerance, contiguous behavior and visible-layer sampling. Keep editable truth as immutable layer tiles/manifests; derived composites carry exact contributor hashes. Physical pigment simulation and PSD are outside scope.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/inspector.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/document-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/canvas-gestures.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/export-node.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/export-renderer.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/build-renderer.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/collaboration.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/security-boundaries.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/paint-runtime.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/paint-brushes.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/paint-compositor.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/paint-selection.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/paint-workspace.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/paint-layer-panel.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/paint-tile-cache.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/paint-recovery.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/paint-worker.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/paint-runtime.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/paint-runtime.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/paint-transactions.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/paint-ui.spec.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Reconciled 2026-09-11 against [current source and local evidence](reports/implementation-checklist-reconciliation.md). Checked rows record implemented behavior, not full device, cross-surface, format or release acceptance. Unchecked compound rows retain their unverified requirements.

- [x] Implement the versioned trusted brush/compositor chosen in 01, shared by browser and isolated server/headless execution. Specify sRGB interchange, premultiplied-alpha handling and mixing math in source/docs; accept finite bounded data, never arbitrary JS/shaders.
- [x] Implement seeded tip/grain stamps, paper texture, spacing/flow/opacity, pressure/tilt/ink taper and actual surface-color pickup/deposit/smudge. Compare known pixels to transparency-only overdraw to prove mixing.
- [x] Add multiple independent raster layers with group/order/name/visibility/lock/opacity, normal/multiply/screen/overlay, masks, alpha lock and clipping. Neighbor/visible-layer sampling must match painting-wide generation checks.
- [x] Implement rectangle/lasso/feather selections, mask-aware erasing and flood fill with tolerance/contiguous/sample-visible controls; bound fill work and allow cancellation without a partial saved action.
- [ ] Use sparse 512px immutable lossless tiles and bounded CPU/GPU cache/dirty regions. Budget 2048²/12-layer iPad and 4096²/24-layer desktop workloads including all masks, previews, other media and history storage; atomically reserve in-flight quota before expensive work and release/expire reservations safely; never hold full copies per undo.
- [x] Separate immediate local pixels from persistence: stage dirty tiles, validate bytes/dependencies, CAS commit manifest/generation, then acknowledge saved. Bind operation ID/payload hash to owner/project and expose durable status/committed receipt; after a lost response look up the receipt so smudge does not execute twice. Keep retryable stroke input transient/versioned; replay after conflict requires newly inspected state and explicit intent.
- [ ] Add painting-wide conflicts for concurrent pixel/settings changes, even on separate tiles; allow unrelated painting/Board merge only with stable dependencies. Pin old immutable tiles for undo/recovery and protect snapshots/in-flight work from GC. Undo commits restored content at a fresh monotonic painting generation and current schema version.
- [ ] Freeze the gesture sampling generation, including visible-layer inputs, until completion. Reconcile a live-sync response that arrives mid-stroke without swapping the source pixels; changed source conflicts, cancellation discards only draft pixels. Test late sync with finish, cancel, save and undo.
- [x] Implement worker/GPU feature detection and trusted fallback, context-loss recovery, pointer capture/cancel, draft persistence keyed by account/project/base revision and logout isolation. Preserve committed art when a capability is unavailable.
- [x] Add focused Paint UI with brush preview/settings, color/mix control, layers, selection/fill, pending/upload/saved/conflict feedback and accessible controls; reopen editable art from Board/design page.
- [x] Expose actual server-rasterized stroke/fill/layer/inspect commands through the shared service on every agent surface now. Agent commands must change pixels and return committed IDs/generation, not record descriptive no-op commands.

## Slice parity and documentation

Before this slice is complete, expose its validated operations and capability/errors through the common server service, REST, MCP, CLI and feature-detected WebMCP. Preserve local-draft versus persisted-state semantics, expected revision and separate explicit brief approval. Update these existing owning surfaces with only this slice's changes:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

Update public content sources, then run `npm run build` to regenerate documentation/llms output. Never hand-edit generated `dist/` or renderer/viewer bundles. Unsupported actions must report a precise capability/version error rather than silently flatten or ignore content.

## Validation coverage and remaining acceptance

Use independently specified small pixel cases for seeded texture, pressure, mixing versus alpha over, blend modes, mask/clip/alpha lock, feather/fill boundaries and layer ordering; compare browser/server outputs within the tolerance fixed in 01. Exercise same-painting conflict, interrupted upload, malformed/foreign tile, quota preflight/reservation races, lost-response receipt lookup, repeated operation IDs with changed payloads, context loss, recovery account switch, monotonic undo, undo pins and concurrent cleanup.

Relevant commands (individual execution evidence is linked above): `node scripts/build-renderer.mjs`; `npx tsx --test tests/paint-runtime.test.ts tests/paint-transactions.test.ts tests/collaboration.test.ts tests/security-boundaries.test.ts`; `npm run build:cli`; `npx tsx --test tests/agent-capability-parity.test.ts tests/cli.test.ts`; `npm run typecheck`; `npm run build`; `npm run test:e2e -- tests/paint-ui.spec.ts --project=desktop`; repeat mobile basic workflows and explicit Firefox/WebKit projects with `STUDIO_CROSS_BROWSER=1`.

Run physical iPad/Pencil and desktop workload measurements separately, including prolonged strokes/mixing, layer churn and memory pressure. Inspect real pixels after save/reload and agent edits; record actual device budgets instead of asserting emulation is hardware evidence.

## Success criteria

PAINT-1–5 and slice AX-1 pass with editable multi-layer source, actual mixing and stable immutable persistence. Both primary-device workloads meet documented quality targets or remain visibly blocked; no freehand-only substitute is accepted.

## Risks, security and rollback

Raster memory/decoded bytes, color math and asynchronous commits are major risks. Profile and bound caches/concurrency rather than lowering feature scope. Roll back new editing/algorithm selection while retaining versioned reader/compositor and all committed assets; never silently rerender old strokes under a new algorithm or delete history pins. No finer tile merge is required to release.

## Unresolved evidence / next step

Complete the remaining acceptance against the current source and linked evidence. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
