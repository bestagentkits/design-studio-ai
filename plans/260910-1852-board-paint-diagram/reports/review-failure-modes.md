# Failure-mode review of the proposed plan

Read-only plan/source review, 2026-09-10. No implementation, dependency installation, test, build or server run. Architecture and acceptance matrix reviewed; phase files were not yet present at review time. Findings identify missing execution requirements, not existing Board/Paint bugs. Full requested scope remains intact.

## 1. P1 — Undo across the first v2 commit must not restore a v1 document or stale concurrency token

**Plan location:** `architecture.md:38-42,70-76`; `acceptance-matrix.md:31,55`.

**Failure scenario:** Open a v1 slide, add its first embedded Board, save the upgraded v2 document, then undo that gesture and save. Existing history captures the entire pre-edit v1 document; undo installs it directly. The proposed downgrade guard correctly rejects that save, leaving the user unable to save a legitimate undo. Simply removing the guard would reintroduce the data-loss boundary the plan is protecting. The same distinction matters for painting history: restoring old pixel references must not rewind a server concurrency generation. Otherwise stroke A at generation 8, undo to 7, and a different stroke B advancing to 8 can reuse a token for different source pixels; delayed jobs/reconciliation relying on that token cannot distinguish them.

**Source evidence:** `src/app/editor.tsx:368-381` captures and validates whole-document snapshots; `src/app/editor.tsx:422-435` directly replaces the current document during undo/redo. `src/shared/document-merge.ts:13-14` can return an old local snapshot unchanged when remote equals the sending base; `src/app/editor.tsx:453-456` uses this merge to rebase history after save. Current project revision is server incremented at `server/projects.ts:87-100`; painting generations are new and need the same explicit invariant.

**Proposed fix:** Specify that first successful v2 upgrade upgrades compatible undo/redo content states too, and that undo removes newly created content while keeping schemaVersion 2. History stores content inverses/asset references, never authoritative project/painting concurrency tokens. Every persisted painting change, including undo, redo, settings and restoration, receives a fresh server-owned generation or immutable source-state token that cannot be reused for different inputs. Make pending drafts/agent jobs compare that token. Add acceptance sequences for v1 → first Board save → undo → save → redo, plus a delayed paint job crossing undo/new stroke.

## 2. P2 — Lost commit acknowledgement lacks a definitive recovery/retry contract

**Plan location:** `architecture.md:64,70-76,86`; `acceptance-matrix.md:18,55`.

**Failure scenario:** The server finishes a non-idempotent smudge/deposit action and atomically saves its tiles, but the response is lost before the client records success. Another edit lands before reconnection. The recovered client holds the stroke draft and an old base; the latest revision alone cannot prove whether that stroke already executed. Retrying the old revision returns a conflict; replaying after inspection can apply the stroke twice. This differs from an upload that never committed and needs a distinct recovery state. The plan currently specifies interrupted uploads/conflicts but no stable operation identity or committed-result lookup.

**Source evidence:** `server/projects.ts:87-101` performs CAS and then separately reads a response project; it records no per-request receipt. `server/collaboration.ts:15-16` returns only the merged project. `src/app/editor.tsx:464-468` handles response failure without learning whether the write committed. `server/projects.ts:159-166` allocates a fresh asset identity for each upload, so repeating upload alone does not resolve the uncertainty.

**Proposed fix:** Give each persisted paint transaction an owner/project-scoped stable ID and payload/input fingerprint, retained with its outcome in the same atomic database commit as the manifest. Repeating an identical ID returns its original committed revision/result without executing again; changed payload under the same ID is rejected. Expose bounded status/recovery lookup through the shared service for UI and agent clients. Keep unknown outcome distinct from failed/conflicted; reconcile the receipt before any replay. Link staging assets and dependent local stroke queue entries to that transaction identity, with documented receipt/recovery retention. Add a response-dropped-after-CAS scenario followed by a later remote edit and same-ID retry; expect exactly one pixel application and one history entry.

## Checked and not raised as findings

- Painting-wide conflicts explicitly protect color pickup from concurrent visible-layer/settings changes (`architecture.md:72`); no finer tile merge is required.
- Immutable asset retention, pins, in-flight protection and missing-draft errors are explicit (`architecture.md:86`); do not weaken them to reclaim storage early.
- GIF frame timing/disposal, controlled playback, z-order and deterministic static/motion outputs are explicit (`architecture.md:92`; `acceptance-matrix.md:54,64-68`).
- Static render projections, source-matched composites, offline server rendering, publication-scoped URLs and truthful target-format limits are explicit (`architecture.md:94`; `acceptance-matrix.md:59-72`). Existing export code at `server/exports.ts:84-100,118-145` explains why those changes are necessary; they are already planned.
- Old-client downgrade rejection and v2-readable rollback are correct boundaries (`architecture.md:40-42`); preserve them while fixing undo.

Unresolved questions: none requiring user preference. Phase author should make the two recovery contracts explicit before implementation.

Status: DONE_WITH_CONCERNS
Summary: Traced history, merge, CAS, asset storage, GIF and export proposal against current source. Two bounded plan gaps remain: version/token-safe undo and lost-acknowledgement transaction recovery.
Concerns: Phase files were not available during this pass; controller should check the final execution tasks include these requirements.
