# Public documentation, beginner guide, and agent discovery

Status: Implemented and verified on 2026-09-08. Owner: documentation agent for content/UI/build artifacts; controller for app mounting, build wiring, HTTP serving, and deployment.

## Scope and ownership

User-added scope: public in-web API/CLI/MCP/WebMCP/key-management documentation, a visual beginner guide, and crawlable HTML/Markdown/llms/sitemap surfaces. Read the actual server/editor/CLI contracts, [web-documentation ownership](../../docs/web-documentation.md), and [architecture](../../docs/architecture.md). Public browser regression tests belong to `tests/public-docs.spec.ts`. Content belongs to `src/app/documentation.tsx`, `src/app/guide.tsx`, their scoped CSS, and `scripts/build-public-docs.mjs`; controller owns route integration and root configuration.

## Acceptance

- [x] Public docs sections cover quickstart, revisions, actual REST endpoints, CLI flags, network MCP/OAuth, the current eight WebMCP tools, key management, and self-hosting.
- [x] Search/filter, copy confirmation, real section URLs, keyboard endpoint details, and mobile layout implemented.
- [x] Beginner guide has real screenshots, brief examples, honest conversation/refinement workflow, preview/quality checks, export/publication, and agent connections.
- [x] SSR renders meaningful HTML from the actual components, preserving the built scripts/theme setup. Markdown and llms references derive from the same content; sitemap contains public pages only.
- [x] Local desktop/mobile interaction checks and typecheck/build passed; light/dark controls and screenshot loading checked.
- [x] Verified no-JavaScript HTML, MIME types, direct section/Markdown routes, sitemap/llms links against the integrated HTTP adapter. Optional content negotiation remains a controller-owned enhancement.
- [x] Persisted brief/scope/approval, preflight REST/CLI/MCP, and current browser tools are documented from source.
- [x] Added durable public browser tests for desktop/mobile, no-JavaScript, metadata/MIME/Markdown, search/copy/theme/history, and guide controls.
- [x] Controller runs the new public-docs suite in the final isolated per-device E2E harness.
- [x] Re-run affected final build/typecheck/tests and production docs/guide checks after controller integration.

## Risks and rollback

Avoid duplicated schema authority, claims of unimplemented onboarding, stale client-specific MCP configuration, credentials in examples, and private URLs in discovery files. The builder uses static public content only. A UI build does not establish that an HTTP adapter serves directory indexes or Markdown correctly; verify those separately. Roll back static UI/content without touching accounts, credentials, or project data.

Evidence: [web-documentation report](reports/web-documentation.md).
