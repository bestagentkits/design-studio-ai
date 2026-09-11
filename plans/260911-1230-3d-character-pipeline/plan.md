# 3D character authoring pipeline

Status: in progress

Outcome: turn the existing Mochi study into an editable, skinned and animated 3D character using production WebMCP. Deliver the previously proposed mesh, rig, animation, UV and inspection capabilities across shared contracts, human UI and agent surfaces.

Constraints: preserve existing projects, revisions, undo and owned assets; no AK skills; no public publication; deploy only tested changes. Existing landing page remains untouched.

Non-goals: third-party paid model generation, unrelated 2D changes, changing credentials.

## Delivery
- [x] Shared bounded geometry operations: primitive conversion, symmetric remeshing, smoothing, UV islands and painting.
- [x] Quadruped landmark rig, automatic and editable normalized weights, pose/IK controls.
- [x] Morph targets, reusable motion clips and GLB preservation.
- [x] Mesh/rig diagnostics, multi-pose inspection and compact agent operations.
- [x] Human editor controls, REST/MCP/WebMCP/CLI and documentation parity.
- [x] Unit/integration/browser/export validation; fix regressions.
- [ ] PR, exact-head CI, production deploy and live discovery.
- [ ] Rebuild Mochi through WebMCP, inspect animation and exported GLB.

Acceptance: supported operations produce real geometry and skinning; invalid/stale writes fail atomically; source poses persist during playback; exported model preserves mesh, skeleton and animation; live production demonstration is verified separately from CI.

## Evidence so far
- Shared unit suite: 188 passed before the final attachment/IK refinements; focused follow-ups cover those changes.
- Chromium desktop/mobile authoring acceptance passed; Firefox and mobile WebKit passed the same rig/save/GLB workflow.
- GLB roundtrip validates morph weights, texture presence, skeletal pose and nonzero bind rotation.
- Production deployment and live Mochi recreation are still pending.

## Defined capability boundaries
- Smooth remesh supports ellipsoids and bounded document triangle meshes through a BVH; asset-backed imported nodes must become document geometry first. Joint-ring loft provides controlled limb topology separately.
- Weight binding uses nearest bone segments, not learned anatomy; rig landmarks can be supplied explicitly.
- UV islands use planar projection and need visual review; brush produces a 512px base-color map.
- Diagnostics are structural and deformation checks, not a self-intersection or artistic-quality certificate.

## Review notes
- Kept large immutable mesh buffers out of per-frame animation clones; preserved exact legacy interpolation output shape.
- Worker results are rejected if the document changed during processing. API preview checks the observed revision and never saves; apply reuses server CAS.
- Added explicit bounds on remesh input/output resolution, morph buffers, UV expansion and paint strokes.
- Accessory geometry is baked into rig space; poses and preset clips propagate to attached meshes.
- Existing topology tools reject data they cannot preserve. UV remapping copies skinning and morph deltas.
- Corrected mobile overlay placement using the actual wrapped toolbar height; four browser/device configurations passed.

Local verification: 189 unit/integration/export tests passed; earlier implementation typecheck/build/skill packaging passed. The final new documentation route required a SectionId update; rerunning final gates before merge. Focused browser acceptance: Chromium desktop/mobile, Firefox desktop, WebKit mobile, all passed.

Merged main thumbnail persistence changes; post-merge typecheck, CLI build, full tests and production build passed. PR #23 awaits exact-head CI.
