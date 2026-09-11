# Engine assumptions and state-lifetime plan review

Planning-only source review, 2026-09-10. Reviewed architecture, acceptance matrix, engine research and current editor/schema/gesture/export/test configuration. No dependency installs, tests, builds, servers or product edits. `plan.md` and phase files were not available during this pass; controller owns the final dependency/phase consistency sweep.

## 1. P2 — Specify reconciliation when a remote response arrives during an active gesture

**Plan locations:** `architecture.md:34,54,75-81`; `acceptance-matrix.md:10,13,18,28,58`. The design correctly separates drafts from persisted transactions and rejects stale layout results, but does not assign a source snapshot/lifetime to an active gesture or specify how an already-running sync response affects it.

**Scenario:** A changes poll starts, then the user begins a long Pencil stroke, connector drag or group transform. A remote non-overlapping edit returns while the gesture is active. The canonical document advances, but the next pointer sample is still computed from the gesture's captured original document. It can overwrite that remote edit locally; a mixing brush can also switch sampled source halfway through a stroke if it reads the advancing canonical state directly. Blocking new polls during a gesture alone misses this already-in-flight response. Pointer cancellation must discard the draft without restoring the obsolete whole document over the accepted remote state.

**Source evidence:** `src/app/editor.tsx:476` checks `drag.current` only before the asynchronous request. Its response is applied at `src/app/editor.tsx:484-493` without a gesture-generation check. `src/app/editor.tsx:798` captures a whole original document; `src/app/editor.tsx:810-817` later clones that snapshot and replaces `docRef.current`. The new Board/Paint integration needs an explicit rule here instead of inheriting this interaction. `src/app/canvas-gestures.ts:25` can cancel a drag on a second touch, adding a cancellation path to the same state boundary.

**Fix:** Make active gestures own an immutable base identity and a separate draft/delta. Keep remote canonical updates separate; either queue projection changes until the gesture completes/cancels or rebase a completed semantic delta against the newest canonical state. Never replace the document with the old gesture snapshot. Paint sampling remains fixed to the captured painting generation; a conflicting source change preserves the local draft and requests explicit reconciliation rather than retargeting the stroke. Scope deferred responses and worker output by owner/project/board-or-painting/gesture identity, and discard them after cancellation or navigation. Add a controlled sequence: start poll → start gesture → resolve non-overlap update → continue → complete/cancel → save/reload/undo, plus an overlapping paint-source variant. Verify one history entry and preserved remote edits.

## Verified assumptions retained

- Excalidraw is conditional on released-package round trips, coherent host history, GIF z-order/input and primary-device evidence. The plan does not infer undo-stack APIs from `history.clear()` or treat a pending GIF PR as shipped support. No additional broad SDK research needed.
- Native SVG/Canvas fallback retains the full requested scope and requires re-estimation. A three-day evidence timebox in engine research is not a full delivery estimate.
- Paint pixels/manifests are authoritative; transient command recovery does not silently introduce permanent replay dependency. Fresh generations on undo and transaction receipts address the already-reported ABA/lost-acknowledgement hazards.
- CPU/GPU caches, decoded-pixel admission, staged reservations and conservative reference retention are explicit. The 24-layer workload's base tile count is correct; masks/history still require actual measured admission, as stated, so no blanket cap increase is proposed.
- All four diagram families, advanced paint, editable vector paths, owned GIFs/stickers/emoji and phone basic operations have observable acceptance rows. Physical iPad/Pencil testing is explicitly separate from Playwright WebKit; desktop Chromium/Firefox and mobile WebKit commands match the current test configuration.
- Export/publication uses finite projections and source-matched composites. Current `mountExportPage` only advances 3D on `draw()` (`src/app/export-page.ts:32`), but the new shared GIF compositor/timeline requirement already requires extending that boundary; this is planned work, not a new finding.

## Unresolved questions

None requiring user preference. Final phases were unavailable; ensure the gesture reconciliation acceptance lands in the Board/Paint and live-sync tasks, alongside physical-device and renderer lifecycle checks.

Status: DONE_WITH_CONCERNS
Summary: Found one concrete state-lifetime acceptance gap: in-flight remote synchronization across an active/canceled gesture. Existing engine/device uncertainty is properly gated rather than assumed solved.
Concerns: Final phase files and their dependency graph require controller review when authored.
