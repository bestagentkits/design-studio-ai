# Adopt OpenDesign patterns worth learning

Status: implemented (all five phases shipped with tests and full surface parity; issues #24–#28 closed).

Outcome: bring the OpenDesign capabilities identified as genuinely better into DesignStudioAI without weakening the versioned-document, revision-checked, multi-tenant strengths it already has. Every adopted capability keeps REST + MCP + WebMCP + `dsa` CLI parity and preserves the single validated document contract.

## Source of analysis

- OpenDesign checkout: `nexu-io/open-design` (Apache-2.0), 12,554 files. Key owners: `docs/design-systems.md`, `docs/architecture.md`, `docs/agent-adapters.md`, `apps/daemon/src/runtimes/registry.ts`, `apps/daemon/src/skills.ts`.
- DesignStudioAI owners: `src/shared/schema.ts`, `src/shared/design-systems.ts`, `server/design-systems.ts`, `server/providers.ts`, `server/security.ts`, `src/shared/motion-export.ts`, `src/app/document-view.tsx`, `src/shared/catalog.ts`, `packages/cli/src/dsa.ts`.

## What to adopt (ranked) and what to keep

Adopt:
1. Portable directory-based design systems — `DESIGN.md` + `tokens.css` + `manifest.json` authoring, compiled into the existing versioned design-system JSON.
2. Agent runtime registry + SSRF-guarded BYOK proxy — abstract agent adapters behind a registry; per-target SSRF blocking at the server boundary.
3. HyperFrames-style HTML/CSS/GSAP → deterministic MP4 motion export.
4. Manifest-driven live artifacts with a tweaks panel (re-render without reload).
5. Prompt template gallery (thumbnails, prompt body, model, aspect ratio, attribution).

Keep (do NOT regress): single validated document as source of truth, atomic revision-checked writes, three-way merge, tenant isolation, immutable publish snapshots, OAuth MCP authorization server. OpenDesign's "filesystem of raw files is the truth" model is explicitly out of scope — it is the tradeoff DesignStudioAI already avoids.

## Phase 1 — Portable design-system authoring

Map: OpenDesign `design-systems/<slug>/` package → DesignStudioAI `src/shared/design-systems.ts` + `server/design-systems.ts`.

- Add a folder-import path: `DESIGN.md` (prose), `tokens.css` (compiled custom properties), `manifest.json` (id/name/category/description/source) that compiles into the existing immutable-versioned system definition.
- Add a deterministic guard (`scripts/`) that checks prose↔token consistency (an accent/type scale/spacing named in `DESIGN.md` must exist in `tokens.css`), required token slots, and manifest-path safety — mirroring OpenDesign's `scripts/guard.ts` intent, not its exact rules.
- Expose through `dsa design-systems import/export`, MCP `design-system-tools.ts`, and the library UI.
- Keep the versioned JSON as the runtime authority; folder authoring is an ingest surface, not a second truth.

Verification: import a fixture folder → versioned system → apply to a project; guard fails on prose/token mismatch; CLI/MCP/UI all see the same system. Focused tests under `tests/`.

## Phase 2 — Agent runtime registry + SSRF-guarded BYOK proxy

Map: OpenDesign `apps/daemon/src/runtimes/registry.ts` + `/api/proxy/*` → DesignStudioAI `server/providers.ts` + `server/security.ts`.

- Introduce a runtime-adapter abstraction (launch/delivery/stream-format/model-discovery) so an external CLI agent (Claude Code, Codex, Cursor, OpenCode) can drive a text design proposal, reusing the existing brief/revision contracts.
- Add a BYOK proxy endpoint with per-target SSRF protection (reject internal IPs, link-local, CGNAT, redirects) before forwarding to configured OpenAI/Anthropic/Gemini-compatible origins — extending, not replacing, `server/provider-connections.ts`.
- Keep credential management server-side; adapter processes inherit the resolved data root, never read provider keys.

Verification: registry detects/runs a mock runtime against a real SQLite handler; SSRF policy rejects internal/link-local/redirect targets; existing provider tests stay green.

## Phase 3 — HyperFrames-style HTML→MP4 motion export

Map: OpenDesign HyperFrames + `design-templates/hyperframes/` → DesignStudioAI `src/shared/motion-export.ts` + `scripts/build-renderer.mjs` + `server/exports.ts`.

- Add an HTML/CSS/GSAP motion authoring surface that renders deterministically to MP4 via the existing trusted headless renderer + FFmpeg, capped by the current 60-second bound.
- Reuse existing asset-import and render-size limits; no arbitrary code execution (trusted template set + validated data only).

Verification: a seed HyperFrames-style template exports a real MP4; render-size and duration bounds enforced; regression test asserts an actual MP4 container/frames, not a placeholder.

## Phase 4 — Manifest-driven live artifacts with tweaks panel

Map: OpenDesign live-artifact manifest → DesignStudioAI `src/app/document-view.tsx` + `src/shared/design-capabilities.ts`.

- Add a bounded "live artifact" node kind: the agent emits a small manifest (data params + renderer id); the preview re-renders the component from the manifest without a full document reload, and surfaces editable parameters as a tweaks panel.
- Parameters remain structured, validated document data — no arbitrary scripts.

Verification: change a manifest parameter → preview updates without reload; tweaks panel round-trips through document save; unsupported params rejected by the validator.

## Phase 5 — Prompt template gallery

Map: OpenDesign `prompt-templates/` → DesignStudioAI `src/shared/catalog.ts` + `catalog-presets.ts`.

- Add a gallery of reusable generation prompts (image/motion) with thumbnail, prompt body, target model, aspect ratio, and source attribution; one click fills the composer.
- Catalog entries remain data (validated), not code.

Verification: gallery lists/filters; selecting an entry fills the brief/media composer with the correct provider/model/aspect; attribution preserved.

## Non-goals

- Replacing the validated document with a filesystem of raw HTML files.
- Dropping revision-checked writes, tenant isolation, or publish snapshots.
- Bundling OpenDesign's 151 design systems / 165 skills / 277 plugins verbatim (license + fit must be reviewed per item).
- "Refresh an existing git repo to brand" — deferred; needs folder import + agent refactor and is niche relative to the above.

## Tracking

Each phase maps to a GitHub issue (`bestagentkits/design-studio-ai`): enhancement-labeled, self-contained, with acceptance criteria. Ship one phase per PR; keep REST/MCP/WebMCP/CLI/docs synchronized in the same change per `AGENTS.md`.

## Delivery status

- **Phase 1 — portable design systems (DONE).** `src/shared/design-system-folder.ts` (compile/guard/decompile), `POST /api/design-systems/import`, `dsa design-systems import/export`, MCP `import_design_system_folder`, WebMCP `studio_api_post_design_systems_import` (from `api-reference.ts`), folder-import UI in `design-system-library.tsx`, skill + docs parity. Tests: `tests/design-system-folder.test.ts`.
- **Phase 2 — SSRF guard + client-side adapter (DONE).** `server/ssrf.ts` blocks loopback/private/link-local/CGNAT/reserved literals in `allowedProviderBase` (`tests/ssrf.test.ts`). Server-side CLI spawning was rejected per the product brief; the runtime-registry became `dsa mcp install <agent>` (`packages/cli/src/mcp-{config,commands}.ts`) — prints the MCP config snippet by default, `--write` persists with `.bak` backup and no-clobber merge (`tests/mcp-install.test.ts`).
- **Phase 3 — motion primitives (DONE, re-scoped).** Raw HTML/CSS/GSAP authoring was rejected per the no-arbitrary-code product brief; the adoptable technique landed as validated motion primitives (`src/shared/motion-templates.ts`) compiling reveal/stagger/kinetic-type/chart-race to timeline keyframes through the existing `timelineSchema`/`motion-export.ts`, restricted to `interpolateNode`-supported keys. `dsa motion-template list/instantiate`. Tests: `tests/motion-templates.test.ts`.
- **Phase 4 — live artifacts (DONE).** Validated `node.data.live` manifest (`src/shared/live-artifact.ts`) renders deterministically in `document-view.tsx` via `LiveArtifactView`; the inspector tweaks params through the existing `update-node` operation. Tests: `tests/live-artifact.test.ts`.
- **Phase 5 — prompt gallery (DONE).** `src/shared/prompt-templates.ts`, `/api/catalog` `prompts`, MCP `list/get_prompt_templates`, `dsa prompts list/get` + `dsa catalog`, gallery selector that fills the media composer in `editor.tsx`, skill + docs parity. Tests: `tests/prompt-templates.test.ts`.

Pre-existing failures in this environment (Node v22.20.0 vs required ≥24) affect `tests/cli.test.ts` ("real SQLite project edits…" and "asset clone…"); both fail identically on the clean HEAD and are unrelated to these changes.
