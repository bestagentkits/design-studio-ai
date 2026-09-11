# Native diagram delivery — issue #32

Status: local verification complete on merged code; GitHub release pending.

## Spec compliance
- Native shared canonical board document retained; no Excalidraw editor dependency or separate store.
- Rough.js sketch/clean geometry, hatch styles, configurable appearance: board-schema, board-sketch, diagram-style.
- Four bundled OFL fonts with Vietnamese glyph metrics and portable font bytes: build-diagram-font, diagram-text, board-render.
- Flowchart, architecture, user-flow, mind map: diagram-presets, diagram-arrange, diagram-layout.
- Bound connection exits, rotated bounds, orthogonal obstacle avoidance, rounded paths, sampled curve labels: diagram-routing, diagram-curve.
- Direct labels/ports/endpoints/segments, keyboard branches, existing snap/align/history: creative-workspace and diagram panels.
- Defaults/presets and agent parity: shared diagram operation schemas, docs/creative-tools, docs/agents, CLI README, skill, generated public docs.

## Review and regression fixes
- Removed Zod defaults from partial patch fields to preserve ports and overrides.
- XML-escaped embedded font CSS so exported SVG decodes as an image.
- Kept public font inventory stable while avoiding unnecessary bundled-font fetches in the editor.
- Locked ancestor children included as layout obstacles; rotated endpoints exit routing bounds.
- Independent connector label color/font settings preserved; direct port creation uses defaults.
- Endpoint overlay hit-through, geometry hit testing for transparent/hatched nodes, zoom-sized edge tolerance, incoming-side center binding and inline connector typography fixed from reviewer findings; browser regression test verifies persisted endpoint binding.
- User-flow Yes/No label positions separated after inspecting actual native screenshots.

## Local evidence
- Merged main `585a7be` into implementation; code head `5ae3786`.
- `npm run build:cli`, `npm run typecheck`, `npm test`: 323 passed, zero failures.
- `npm run build`, `npm run pack:skill`, `git diff --check`: passed. Public docs and machine indexes regenerated from source.
- Creative regression browser suite: 26 passed (Chromium desktop/mobile; five affected specs).
- Focused diagram quality: 12 passed after all review fixes; reviewer independently rechecked these tests.
- Native screenshots inspected for all four families; SVG XML parsing and image.decode exercised, PNG and Chromium PDF artifacts produced. Mind-map PDF raster inspected with Vietnamese text intact.
- Final diagram authoring/reconnect/save/export suite: 8/8 passed across Chromium desktop/mobile, Firefox desktop and WebKit mobile on merged code.
- Final review has no open Critical/High/Medium finding in reviewed paths.

## Boundaries
- No physical iPad/Apple Pencil available. WebKit mobile tests are not hardware validation.
- Nonbundled custom fonts depend on installed/loaded faces and have approximate server-only measurement.
- Automatic obstacle avoidance applies to orthogonal routes; curved/manual routes remain directly adjustable.
- Dependency audit reports eight high findings in existing Cloudflare/Puppeteer/PPTX/Sharp chains; not an audit-clean claim.
- Functional checks and sample review do not establish complete Excalidraw feature or visual equivalence.
