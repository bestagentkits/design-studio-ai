# Implementation and review evidence

Native feature scope implemented: schema v2 rig/mesh/skin/clip/constraints, Setup/Animate/Compose workspace, individual curves, weights worker, physics/baking, typed interactions/events, independent placements, revision guarded AI proposals, shared REST/MCP/WebMCP/CLI, native ZIP import/export and frame exports. Existing 3D composition from main is retained.

## Review fixes

A read-only reviewer reproduced world-translation constraints failing under rotated parents and bake losing slider-driven slot state. Both were fixed with regressions. Follow-up reproduced stale matrices when one constraint affects a parent and child; constraints now evaluate ancestors first and refresh each bone's world matrix. The reviewer rechecked the final regression and reported no remaining concern within that fix's scope. Its browser/export fidelity was not independently tested.

Other checked paths: downgrade guard, atomic document/brief revision compare-and-swap, geometry version/merge rules, owned asset remapping, unsafe ZIP paths/expansion and script non-execution, bounded physics work, and transparent multiply fallback.

## Verification so far

- Typecheck passed after integrated main changes.
- Full unit/integration suite after final fixes: 179 passed, zero failures (47.8 seconds); focused character suite: 18 passed. Renderer was built before the run.
- WebGL/Canvas pixel test passed: orientation, alpha, normal and inverse clipping.
- Character workflow passed desktop Chromium, mobile Chromium, Firefox 155 and mobile-viewport WebKit 26.6. Includes real PNG upload, keyframes, placements, save/reopen, PNG frames that differ, native ZIP import, and forced WebGL-loss fallback.
- React archive test now contains an animated character and builds the actual extracted source against installed dependencies.
- Build and skill package passed; full browser/CI gates and merge recorded in final release evidence.

## Explicit limits

No live BYOK provider generation was invoked; proposal validation and persistence are tested, model quality is not. Full device FPS and physical handset performance are not certified. Headless CPU submission results are recorded without equating them to display FPS. Video uses the existing real encoder and capability limits; no frame-perfect or universal MP4 claim. Native Studio packages are not Spine/PSD/game-engine formats.
