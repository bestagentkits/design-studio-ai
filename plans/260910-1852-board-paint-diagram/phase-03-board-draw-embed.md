# Phase 03 — Board, Draw and editable embedded surfaces

Status: in progress. Priority: P1. Provisional effort: 8–12 engineering days.
Dependencies: Phase 02 canonical contracts and asset/history primitives; Phase 01 engine decision.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

Current implemented subset and remaining gates: [production integration](reports/production-integration.md). Open checklist rows contain requirements beyond the current slice; they are not silently waived.

Current delivery update: Board selection, transforms, grouping, paste, numeric/path editing and keyboard nudge are implemented; see [delivery](reports/diagram-board-delivery.md). Three desktop Board scenarios now pass, including durable recovery across two reloads; the checklist below is not blanket acceptance.

## Requirements and design

Create a standalone Board destination with Draw/Diagram/Elements modes and focused Paint entry. Implement freehand pencil/ink/brush/eraser, editable open/closed vector pen with curve handles and recolorable stroke/fill. Selection, groups/frames, transform, align/snap, clipboard, locks and layer order must behave coherently across keyboard, mouse, touch and Pencil.

Embed boards/artwork in slides/reports and existing pages with explicit finite view/crop bounds. Multiple linked views have separate crops; ordinary duplication creates independent source. Existing web/layout/3D controls retain behavior.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/app.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/canvas-gestures.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor-selection.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/document-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/inline-text-editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/layer-tree.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/inspector.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/keyboard-navigation.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/styles.css`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/catalog.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/editor-ergonomics.spec.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/keyboard-ux.spec.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/structured-editor-ui.spec.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-workspace.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-toolbar.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-engine-adapter.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-gestures.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board-history.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/board.css`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/board-geometry.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/board-draw.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/board-draw-ui.spec.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Reconciled 2026-09-11 against [current source and local evidence](reports/implementation-checklist-reconciliation.md). Checked rows record implemented behavior, not full device, cross-surface, format or release acceptance. Unchecked compound rows retain their unverified requirements.

- [x] Implement the selected engine adapter behind canonical commands; reuse Phase 01 proposed modules if retained. Map IDs/geometry/style/pressure/seed explicitly and refuse unsupported projection changes before saving.
- [x] Add standalone Board creation and editable board/artwork embeds with crop framing. Keep local pan/zoom from changing containing flex/grid geometry; disallow recursive board embedding.
- [ ] Add full Draw tool behavior including pressure-aware curves, tiny dots, ink taper, vector path handles, fill/stroke recolor, erasing, text/IME and frame/group management.
- [x] Add visible-geometry hit-testing, child/group selection, lock-aware transforms, align/snap, flips, keyboard nudge and clipboard remapping. State external connector policy when duplicating a selected subset.
- [ ] Arbitrate one active gesture surface against existing capture-phase listeners. Use pointer capture/coalesced-event fallback; cancel cleanly on two-finger pan, Escape, blur or pointercancel, with no accidental marks.
- [x] Replace high-frequency full-document snapshots with bounded gesture transactions referencing immutable assets. One completed gesture is one undo; programmatic updates do not echo, remote changes are not local undo entries. Undo restores old content through a fresh revision/generation and never decrements schemaVersion; upgrade legacy history entries before applying them to v2.
- [ ] Show pending/uploading/saved/conflict states and account-scoped recoverable drafts; restore only against an inspected base revision. Remove/isolate private recovery data on logout/account switch.
- [ ] Keep immutable gesture base plus separate local delta. Queue/reconcile already-in-flight live-sync responses without overwriting the active draft; cancellation discards only local work, never restores the old document. Complete independent rebases through shared validation and reject changed painting sources. Test sync-start → gesture-start → remote-response → complete/cancel → save/undo.
- [ ] Add keyboard-accessible named tools, focus restoration, touch controls/bottom sheets and phone basic workflow. Cull offscreen content rather than allocating an enormous canvas.
- [x] Deliver shared operations for insert/edit/group/transform/crop/reorder and current-slice rendering before exposing controls. Update guide and cross-surface examples with local/saved distinctions.

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

Proposed tests: path/pressure geometry and clipboard binding remapping; one gesture/one undo; remote edit survives undo; undo keeps generation/schema monotonic; no SDK echo loop; independent versus linked embeds; page layout stable during pan. Browser checks cover draw/curve editing, IME/focus, touch cancel, saved-state feedback, embedded reopen and legacy editor regressions.

Relevant commands (individual execution evidence is linked above): `npx tsx --test tests/board-draw.test.ts tests/editor-selection.test.ts`; `npm run build:cli`; `npm run typecheck`; `npm run build`; `npm run test:e2e -- tests/board-draw-ui.spec.ts tests/editor-ergonomics.spec.ts tests/keyboard-ux.spec.ts tests/structured-editor-ui.spec.ts --project=desktop`; repeat affected specs with `--project=mobile`. Run explicit Firefox/WebKit projects with `STUDIO_CROSS_BROWSER=1`, then physical Pencil/reference workloads separately.

## Success criteria

DRAW-1–4, EMBED-1 and UX-1 meet this slice's interaction matrix; normal/stress Board workloads measured on both primary devices. Structured agent edits reopen identically, undo preserves remote edits, and existing page/3D workflows remain usable.

## Risks, security and rollback

SDK APIs, gesture conflicts and accessibility may require native integration work. Feature-disable editing while retaining v2 read/render/export/recovery if defects occur; do not convert Board content into opaque images or discard accepted tools. Keep asset-backed history pins when closing a surface.

## Unresolved evidence / next step

Complete the remaining acceptance against the current source and linked evidence. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
