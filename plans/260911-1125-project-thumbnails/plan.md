# Reliable project thumbnails

Status: verified locally; shipping

Outcome: saved project cards show actual design content, including DOM, slides, motion and 3D. Revisit reuses previews; revision changes replace them. Preserve existing shared renderers, authenticated project reads and exports. No new provider calls, thumbnail schema, or database changes.

Diagnosis: mountExportPage(offscreen=true) positioned the captured root at left:-30000px. html-to-image clones the root's computed positioning into its SVG; captured artwork is outside the raster. Regression test reproduces alpha 0 instead of255. Introduced with project thumbnails in08ff069. Prior coverage asserted data URL presence only. All browser-generated project thumbnails are affected; regular export capture does not use the offscreen flag.

Repair: offset an outer inert/aria-hidden stage, keep the captured root in local coordinates, dispose the complete stage. Cache48 successful previews by project/revision in memory. Render motion covers at midpoint. Keep lazy serialized rendering and usable load/error states.

- [x] Trace and reproduce transparent pixels before fix.
- [x] Implement cause-aligned rendering stage and revision cache.
- [x] Pixel, cache, invalidation and mixed-design browser regressions.
- [x] Type/build/export checks and code review.
- [ ] Ship through PR, CI and verified production deployment.

The first simple browser regression failed before the fix with Expected255 Received0(alpha) and passed after the stage fix. Expanded tests own broader acceptance. Verification evidence will be appended here.

## Verification and review

- Thumbnail regressions: 2 desktop Chromium tests passed; 6 tests passed across mobile Chromium, Firefox and mobile WebKit. Checked actual alpha/color pixels for SVG, DOM, slides, motion and 3D; cache reuse and saved-revision invalidation. Screenshots in this directory were visually inspected (desktop and WebKit).
- `npm run build:cli`, `npm run typecheck`, `npm test` (180 passed), `npm run build`, and `git diff --check` passed. Existing build chunk warnings remain.
- Review: offscreen capture root stays local; both error and successful cleanup remove the outer stage. Normal exports retain their previous host placement. Cache contains only successful captures, is bounded, and keys actual saved revisions; authenticated reads and unmount guards remain. No API, MCP, CLI or database contract changed.
- Test corrections: use the server-assigned document ID for save requests; scroll to lazy-loaded cards on mobile before expecting capture. No rendering assertion weakened.
- Docs impact: minor, owning architecture guidance updated.

Visual review caught a WebKit-only missing 3D model despite the initial color-count assertion passing (text supplied those colors). Strengthened the regression to count blue object pixels. Investigating source canvas versus final capture before shipping.

Final browser verification: all 8 tests passed on Chromium desktop/mobile, Firefox and WebKit, including >50 blue model pixels. Visually inspected the corrected WebKit screenshot: model and ordered text layers are present. Source-canvas instrumentation established 220 blue pixels before capture versus 4 afterward in WebKit; direct ordered canvas compositing repairs that loss without changing the scene renderer. Instrumentation removed. Typecheck and build passed again after this repair.

Final shared regression checks: `npm test` passed all 180 tests again; both focused 3D material/layer-order and picking browser checks passed. No independent agent review was run; local two-pass review found no remaining correctness issue in the scoped diff.
