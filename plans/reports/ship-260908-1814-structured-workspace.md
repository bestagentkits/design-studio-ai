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
- No skill files or secret values changed. No social messages requested or sent.

## Gates

- [ ] Local merged-state typecheck, unit/integration, build and full browser suite.
- [ ] Pull-request CI green; review and merge main.
- [ ] Main verification, migration and Cloudflare deployment green for the merge commit.
- [ ] Live production health, public docs, design-system persistence and export checks.

## Notes

The ak CLI is unavailable in this shell, so plan-index finalization is unavailable. The repository's completed file-backed implementation plan remains linked in the PR. This does not block Git or deployment.

Unresolved questions: none.
