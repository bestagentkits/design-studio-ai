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
- [x] PR #5 CI green; merged main at 6f5bcc2.
- [x] Main CI/deploy run 34223268925 succeeded; Worker c1f2fe62 at 100%, migration 0007 applied.
- [ ] Live production health, public docs, design-system persistence and export checks.

## Notes

The ak CLI is unavailable in this shell, so plan-index finalization is unavailable. The repository's completed file-backed implementation plan remains linked in the PR. This does not block Git or deployment.

Unresolved questions: none.

## Production video follow-up

Production verified owned library versions, stale-write rejection, pinned MCP application, font discovery, React ZIP source, and GLB/glTF mesh/material/animation bytes. PNG/PDF/PPTX, 3D PNG and published viewers also passed. All isolated test accounts and projects were removed; direct D1 count confirmed zero release-verification accounts.

Short WebM clips intermittently returned `render_failed`. A remote Worker preview using the actual Cloudflare Browser binding reproduced `The video encoder returned no frames`. Chromium 128 could start encoding 400–650 ms after `MediaRecorder.start()`, so the old stop/drain interval could expire before initialization. Direct CDP did not reproduce consistently. Page visibility was `visible`.

Waiting before advancing the timeline was rejected after ffprobe showed an extra startup-length hold. Waiting immediately before stop was also insufficient: a 200 ms clip could contain only one frame. The final fix renders on the original clock, waits for the native startup event, then drains queued frames for the existing 100 ms interval before stopping. Actual Cloudflare VP9 output for a 200 ms moving-shape clip decoded four distinct frames at 0, 32, 73 and 122 ms without a startup-length timestamp gap. The startup wait has a ten-second timeout; errors and recorder/media resources are cleaned up.

- [x] Implement startup-aware encoder draining without changing the timeline clock; prefer VP8 for real-time WebM, retaining VP9 fallback.
- [x] Independent review found no blocking issue. Local real-recorder lifecycle and 137 tests passed; final codec preference recheck and remote CI follow below.
- [ ] Merge follow-up, deploy 0.2.3 through main workflow, rerun production video export.

No database or credential changes are required for this follow-up. The renderer remains a real-time recorder; verification does not claim frame-perfect offline encoding.

Final codec verification: VP9 remained backlogged on the cloud runtime even after startup-aware draining. WebM now prefers supported VP8, retains VP9/generic fallback, and leaves MP4 selection unchanged. The final 500 ms Cloudflare Chromium 128 capture decoded 11 distinct VP8 frames at timestamps 0 through 482 ms, without startup padding. This supports the chosen default; it does not establish exact frame fidelity for every encoder or load condition.
