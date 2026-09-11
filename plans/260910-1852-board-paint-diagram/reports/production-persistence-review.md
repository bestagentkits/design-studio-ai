# Production Persistence Review

## Scope

- Worktree: `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai`
- Branch: `codex/board-paint-diagrams`
- HEAD: `3545d18d06215c6c4e5e188761818bba98a2e688`
- Focus: production-integration slice for creative persistence, asset lifecycle, save receipts, collaboration, public projection, and focused tests.
- Files reviewed: `server/projects.ts`, `server/painting-assets.ts`, `server/asset-lifecycle.ts`, `server/creative-save-receipts.ts`, `server/collaboration.ts`, `migrations/0009-creative-asset-lifecycle.sql`, `src/shared/schema.ts`, `src/shared/creative-validation.ts`, `src/shared/painting-schema.ts`, `src/shared/document-merge.ts`, `src/shared/public-creative-projection.ts`, `src/shared/paint-png.ts`, `src/shared/paint-composite.ts`, `src/shared/document-asset-references.ts`, `tests/creative-persistence.test.ts`.
- Scout findings: save/composite finalization can be interrupted by revision changes; changed painting composites have per-object bounds but no aggregate save bound.

## Overall Assessment

The slice covers the main accepted requirements in the focused happy path: v1 downgrade is rejected after v2, painting generation conflicts are enforced, PNG tile bytes and hashes are validated, public projection removes source paint tiles, and retry receipts work for the tested REST save path.

Two production risks remain. Both can pass current tests and fail under real traffic or adversarial payload size.

## Critical Issues

None found in this scoped pass.

## High Priority

### 1. Failed painting saves can leave committed composite assets after a revision race

`saveDocument` prepares painting assets before the final compare-and-swap project update. `preparePaintingAssets` stores the generated composite through `storeAsset`, which writes both bucket bytes and an `assets` row before returning the composite reference. Only after that does `saveDocument` attempt the project `UPDATE ... WHERE revision=?`.

Evidence:

- `saveDocument` validates the starting revision, then calls `preparePaintingAssets`: `server/projects.ts:79`, `server/projects.ts:89`.
- `preparePaintingAssets` stores the composite asset before the document is saved: `server/painting-assets.ts:46` to `server/painting-assets.ts:50`.
- The final document write can still fail with `revision_conflict`: `server/projects.ts:91` to `server/projects.ts:109`.
- No cleanup path removes composite assets created during a failed save.

Concrete reproduction run against the real app/router and local SQLite/FileBucket adapters:

```text
save status 409 {"error":{"code":"revision_conflict","message":"Project changed. Reload before saving."}}
assets [
  { id: '<tile-id>', name: 'tile.png' },
  { id: '<composite-id>', name: 'Painting composite.png' }
]
revision 2 documentHasComposite false
```

Impact: a metadata patch, theme application, MCP update, or other successful project write can win the revision race while a painting save is compositing. The painting save correctly returns 409, but leaves an unreferenced composite asset in the private asset list and quota accounting. Repeated races become durable storage/quota leakage.

Recommended fix: make composite asset finalization compensating. Track asset IDs/storage keys created by `preparePaintingAssets`; if the final project update or receipt batch fails or reports zero changes, delete those rows and bucket objects before returning the conflict. Keep reused old composites out of the cleanup list.

### 2. A single save can request unbounded aggregate compositing work across paintings

The schema permits up to 100 paintings, each up to 4096 by 4096 pixels. `preparePaintingAssets` loops over every changed painting and calls `compositePainting`; that function allocates a full RGBA output buffer per painting, and PNG encoding allocates another full row buffer. There is no per-save aggregate pixel or changed-painting budget before the work begins.

Evidence:

- `paintingSchema` allows `width`/`height` up to 4096: `src/shared/painting-schema.ts:17`.
- `documentSchema` allows 100 paintings: `src/shared/schema.ts:49`.
- `preparePaintingAssets` composites every changed painting in the save: `server/painting-assets.ts:13` to `server/painting-assets.ts:16`, `server/painting-assets.ts:46`.
- `compositePainting` allocates `painting.width * painting.height * 4`: `src/shared/paint-composite.ts:10` to `src/shared/paint-composite.ts:11`.
- `encodePaintPng` allocates `(width * 4 + 1) * height`: `src/shared/paint-png.ts:17` to `src/shared/paint-png.ts:22`.

Impact: a syntactically valid document can force many large composites in one request. The lease limits concurrent jobs, but it does not bound CPU or memory inside one job. This risks worker timeout/OOM and can hold the single-user creative lease until timeout.

Recommended fix: add a server-side budget before compositing, for example sum changed painting pixels and reject with 413 when the total exceeds the render/export budget already used elsewhere. Keep per-painting support intact; only bound one save transaction's total work.

## Medium Priority

None found with concrete reproduction in the scoped files.

## Low Priority

None.

## Spec Compliance Notes

- v1 preservation/no downgrade: covered by `server/projects.ts:80` to `server/projects.ts:81`, `server/collaboration.ts:14` to `server/collaboration.ts:15`, and focused tests.
- Painting-wide generation conflicts: `src/shared/document-merge.ts:15` to `src/shared/document-merge.ts:16` and `server/painting-assets.ts:30`.
- Immutable owned PNG tiles: `server/painting-assets.ts:19` to `server/painting-assets.ts:42`.
- Public projection excludes paint source: `src/shared/public-creative-projection.ts:22`, `src/shared/public-creative-projection.ts:35`, `src/shared/public-creative-projection.ts:40` to `src/shared/public-creative-projection.ts:42`.
- Retry receipts: `server/creative-save-receipts.ts:7` to `server/creative-save-receipts.ts:17`, `server/projects.ts:77` to `server/projects.ts:78`, `server/projects.ts:103` to `server/projects.ts:106`.

This review does not assess completion of the full nine-phase board/paint/diagram plan.

## Verification

Ran:

```text
npx tsx --test tests/creative-persistence.test.ts
npx tsx --test tests/document-v2.test.ts
```

Both passed locally:

- `tests/creative-persistence.test.ts`: 5 pass, 0 fail.
- `tests/document-v2.test.ts`: 5 pass, 0 fail.

Additional one-off reproduction confirmed the orphan composite asset race described above.

## Metrics

- Type coverage: not measured in this pass.
- Test coverage: not measured in this pass.
- Linting issues: not measured in this pass.

## Unresolved Questions

- What exact aggregate painting-save budget should match product intent: export's 64 megapixel workload limit, a stricter save limit, or a separate creative persistence limit?
