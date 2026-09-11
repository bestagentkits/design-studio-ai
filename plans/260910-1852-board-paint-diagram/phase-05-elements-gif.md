# Phase 05 — Elements: stickers, emoji and animated GIFs

Status: in progress. Priority: P1. Provisional effort: 4–7 engineering days.
Dependencies: Phase 03 Board transforms/history; Phase 02 asset lifecycle and decode budgets.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

Current delivery update: Original licensed artwork, emoji variants, safe SVG-to-PNG import, owned images/GIFs, live clipping/order and exact timed export sampling are implemented; see [delivery](reports/elements-runtime-delivery.md). Chromium pixel checks passed; broader UI/artifact gates remain in progress.

## Requirements and design

Provide searchable licensed bundled stickers/emoji plus owned uploads/GIF library, without a marketplace account. Support insert, resize/rotate/flip, transparency and recoloring supported vector stickers. Emoji retains semantic Unicode/variant plus chosen visual asset/provenance.

GIF supports controlled playback, loop, pause, poster selection and timeline start. Preserve original bytes and decoded timing/disposal/transparency, with correct mixed z-order/clipping/hit-testing; static poster alone does not satisfy GIF delivery.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/file-formats.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/document-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/timeline-editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/catalog.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/published-viewer.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/regressions.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/security-boundaries.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/elements-catalog.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/gif-timeline.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/elements-panel.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/animated-element-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/image-decode-validation.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/public/elements/catalog.json`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/public/elements/ATTRIBUTION.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/elements.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/elements-ui.spec.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Reconciled 2026-09-11 against [current source and local evidence](reports/implementation-checklist-reconciliation.md). Checked rows record implemented behavior, not full device, cross-surface, format or release acceptance. Unchecked compound rows retain their unverified requirements.

- [x] Select a small bundled searchable artwork set; record artwork licenses/provenance independently of engine/package licenses. Include Unicode keywords and selectable supported variants.
- [x] Add owned upload/library search, insertion and metadata through shared typed operations. Validate imported SVG into supported vector paths or rasterize with explicit fidelity notice; never execute SVG markup.
- [x] Enforce image dimensions, decoded pixel/frame/duration budgets before expensive processing. Reject malformed/oversized inputs without partial persisted references.
- [x] Preserve semantic emoji identity and deterministic selected artwork; regenerate bundled vector recipes as safe 512px PNGs when recoloring; retain recipe identity and give imported raster stickers honest controls.
- [x] Implement application-controlled GIF frame decoding/timing with disposal/transparency, loop/pause/poster/timeline start and reduced-motion behavior. Align playback with vector/paint z-order, clipping and transforms.
- [ ] Integrate owned nested reference remapping, clone/source-delete survival, immutable publication assets and history pins from Phase 02.
- [x] Add deterministic static sample and motion time hooks to the trusted renderer now; Phase 08 tests the entire format matrix. No unsupported animation silently becomes a static element.
- [ ] Add responsive search, loading/empty/error states, keyboard insertion/focus return and phone controls; document upload-only GIF discovery and supported rendering behavior on every surface.

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

Test actual licensed/local test assets: malformed/decode-heavy images, mixed-frame-duration transparent GIF disposal, deterministic poster/time samples, paused timeline stability, transform/clip/z-order with vectors, semantic emoji variant persistence and recolor restrictions. Verify clone/publication owns independent bytes without private project URLs.

Relevant commands (individual execution evidence is linked above): `node scripts/build-renderer.mjs`; `npx tsx --test tests/elements.test.ts tests/regressions.test.ts tests/security-boundaries.test.ts`; `npm run build:cli`; `npm run typecheck`; `npm run build`; `npm run test:e2e -- tests/elements-ui.spec.ts --project=desktop`; repeat mobile and explicit Firefox/WebKit projects with `STUDIO_CROSS_BROWSER=1`. Inspect actual posters and timed renders, not only DOM state.

## Success criteria

ELEM-1–3, nested SAVE-2 and slice AX-1 pass. Three differing GIFs under vector overlays meet the acceptance workload, remain paused when requested, and survive reload/clone. Licenses and offline/self-host assets are documented.

## Risks, security and rollback

An SDK overlay may violate interleaved z-order or capture input. Use the native compositor/interaction route selected in 01; do not flatten required animation. On decode/playback failure preserve original owned bytes and readable poster with a visible error; disable faulty editing while retaining source and undo pins.

## Unresolved evidence / next step

Complete the remaining acceptance against the current source and linked evidence. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
