# Public docs and guide verification

Status: In progress, 2026-09-08. Content/UI/generation and local integrated HTTP checks completed; final current-source browser suite and production checks are controller-owned gates.

## Implemented surfaces

- `DocsApp` at `/docs` and seven direct reference routes, with search, typed endpoint data, CLI flags, copy controls, revisions/errors, MCP/OAuth, current eight browser tools, existing API-key management links, and self-hosting guidance.
- `GuideApp` at `/guide`, covering template/blank selection, persisted interviews, editable scope, explicit approval, separate first generation, scoped refinements, real editor screenshots, quality checks, export/publication, and agent connection.
- Shared appearance controls and scoped CSS; current-origin connection examples; no credential input or authenticated/paid requests from either page.
- Build-time React SSR into the existing built shell, preserving scripts/early theme and adding page metadata, Markdown counterparts, llms files, sitemap, robots, and guide assets.

## Observed checks

`npm run typecheck` passed after DocsApp/GuideApp and shared ThemeToggle integration. `npm run build` passed with documentation and guide split into separate chunks. `node scripts/build-public-docs.mjs` generated ten public HTML pages, eleven Markdown files, llms indexes, sitemap, and robots without mocked browser globals.

A real Chromium run at 1440×1000 and 390×844 passed: docs and API viewport fit, global search to a direct `/docs/api` URL, current-origin command copy, keyboard opening of a native endpoint accordion, light/dark theme switching, guide viewport fit, starter-brief selection and confirmed clipboard content, and real screenshot asset loading. No page errors occurred. Screenshots were inspected; a dark-mode mobile navigation-icon contrast issue was found and fixed explicitly.

Artifacts: [desktop guide](guide-desktop.png), [mobile guide](guide-mobile.png), [mobile dark docs](docs-mobile-dark.png), [desktop dark docs](docs-desktop-dark.png). The mobile dark screenshot was refreshed after the navigation-icon contrast correction; desktop dark screenshots are earlier layout observations.

Endpoint/method/auth/envelope claims were read from the owning server modules, including new GitHub-login and schema/catalog routes. CLI flags were read from its source. MCP discovery/auth/tool/resource behavior was read from `server/mcp.ts` and `server/oauth.ts`; WebMCP names/payloads from the editor. Generated REST Markdown uses the same endpoint definitions as the UI.

## Integrated HTTP checks and durable coverage

The actual Node static adapter served all ten public HTML pages with headings, metadata, scripts, and theme bootstrap. Markdown/text/XML MIME checks passed. A short-lived real Hono HTTP server on port 8792 passed Chromium no-JavaScript navigation, endpoint expansion, six guide anchors, and mobile viewport fit, then closed in a finally block. Generated canonical/structured data uniqueness, ten public-only sitemap entries, llms structure, and structured API Markdown checks passed.

Added `tests/public-docs.spec.ts` with four tests per desktop/mobile project for durable HTML/metadata/MIME/Markdown, no-JavaScript reading/navigation, search/copy/keyboard/theme/history, and guide controls. The controller will run this suite in the final isolated harness after a fresh build; it has not yet passed as a tracked suite. Typecheck passed after its addition. No provider calls or fabricated API success responses were used.

Latest reference changes cover four brief routes, independent brief CAS/approval, design-check output and limitations, CLI brief/check commands, network MCP counterparts, and eight browser tools. The guide describes the actual frontend labels confirmed from the implementation owner and source. CLI links target the controller’s upcoming v0.2.0 release; publication verification remains with the controller. The generator now resolves guide Markdown fragments to /guide, emits its heading first, and loads only each public page’s scoped stylesheet alongside the base shell styles.

Vite process PID 2624 on port 5173 was launched through tool session 37879 for verification. Its shutdown is recorded below. The short-lived integrated HTTP server on port 8792 was closed after its checks. No persistent API server was started by this task.

Process cleanup: Vite session 37879 was stopped with Ctrl+C; a listener check confirmed no processes on 5173 or 8792. Final source typecheck and scoped diff whitespace check passed. The controller owns the subsequent full build, isolated browser suite, release publication, and production validation.
