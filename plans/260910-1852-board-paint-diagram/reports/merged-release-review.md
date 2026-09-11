# Merged Release Review

Scope: read-only integration review of merge `a934a16d5448821e6b5aaed409beb423622693ff`, parents `920dd61` creative release and `3b3c45d` persistent thumbnails. Focus: thumbnail merge impact on creative generation, CAS/private-source isolation, document versioning, exports, and publication.

## Result

No verified blockers found in the requested merge-integration scope.

## Evidence

- Auth and ownership: `server/index.ts` gates `/api/projects/*` through `owner(c)` before routing. Thumbnail reads then call `projectRow`, which selects by `id` and `user_id`; project summaries expose only owner-scoped `thumbnailUrl` and `thumbnailRevision`.
- Thumbnail render path: `server/thumbnails.ts` accepts only saved revisions, serves cached ready covers, refuses stale uncached revisions, claims one owner render lease, stores output after render, and publishes only when the same lease still owns a non-deleting project.
- Export integration: `server/thumbnails.ts` calls `renderProjectExport(..., { format: 'png', expectedRevision }, true)`. `server/exports.ts` still loads the owner project, checks expected revision, parses the shared document schema, applies `publicCreativeProjection`, validates assets against the project, blocks external media for cloud rendering, embeds owned assets, blocks renderer network, and calls `studioRenderer.thumbnail`.
- Creative source isolation: `src/shared/public-creative-projection.ts` requires fresh painting composites, converts artwork and board painting elements to image/composite references, clears `doc.paintings`, removes hidden board content, filters timeline tracks, and retains only referenced public assets.
- Renderer support: `scripts/export-renderer.ts` defines `thumbnail(doc)` using the same export mount/raster path and registers it on `globalThis.studioRenderer`.
- Deletion/race behavior: `server/projects.ts` marks `thumbnail_deleting=1` before reading storage keys, deletes project assets plus thumbnail storage keys, then deletes the project. `server/thumbnails.ts` deletes late/superseded output before returning.
- Migration order: final migrations contain `0010-project-thumbnails.sql` for thumbnails and `0011-creative-asset-lifecycle.sql` for creative asset leases/receipts. The renamed creative migration uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so it is tolerant if an earlier local environment already applied the old filename manually.
- Version alignment: final root package and CLI package both report `0.4.0`; remerge conflict choices kept creative `0.4.0` release text over upstream thumbnail `0.3.3`.
- Coverage present in source: `tests/thumbnails.test.ts` exercises persistent cache survival across DB/process restart, MCP and CLI parity, owner isolation, private cache headers, retained revision limits, external-media failure cooldown, and delete-while-rendering cleanup.

## Scout Findings

- Main integration risk was not the route itself; it was the shared export helper now being used by thumbnails. The final helper applies the creative public projection before binary rendering, so thumbnail generation uses the same private-source boundary as export/publication.
- The migration-number conflict was real. Final state renames creative lifecycle from `0010` to `0011` so thumbnail `0010` can apply first. No blocker found because creative SQL is idempotent and thumbnail SQL is a new additive migration.
- Route ordering is acceptable: `exportRoutes` only handles `POST /:id/export`; `thumbnailRoutes` handles `GET /:id/thumbnail`, so no shadowing found.

## Checks Run

- `git show --remerge-diff --find-renames a934a16`
- `git diff --check`
- `node --check server/index.ts`
- Targeted source reads of `README.md`, `AGENTS.md`, `server/projects.ts`, `server/exports.ts`, `server/index.ts`, `server/thumbnails.ts`, `migrations/0010-project-thumbnails.sql`, `migrations/0011-creative-asset-lifecycle.sql`, `scripts/export-renderer.ts`, `src/shared/schema.ts`, `src/shared/public-creative-projection.ts`, `server/mcp.ts`, `packages/cli/src/dsa.ts`, and `tests/thumbnails.test.ts`

## Limits

- Did not run unit, build, server, E2E, provider, or production smoke checks per task constraint; parent session is running unit/build checks.
- Did not re-review the full creative release implementation; prior creative review was treated as already passed, and this review stayed on merge-caused regressions.

## Unresolved Questions

None.
