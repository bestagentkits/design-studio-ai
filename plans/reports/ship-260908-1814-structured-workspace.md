# Structured workspace shipping

Target: main and the existing Cloudflare production deployment at https://studio.agentkit.best.

## Delivery journal

- User explicitly requested shipping main and deploying after implementation verification.
- Started from detached 6ddac94; saved the completed change on codex/structured-design-workspace.
- Fetched origin/main at 634222d. Integrated the newer keyboard/OAuth fixes and verified-main deployment workflow without bypassing its checks.
- Resolved editor/inspector conflicts by retaining nested LayerTree plus keyboard navigation, scene authoring plus stable viewport focus, and the keyboard-aware inspector tabs.
- Shared authenticated browser fixture keeps new editor scenarios inside the production signup rate limit while preserving per-test contexts/projects.
- Patch version 0.2.2 identifies the app, source CLI, MCP and OpenAPI. Published v0.2.0 download links remain historical until a separate release artifact is published.
- Existing implementation reviews resolved captured image presets and absolute curl examples. Merge review preserves owner/version checks, schema compatibility, additive migration and production secret storage.
- Full browser verification found repeated WebGL contexts/static redraw consuming the 3D test budget. Scene cleanup now releases contexts; rendering invalidates on camera/transform/selection/resize/time changes. Focused desktop 3D workflow passed after the fix.
- Integrated subsequent main 34b7364 preview/share aliases; retained both documentation changes and added the aliases to OpenAPI/playground/WebMCP discovery.
- Updated older browser assertions for explicit Save versus live autosave, HTML node rendering, and body clicks away from transform handles on short mobile text. Keyboard focus assertions remain intact.
- Revalidated merged CLI build, typecheck, 137 unit/integration tests and production build. Wrangler dry-run succeeds (about 478 KiB gzip). Final full browser suite passed as recorded below.
- No skill files or secret values changed. No social messages requested or sent.

## Gates

- [x] Local merged-state typecheck, CLI build, 137 unit/integration tests and production build. Full browser suite: 24 desktop + 23 mobile passed; one existing mobile appearance skip.
- [ ] Pull-request CI green; review and merge main.
- [ ] Main verification, migration and Cloudflare deployment green for the merge commit.
- [ ] Live production health, public docs, design-system persistence and export checks.

## Notes

The ak CLI is unavailable in this shell, so plan-index finalization is unavailable. The repository's completed file-backed implementation plan remains linked in the PR. This does not block Git or deployment.

Unresolved questions: none.
