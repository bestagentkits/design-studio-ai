# Public documentation and beginner guide

The public documentation portal lives at `/docs`; the visual beginner guide lives at `/guide`. The REST page includes an interactive playground: a user can enter an API key held in page memory, or use their signed-in session, and explicitly execute real API requests. Provider operations may incur usage and writes affect the selected project. Passive page viewing and the build process do not make those requests. The playground accepts query parameters, uploads real files using multipart form data, and downloads binary responses. Its copyable curl example reflects those request formats. API-key management links to the existing signed-in `/?settings=agents` workflow.

## Owning content and routes

[documentation.tsx](../src/app/documentation.tsx) owns the human-readable endpoint reference, CLI command table, prose, search index, and documentation sections. [api-reference.ts](../src/shared/api-reference.ts) owns the typed operations used by the playground, OpenAPI and browser API tools; server routes and validators remain the behavioral authority. Keep both references aligned when a contract changes. [guide.tsx](../src/app/guide.tsx) owns beginner workflow explanations, selectable starter briefs, real workspace screenshots, and FAQs. Both use the [shared workspace navigation](../src/app/public-navigation.tsx) so readers can return to their work without navigating through the homepage. Documentation contents have a separate collapse control. Both use the shared theme control and CSS variables, preserve keyboard navigation, and report clipboard success only after the browser confirms it.

Canonical documentation routes are `/docs`, `/docs/revisions`, `/docs/3d`, `/docs/api`, `/docs/cli`, `/docs/mcp`, `/docs/webmcp`, `/docs/api-keys`, and `/docs/self-hosting`. Real links support direct loading and crawler discovery; client navigation also preserves history. Legacy section hashes remain readable. Connection examples use the current browser origin so a self-hosted workspace does not send users to the public service by accident.

The API reference includes public schema/catalog, account/GitHub auth, projects/revisions, persisted interviews/scopes, design preflight, media/assets, conversations, exports/publishing, and credential management. Machine schemas remain authoritative at `/api/schema`; the template/theme/block catalog is at `/api/catalog`. [api-reference.ts](../src/shared/api-reference.ts) owns the playground operations and `/api/openapi` index, including design-system versions, font/model discovery and multipart uploads. WebMCP combines editor tools with [browser-design-tools.ts](../src/app/browser-design-tools.ts); discover supported tools at runtime. Copyable examples contain placeholders and environment references, never real secrets.

## Workspace destinations and activity

The [workspace navigation owner](../src/app/workspace-navigation.ts) defines direct `/templates`, `/design-systems`, and `/activity` destinations on the configured origin. Template and design-system navigation opens a browsing view; loading a link does not create a project or apply a library. Design systems retain their owner authorization when reached directly. Authentication preserves the requested destination; navigation does not grant access to another owner's library.

[Screen state](../src/app/screen-state.ts) owns URL-backed editor destinations for browser history and direct links. Keep URLs limited to identifiers and UI choices; they must not carry draft content or credentials. Public slide viewers use hash parameters to preserve their opaque sandbox. The [editor](../src/app/editor.tsx) owns unsaved-change protection, while [project thumbnails](../src/app/project-thumbnail.tsx) capture saved content; a thumbnail is not evidence that an unsaved edit was persisted.

Activity URLs preserve the selected time window and authorized filters in the query string; `trace` opens the selected trace. A copied URL conveys navigation state, never authorization. Document the [shared filter contract](../src/shared/observability.ts) through the typed API reference so browser tools, REST examples, and generated discovery remain aligned. Operator-only global activity is distinct from ordinary owner-scoped access; see [agent access](agents.md#activity-usage-and-traces).

## HTML, Markdown, and agent discovery

Run [build-public-docs.mjs](../scripts/build-public-docs.mjs) **after Vite builds**. The script bundles the content for Node rendering with React's server renderer; it uses SSR-safe browser guards and does not mock browser globals. It preserves the built shell's module scripts, global styles, and early theme initialization, then injects real semantic page content. Per-route titles, descriptions, canonical/Open Graph metadata, and structured data describe the actual page.

Generated artifacts live in `dist`:

- Public HTML pages for the homepage, guide, and sections exported by the documentation source.
- Markdown counterparts: `/docs.md`, `/guide.md`, `/docs/index.md`, and `/docs/<section>.md` (the overview is `/docs/quickstart.md`). REST Markdown is generated directly from the typed endpoint definitions; other references use the same rendered content as their pages.
- `/llms.txt` with a curated categorized index, and `/llms-full.txt` with expanded inline documentation.
- `/sitemap.xml` with the public page URLs. It never enumerates accounts, private projects/assets, API keys, or publications.
- `/robots.txt` directing crawlers away from auth/account/project/provider/token/MCP/publication paths. This complements authorization; it is not access control.

The canonical build origin is `PUBLIC_SITE_URL`, then `APP_URL`, then `https://studio.agentkit.best`. Set it explicitly for a different public deployment. Docker Compose passes `APP_URL` as the build origin; direct Docker builds accept `--build-arg PUBLIC_SITE_URL=https://your-studio.example`. It accepts an HTTP(S) origin without embedded credentials. No arbitrary environment-file contents are copied to generated output. Real guide screenshots are maintained in `public/guide/assets` and copied into the build by Vite.

The HTTP adapter must serve directory indexes for `/docs`, each reference route, and `/guide`, rather than fall back to the homepage shell. It must serve Markdown/text/XML with their proper MIME types. Optional `Accept: text/markdown` negotiation is owned by the server, not this UI. The build process does not execute authenticated or paid API requests.

## Verification and boundaries

The durable public browser checks are in [public-docs.spec.ts](../tests/public-docs.spec.ts): HTML/metadata/MIME/Markdown discovery, no-JavaScript navigation, responsive layout, clipboard/search/history/theme, and guide controls. They use public resources without accounts or provider calls.

The [browser configuration](../playwright.config.ts) currently exercises Chromium desktop and mobile viewports. Mobile-first usability and cross-browser compatibility remain design requirements; these checks alone do not prove Firefox, Safari, or real-device coverage.

The portal supports searchable section navigation, endpoint filtering, native expandable endpoint details, selectable/copyable examples, keyboard-accessible scrollable tables, mobile navigation, light/dark theme controls, and direct section URLs. The guide follows the implemented persisted interview: contextual questions, saved answers, editable scope, explicit approval, and a separate first-draft generation action. It also explains manual scope/editor paths, refinement, preview, design-check limitations, output selection, publication, and agent connection. Brief revisions are independent of document revisions; every brief edit invalidates approval.

Public content is present in HTML before JavaScript runs; JavaScript enables search/copy/navigation behavior. Without JavaScript, navigation remains visible and copy-only controls are hidden. Templates/manual editing do not require BYOK; generation does. Provider/Google verification, experimental WebMCP, encoder limitations, and format fidelity boundaries remain explicitly documented.

See [web-documentation verification](https://github.com/bestagentkits/design-studio-ai/blob/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/2026-09-07-bootstrap-design-studio-ai/reports/web-documentation.md) for the observed checks. Serving/deployment validation is distinct from successful local rendering.
