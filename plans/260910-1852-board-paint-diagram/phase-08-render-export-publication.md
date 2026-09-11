# Phase 08 — Rendering, export and immutable publication

Status: pending. Priority: P1. Provisional effort: 6–10 engineering days.
Dependencies: Phases 04–06 supply per-slice render primitives, asset ownership and animation/compositor behavior.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

## Requirements and design

Complete and inspect every output row in [acceptance](acceptance-matrix.md). Share trusted geometry/compositor between editor, publication, browser and server/headless export; preserve editable source in the saved document while documenting vector/raster/rejected format boundaries.

Exports use finite artboard/crop/content bounds and only relevant owned assets/validated composites. Respect existing pixels, bytes and duration bounds. JSON is canonical metadata/references, not an offline portable archive.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/react-export.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/font-loading.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/scene-runtime.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/document-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/export-page.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/file-formats.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/export-node.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/google-slides.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/published-html.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/export-renderer.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/published-viewer.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/react-prototype-entry.txt`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/build-renderer.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/architecture.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/export.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/exports-agent-formats.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/structured-export.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/published-viewer.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/published-notes.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/server.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/board-render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/painting-render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/export-capabilities.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/creative-exports.test.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

- [ ] Build a render projection from selected pages/boards/artwork and exact contributing generations. Use derived composites for static paint instead of embedding every editable/historical tile; regenerate or fail mismatched composites.
- [ ] Render all Board paths/text/connectors/labels/roughness/seed, nested transforms/crops, paint blends/masks and selected GIF samples consistently. Preserve finite export bounds while camera navigation stays unbounded-feeling.
- [ ] Add SVG vector structure where supported and embedded paint/GIF posters; inspect selected-time PNG/PDF pixels and PowerPoint's existing editable primitives plus faithful Board/Paint composites.
- [ ] Extend trusted HTML/published viewer/React prototype runtime with owned or packaged assets and controlled GIF playback/reduced motion; no external app iframe, SDK activation or private project fetches.
- [ ] Sample GIF time deterministically in WebM/supported MP4 using existing duration/pixel limits and encoder errors. Keep browser fallback audio limitations explicit.
- [ ] Retain Google Slides native/HTTPS-image policy: unsupported Board/Paint fails preflight; never publish private images automatically. GLB/glTF retains actual 3D behavior and explicitly identifies unsupported 2D content.
- [ ] Freeze a sanitized publication render projection and snapshot-scoped bytes needed for visible rendering. Never serialize the full private painting document or publish hidden/masked source layers, tile URLs or source pixels recoverable from those assets; use a validated flattened visible composite where needed. Cloned private projects retain editable source and own their bytes. Test source deletion, subsequent edits and GC without breaking publications, undo or editable clone layers.
- [ ] Verify browser/server/CLI offline-versus-server export capability paths and honest errors. Add export options/capability docs through shared validators and all agent surfaces in this slice.
- [ ] Extend the hardcoded React source/package closure in `scripts/build-renderer.mjs` for every new transitive renderer/schema import. Preserve current web/wireframe kind support. Extract, install, build and run a generated Board/Paint-containing ZIP independently of the Studio build; inspect packaged assets.
- [ ] Collect Board-only text/label fonts and await readiness before measurement and network-isolated rendering. Verify wrapping/bounds with a sole non-theme connector font; report unavailable fonts explicitly.
- [ ] Implement browserless offline CLI HTML/SVG vectors and verified locally available media/composites; missing or stale asset inputs fail before writing a misleading artifact and direct users to authenticated server export. No implicit fetch/browser installation/new archive. Offline HTML uses static GIF posters; interactive playback uses the server/runtime path. Test vector-only, complete media, missing media and stale composite cases.
- [ ] Rebuild generated renderer/viewer/docs from sources and inspect artifacts in isolated renderer with external network disabled; preserve safe font handling, asset budgets and credential redaction.

## Slice parity and documentation

Before this slice is complete, expose its validated operations and capability/errors through the common server service, REST, MCP, CLI and feature-detected WebMCP. Preserve local-draft versus persisted-state semantics, expected revision and separate explicit brief approval. Update these existing owning surfaces with only this slice's changes:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

Update public content sources, then run `npm run build` to regenerate documentation/llms output. Never hand-edit generated `dist/` or renderer/viewer bundles. Unsupported actions must report a precise capability/version error rather than silently flatten or ignore content.

## Future validation — not run

Create actual output artifacts containing each diagram family, editable paths, masked mixed paint, multiple GIFs and a legacy 3D/text page. Inspect SVG nodes/path/labels and embedded URLs, decoded PNG/PDF pixels, PowerPoint contents/editable primitives, React ZIP/runtime, sampled video frames/timing and published snapshot bytes. Test selected-page projection excludes irrelevant hidden history while preserving rendering, and mismatched composite hashes reject/regenerate. Inspect published HTML/JSON/asset indexes directly for hidden layer metadata, source tiles and masked pixels; authorized editable JSON/export is distinct from public viewing.

Future commands: `node scripts/build-renderer.mjs`; `npm run build:cli`; `npx tsx --test tests/creative-exports.test.ts tests/export.test.ts tests/exports-agent-formats.test.ts tests/structured-export.test.ts tests/published-viewer.test.ts tests/published-notes.test.ts tests/server.test.ts`; `npm run typecheck`; `npm test`; `npm run build`. Follow up affected browser workflows on desktop/mobile and explicit Firefox/WebKit runs; do not equate filename/build success with artifact fidelity.

## Success criteria

All acceptance export rows have inspected evidence or explicit supported rejection; no silent missing elements. Snapshots remain immutable and isolated, static output embeds only needed assets, motion time is controlled, and editable saved/clone source survives publication/export.

## Risks, security and rollback

Huge editable sources may fit document quotas but exceed static export embedding unless projected/composited. Reject before expensive work when remaining bounds cannot fit. Preserve old snapshots and versioned readers on rollback; feature-disable defective exports without downgrading documents or regenerating secret keys.

## Unresolved evidence / next step

Refresh the source baseline and predecessor evidence before implementation. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
