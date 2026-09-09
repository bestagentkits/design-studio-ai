# Design guidance, deep links, and documentation

Priority P1. Guidance/docs owner plus parent integration. Read `skills/design-studio-ai/SKILL.md`, `src/shared/catalog.ts`, `schema.ts`, `src/app/app.tsx`, `design-system-library.tsx`, `documentation.tsx`, `guide.tsx`, `docs/web-documentation.md` and API/CLI owners.

## Implementation

- [x] Add references for every real kind: web, slides, report, wireframe, 3d, video. Each covers layout, hierarchy, typography, spacing, suitable interaction/scene/timeline choices, tasteful restraint, common failures, concrete review checklist and real export limitations. Preserve user content/brand choices; label aesthetic guidance as judgment rather than schema law.
- [x] Route the skill to the relevant reference before creation/refinement; reference actual supported fields/tools, templates/design systems and design checks. Include all referenced files in skill packaging. If guidance is exposed through runtime retrieval, publish one canonical source and synchronize REST/MCP/CLI/WebMCP access rather than copying prose independently.
- [x] Add stable direct URLs for Templates and Design Systems views; optionally selected template/system when meaningful and safe. Centralize parsing/building route state; reload, back/forward and authentication preserve destination. View routes do not introduce selected-resource IDs; existing project/system APIs retain ownership checks. Unknown workspace paths use the existing projects fallback. Navigation never creates projects or applies a system merely by loading a link.
- [x] Parent integrates route changes with dashboard navigation without competing app.tsx writers. Use relative workspace navigation URLs resolved against the current origin, so copied browser URLs work for self-hosted users without hard-coded hosted origins.
- [x] Optimize the user's supplied screenshots for README: identify actual source files from parent handoff, preserve original quality and useful visual content, create appropriately sized compressed repo assets, meaningful alt text and local GitHub-renderable links. Do not substitute old workspace screenshots for supplied images. Verify dimensions/file size and visually inspect final assets.
- [x] Synchronize new behavior/config/API with smallest owning docs plus public references and skill. Update source and rebuild generated HTML/Markdown/OpenAPI/llms; don't hand-edit dist or renderer bundles.

## Exact sync owners

| Surface | Owner |
| --- | --- |
| REST/service/schema | `server/index.ts`, new observability routes, shared contract, existing project/design-system services |
| OpenAPI/playground + generic WebMCP discovery | `src/shared/api-reference.ts` |
| Human public reference/search/CLI tables | `src/app/documentation.tsx` |
| Beginner workflow/screenshots | `src/app/guide.tsx`, `public/guide/assets/` when relevant |
| Network MCP | `server/mcp.ts`, `server/design-system-tools.ts` where affected |
| CLI | `packages/cli/src/dsa.ts`, `client.ts`, `design-system-commands.ts` where affected, CLI README |
| Browser WebMCP | `src/app/browser-design-tools.ts`, `editor.tsx` registrations; ensure operator endpoint exclusion |
| Agent skill | `skills/design-studio-ai/SKILL.md`, new `references/*.md`, actual ZIP packaging owner |
| Durable guides | `docs/architecture.md`, `deployment.md`, `agents.md`, `providers.md`, `web-documentation.md` as affected |
| Derived discovery | `scripts/build-public-docs.mjs` emits `dist/llms*.txt`, docs Markdown/HTML/sitemap after Vite |

## Validation

- [x] Every supported kind has linked useful reference, correct schema terms, no nonexistent tool claims; package includes files.
- [x] View deep links verify initial navigation, reload, browser back and no project creation. Relative anchors preserve normal keyboard/modifier navigation; ownership remains server-enforced.
- [ ] Full logout/login/forward/mobile-keyboard combination matrix. Selected template/system ID links were optional and are not introduced; do not claim selected-ID recovery was tested.
- [x] CLI help/subprocess tests, MCP tools/resources tests and `agent-capability-parity.test.ts` verify new public observability contracts; operators remain explicitly authorized.
- [x] Built public docs pass `public-docs.spec.ts`: four cases per desktop/mobile viewport cover real public HTML/agent references, no-JavaScript content, search/copy/history and guide disclosure. Source links and screenshot dimensions/size/visual output checked locally.
- [ ] Final hosted GitHub README rendering; local GitHub-compatible Markdown and visually checked image files are verified, not the remote rendered page.

Risk/rollback: no secret/private telemetry in docs screenshots or assets. All four exact supplied source images were inspected and used; no guessed substitutes. README remains concise, detailed capability guidance lives in owning docs.

## Acceptance reconciliation — 2026-09-09

Status: guidance, assets, deep-link views and documentation implementation complete. See [acceptance evidence](reports/acceptance.md).

- [Guidance/assets report](../reports/docs-manager-260909-0959-guidance-assets.md) records source/schema inspection, exact source-image mapping, visual checks, dimensions and compression (3,697,007 to 542,124 bytes).
- `scripts/package-skill.mjs` recursively packages the skill entrypoint and seven reference files; controller repackaged after the final app build. ZIP publication is phase 5.
- Prior trace-lookback concern is resolved by `--days` and matching MCP/browser trace parameters, verified in [real-client parity](../reports/tester-260909-observability-parity.md).
- Owning docs, public React API reference, generated schemas/OpenAPI and llms output were synchronized. Final public-doc checks passed four cases each for desktop and mobile; no claim about a deployed remote page is implied.
