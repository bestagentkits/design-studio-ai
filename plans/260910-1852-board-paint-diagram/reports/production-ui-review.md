# Production UI Review — Creative/Paint Integration

## Scope

Files reviewed read-only after latest root fixes:

- `src/app/painting-recovery.ts`
- `src/app/painting-workspace.tsx`
- `src/app/painting-session.ts`
- `src/app/editor.tsx` live sync / modal paths
- `src/shared/paint-runtime.ts`
- `src/shared/paint-stroke.ts`
- Related merge/test evidence in `src/shared/document-merge.ts`, `tests/creative-editor-ui.spec.ts`, `tests/document-v2.test.ts`

Focus: real production failures in async cancellation/live sync/history correctness, pointer/focus behavior, rendering fidelity, failures losing local work, and duplicated references. No source edits in this pass.

## Findings

### Critical

None found in reviewed slice.

### High

None found in reviewed slice.

## Verified behavior and evidence

- Pending paint recovery keeps a concrete transaction object while upload/merge work is outstanding. `accept()` stores the `PaintingRecovery` in state/ref before upload, disables tools through `recovery`/`busy`, and leaves recovery visible on failure instead of dropping the local draft (`src/app/painting-workspace.tsx:83-91`, `src/app/painting-workspace.tsx:43`).
- Retry after a merge rejection reuses the same recovery object. `PaintingRecovery.prepare()` memoizes the prepared document after a successful prepare, so a merge failure does not force already-prepared pixels/settings to be regenerated (`src/app/painting-recovery.ts:9-21`).
- Recovery applies through canonical generation checks. `replace-painting` requires the expected generation and rejects stale painting writes before replacing the painting (`src/shared/board-operations.ts:28-34`).
- Live sync no longer applies a response over an open creative/painting modal. The editor marks creative modal state as sync-blocking, and an already-in-flight live response waits until the modal closes before merging against current local work (`src/app/editor.tsx:375-382`, `src/app/editor.tsx:486-506`).
- Frozen visible pickup is implemented in the session layer. `PaintingSession.initialize()` builds the full composite surface once, and `beginStroke()` samples that frozen RGBA surface while committing only to the selected layer runtime (`src/app/painting-session.ts:29-44`).
- The fast desktop layer-settings race is addressed by gating controls on `readyKey !== sourceKey`, where `sourceKey` includes selected layer id and source hash. Stale sessions cannot accept setting changes once doc source/layer no longer matches (`src/app/painting-workspace.tsx:23-43`, `src/app/painting-workspace.tsx:101-105`).
- Same-painting source conflicts still propagate. The parent modal commit calls `mergeDocuments()` before `change()`, and `PaintingWorkspace.accept()` catches the thrown error while keeping recovery (`src/app/editor.tsx:1870`, `src/app/painting-workspace.tsx:83-91`). `document-merge` treats painting source records as coupled while allowing composite-only refreshes (`src/shared/document-merge.ts:15-22`).

## Medium / follow-up risks

- Upload failures before `PaintingRecovery.prepare()` reaches its memoized document can re-upload earlier successful tiles on retry. The current memoization starts after `session.finish()` / `finishSettings()` completes and `mutateDocument()` succeeds (`src/app/painting-recovery.ts:12-21`). This does not lose local work because the `PaintStroke`/settings remain in the recovery object, but it can leave extra uploaded assets if a later tile or preview upload fails after earlier uploads succeeded.
- While a modal is open and an earlier live response has returned, `syncing.current` remains true until modal close (`src/app/editor.tsx:491-511`). This protects local modal work from being overwritten, but it also means local strokes/settings are memory-only until the modal closes and the follow-up live save runs. The UI tells users layer changes persist after saving; crash recovery during a long modal session is not covered by this slice.

## Scout edge cases checked

- In-flight `/changes` response started before modal open, then remote save and local stroke before modal close: covered by E2E scenario in `tests/creative-editor-ui.spec.ts:80-109` and supported by editor wait/merge path.
- Upload abort followed by Retry / PNG backup / local recovery state: covered in `tests/creative-editor-ui.spec.ts:36-48`; recovery state remains mounted by code path above.
- Remote composite-only refresh against local painting source edit: covered by regression in `tests/document-v2.test.ts:51-65`.
- Same painting source changes: conflict remains explicit through `document-merge.ts:21-22` and the same regression.
- Stale selected layer/session after rapid setting changes: controls disabled until source/layer ready key matches, reviewed in `painting-workspace.tsx:23-43` and `painting-workspace.tsx:101-113`.

## Verification evidence from this agent

Earlier owned-fix verification in this task:

- `npx tsx --test tests/document-v2.test.ts` — pass, 7 tests.
- `npm run typecheck` — pass.
- `git diff --check` — pass.
- `npx tsx --test tests/board-history.test.ts tests/creative-persistence.test.ts` — pass, 12 tests.
- Desktop E2E previously reached the painting blend persistence assertion and failed before root's latest ready-key fix; root is running the updated E2E on port 19203 per handoff. I did not start another E2E server in this review.

## Unresolved questions

- Resolved by root: stored multiply blend and recovery/smudge/save/reload/publication scenario passed on desktop Chromium, Firefox, WebKit and Chromium mobile; the late Live response scenario also passed on all four. See [production integration](production-integration.md) for final evidence and limits.
