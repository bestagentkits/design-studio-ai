# Scope and contract review

Date: 2026-09-10. Plan-only source inspection. Reviewed architecture, acceptance matrix, intake and contract research against live schema, design-system, import, CLI, generation, publication, font and build owners. No installation, tests, builds, servers or product edits.

`plan.md` and `phase-*.md` were absent during this pass. Findings identify missing execution decisions/consumer ownership in the available architecture and acceptance documents; the controller must reconcile them with the completed phases before calling the plan reviewed.

## Findings

### 1. P2 — Specify the reusable-composition boundary for embedded Board/Paint

- Plan location: `architecture.md`, Canonical versioning / Board model / Asset lifecycle. Shared migration and traversal are covered, but design-system compositions are absent from the consumer list.
- Scenario: a user embeds artwork in a slide, chooses **Capture current page**, then saves/inserts that composition. Capture copies only the page (`src/app/design-system-library.tsx:27-31`). Library definitions store `pageSchema[]`, validate each using a synthetic v1 document with no assets, and reject private media (`src/shared/design-systems.ts:9,14-17`). Insert remaps only page-node IDs and interactions (`src/shared/design-systems.ts:54-60`). Root `boards[]` / `paintings[]` cannot survive that path without an explicit change.
- Concrete fix: name these consumers and define the initial library contract. Either support a versioned composition with a validated reachable Board/Paint/asset closure and typed remapping, or explicitly reject capture of these new dependent nodes before presenting a saved composition. Do not silently flatten or save dangling references. Keep applying existing token libraries and inserting existing v1 items into v2 projects lossless through the existing shared functions (`src/shared/design-systems.ts:29-38`; `server/design-systems.ts:43-52`). Reflect the selected boundary in UI, REST/MCP/CLI schema and docs; library support is not an excuse to cut requested editable embedding.

### 2. P2 — Assign the React archive source/dependency closure explicitly

- Plan location: `acceptance-matrix.md`, HTML / published viewer / React prototype row; `architecture.md`, API/documentation delivery.
- Scenario: a web/wireframe page embeds a Board; its exported React ZIP includes `schema.ts` or `render.ts` importing new board/paint modules, while those modules or runtime packages are absent. A successful Studio build does not prove the archive builds.
- Evidence: `scripts/build-renderer.mjs:9-10` copies a fixed eight-file source list; `:15-16` uses fixed dependency allowlists. `src/shared/react-export.ts:23-28` packages exactly that supplied manifest and the document. `server/exports.ts:104-106` consumes this generated manifest.
- Concrete fix: add `scripts/build-renderer.mjs`, `src/shared/react-export.ts` and any new renderer modules to explicit phase ownership. Update the complete trusted source/package closure; preserve supported web/wireframe export kinds rather than inadvertently extending React export to all project kinds (`server/exports.ts:70`, `src/shared/react-export.ts:7`). Acceptance must inspect a Board/Paint-containing generated ZIP's imports, installed dependencies, packaged assets and runnable result, independently of the main app build. Do not hand-edit the generated manifest.

### 3. P2 — Include Board text and connector labels in font discovery

- Plan location: `architecture.md`, Board model / Elements and exports; `acceptance-matrix.md`, diagram and export fidelity rows.
- Scenario: a diagram label uses a font absent from theme/page-node styles. Editor engine loads it, but the isolated renderer falls back; labels wrap differently and connector bounds/export appearance drift.
- Evidence: `src/shared/font-loading.ts:8-10` only collects theme fonts and `pages[].nodes[].style.fontFamily`. HTML uses that collector (`src/shared/render.ts:123`); binary exports embed those fonts before disabling renderer external requests (`server/exports.ts:22-23,113,119-132`). Root Board element and connector-label fonts would be invisible to these owners.
- Concrete fix: explicitly extend shared font discovery to reachable Board text/labels and define any bundled engine-font assets in the same renderer/asset policy. Verify label measurements and wrapping after font readiness for browser, static SVG/HTML, binary exports and React package. Include a fixture whose sole non-theme font occurs inside a Board label; retain truthful fallback errors when a font cannot load.

### 4. P2 — Make offline CLI v2 rendering behavior executable

- Plan location: `acceptance-matrix.md:66,75` distinguishes JSON from a portable archive and names offline/server checks, but does not decide the offline asset/compositor behavior.
- Scenario: an agent exports canonical v2 JSON containing private paint tile references, then runs `dsa render --format svg`. There are no local bytes or trusted composite to render. A server/headless compositor alone cannot satisfy this path, and printing asset URLs would produce a broken artifact.
- Evidence: `packages/cli/src/dsa.ts:134-139` reads the local document and synchronously invokes shared `renderHtml`/`renderSvg`, without fetching assets or launching a browser. HTML receives no viewer script (`:138`; `src/shared/render.ts:122-129`). Current SVG dispatch falls back to a rectangle for unknown node types (`src/shared/render.ts:103-110`).
- Concrete fix: record a per-format offline rule before implementation: render supported vector Board content using browserless shared code; consume verifiable locally available composites/media when present; otherwise return an actionable missing-assets/unsupported-offline-render error directing the agent to authenticated server export. Do not introduce network requests, a portable archive format or a browser installation under the existing offline command by accident. Give missing, stale and complete media inputs distinct acceptance cases, and document static GIF/poster versus interactive server-HTML behavior.

## Scope assessment and covered owners

No recommendation to remove user-requested advanced painting, all four diagram families, stickers/emoji/GIFs, MIT/self-host operation or physical iPad/Pencil verification. No material unrequested subsystem found: quota reservations, receipts, asset retention and recovery have concrete pixel-write/concurrency purposes; the plan already excludes CRDT presence, a GIF marketplace, PSD interchange and pigment-fluid simulation.

The plan explicitly accounts for v1 browser JSON import (`src/app/file-formats.ts:248-262`), generation's hardcoded v1 vocabulary (`server/providers.ts:284-286`), publication's viewer gate/full-document serialization (`server/published-html.ts:7-11`; `src/shared/render.ts:128-129`), and source-generated public docs. Docs generation bundles `documentation.tsx` and `guide.tsx` for Node SSR (`scripts/build-public-docs.mjs:17-35`); preserve that browser-free import boundary when adding capability examples. These are coverage observations, not passing runtime claims.

## Unresolved questions

The completed phase files must resolve the four decisions above. No additional user preference is required to map these consumers; any expansion into reusable Board/Paint library packaging or offline archive support must be deliberate rather than inferred.

Status: DONE_WITH_CONCERNS
Summary: Four concrete integration consumers/decisions require explicit phase coverage; requested feature scope remains intact.
Concerns: Phase files were unavailable during this pass; no runtime verification was performed or claimed.
