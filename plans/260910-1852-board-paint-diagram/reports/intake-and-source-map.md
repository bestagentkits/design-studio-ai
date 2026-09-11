# Intake and source map

Date: 2026-09-10. Baseline: `3545d18`, detached HEAD, initially clean working tree.
This session delivers an implementation plan only. No implementation, dependency installation, benchmark, account operation, commit, or deployment is authorized by the planning request.

## Confirmed user decisions

- Drawing tools: brush, pen, ink, coloring, with advanced painting including texture, color mixing and multiple paint layers.
- Elements: stickers, emoji and GIFs.
- Diagram tools: connectors and equally important flowcharts, architecture diagrams, user flows and mind maps.
- tldraw is a feature/interaction quality reference only; prioritize MIT/self-host. Do not select a paid tldraw SDK as a fallback without a new explicit user decision.
- Excalidraw is the diagram interaction quality reference and a candidate MIT engine, not an already approved or proven integration.
- Reference devices: desktop and physical iPad/Apple Pencil. Phones must support basic viewing, selection, insertion, editing and navigation; mobile emulation does not establish stylus quality.
- Keep earlier advanced-paint requirements. Referencing tldraw did not cancel texture, mixing or paint layers.

## Outcome contract

Deliver a coherent Board workflow inside Design Studio AI with Draw, Diagram and Elements, plus a focused Paint workspace. People and agents must edit the same structured content. Board/artwork can appear in existing design pages and reopen for editing. Save, reload, undo, conflict handling, clone, publish and supported exports must preserve their documented semantics.

Constraints: one canonical server-validated document contract across UI/REST/MCP/WebMCP/CLI; existing owner and OAuth boundaries; distinct brief and document revisions; immutable published snapshots; current v1 documents remain readable; browser/device support verified rather than inferred. Self-host must not require a commercial SDK activation service. Preserve the encryption key and deployed data.

Non-goals: replace the existing web/component or 3D editor; purchase SDK licenses; clone every feature of either reference product; add real-time presence/CRDT collaboration solely because an SDK demo has it; add a third-party GIF marketplace contract by assumption; physically simulate pigment chemistry or add PSD interchange without a separate request. Real smudge/color mixing, texture and layers remain in scope.

Acceptance: the requirement matrix and measured device workloads will cover draw/selection/history quality, all four diagram workflows, actual paint mixing/layers, all three Elements types, cross-surface edits, persistence/asset isolation and inspected exports. None are currently verified.

## Verified owning surfaces

| Concern | Existing source | Implication |
| --- | --- | --- |
| Types and limits | `src/shared/schema.ts:4`, `:22`, `:34`, `:36`, `:68` | Six project kinds; literal schema v1; no board, path, connector or paint content. Plan version compatibility explicitly. |
| Shared mutations | `src/shared/operations.ts:9`, `:30`, `:50` | Existing operations and maximum 100 operations/batch; extend shared validators, not client-specific formats. |
| Browser edit/history | `src/app/editor.tsx:315`, `:369`, `:422`, `:447`, `:482` | Full-document snapshots and remote rebase. A high-frequency SDK/brush loop cannot feed this on every pointer sample. |
| Gesture ownership | `src/app/canvas-gestures.ts` | Current editor installs capture-phase pointer listeners. Only one active surface may own a gesture. |
| Browser agent tools | `src/app/browser-design-tools.ts:11` | Local operations and saved-state API tools have different semantics; document and test the distinction. |
| CLI validators | `packages/cli/src/dsa.ts:36`, `:39`, `:134` | CLI imports shared schemas and has browserless HTML/SVG rendering. Update both discovery and offline behavior. |
| Network MCP | `server/mcp.ts:22`, `:79`, `:98` | Owner-scoped API dispatch and shared operations; add semantic helpers only through common services. |
| Generation | `server/providers.ts:284` | Hardcoded v1/node vocabulary must be updated with new capabilities without destroying existing structured content. |
| Browser targets | `playwright.config.ts:21` | Desktop/mobile Chromium default; Firefox/WebKit opt in via `STUDIO_CROSS_BROWSER=1`. |
| E2E lifecycle | `scripts/run-e2e.mjs:7`, `:20` | Default runner explicitly executes desktop/mobile. Cross-browser runs require explicit project selection. Port 8791 is reserved/probed; each run gets isolated data. |
| CI | `.github/workflows/ci.yml` | Node 24, both dependency trees, CLI build, typecheck, tests, build, skill packaging and E2E; deployment is a later distinct state. |
| Public documentation | `docs/web-documentation.md` | Edit `src/app/documentation.tsx`, `guide.tsx`, `src/shared/api-reference.ts`, docs and skill; build generates dist docs and llms indexes. |

Source links are repository-relative identifiers with line evidence, not assertions that proposed files already exist. Implementation must refresh baseline before edits.

## Planning choices to make executable

1. Excalidraw-first integration spike; alternative is a native implementation using permissively licensed geometry/freehand/layout libraries. Retain quality scope if the candidate fails. Do not replace a failed test with a lower acceptance target.
2. Test canonical-to-engine-to-canonical round trips, gesture ownership, history, animated elements, paint overlays and browserless rendering before locking the engine.
3. Separate existing finite design pages from unbounded-feeling Board navigation. Every export requires finite content/artboard bounds.
4. Adopt explicit schema upgrade/downgrade behavior. A v1 client must never silently strip new content from an upgraded project.
5. Use typed asset IDs and a common traversal/remapping owner for every new nested reference. Paint data must not be hidden base64 in the document or one design node per brush dab.
6. Treat paint layer revisions, committed raster content, derived composites and undo retention as a storage lifecycle, not only a rendering feature.
7. Every feature slice carries its validators, agent access, documentation and focused tests. The final phase verifies integration; it does not defer all AX/docs work until the end.

## Tooling status

`ak plan --help` and `ak config prefs resolve --json` returned `command not found: ak`. Author plan files directly; durable checklists are the task state. No callable task CRUD surface was discovered among current tools (Codex task creation is not a substitute).
Initial researcher-role dispatch failed because its configured `gpt-5.4` model is unsupported by this account. Research was reassigned to the inherited model; no product files were touched by those failed dispatches.

## Unresolved product questions

None needed to author the plan. Engine fit, device performance and asset/renderer budgets are explicit implementation evidence gates, not user approval inferred from silence.
