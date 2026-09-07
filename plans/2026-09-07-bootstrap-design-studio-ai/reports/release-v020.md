# v0.2.0 verification

Verified 2026-09-08. GitHub publication and Linux CI are pending the final release steps; the application is deployed and the checks below are observed, not planned.

## Delivered behavior

- Real GitHub OAuth login and explicit identity linking, browser-bound state, S256 PKCE, single-use callback state, secure existing sessions, and no automatic email-based merge. The configured live browser completed authorization, callback, logout, and relogin; the same session remained signed in after the final deployment. No identity details or credentials are recorded here.
- Contextual interviews persist questions, answers and a reviewed scope. Every change invalidates approval. Independent brief revisions protect both browser and external-agent edits. Approval, generation, saving, and publication remain distinct actions.
- A shared deterministic design inspection returns actionable page/node references through the editor, REST, MCP, WebMCP and CLI. Browser inspection includes unsaved work. Findings are bounded and do not claim aesthetic scoring or accessibility certification.
- System/light/dark appearance, responsive controls, keyboard navigation, project URL restoration, and recoverable errors. The original request and model cannot be changed while their pending save response would overwrite them.
- Public documentation and visual guide, ten rendered HTML pages, eleven Markdown files, llms indexes, public-only sitemap, structured metadata, and true unknown-route 404s. Docker builds use the configured public origin. Guide images come from the maintained public asset directory.

## Local and deployment evidence

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed application and CLI contracts |
| `npm test` | 70 passed, zero failures/skips; real SQLite, HTTP, SDK, renderer and format checks |
| `npm run test:e2e` | 7 desktop + 7 mobile passed on separate disposable databases; includes real delayed-response save test, auth/key revocation, interview approval/reload, docs without JavaScript, theme/search/copy, library/editor/publish/PNG export |
| `npm run deploy` | Build and Cloudflare deployment succeeded; Worker `3f6a5d61-7525-4a0c-9efd-912e39491746` on `studio.agentkit.best` |
| Cloudflare smoke | 21 passed: D1 persistence/revisions/messages/briefs, SDK MCP initialization and approval/inspection, discovery resources, anonymous publications, PNG/PDF/PPTX/3D/WebM exports |
| Cloud video inspection | ffprobe decoded VP9, 1280×720, four frames from the short verification recording |
| Docker build | Image `design-studio-ai:0.2.0`, digest `sha256:25232c17156235f2d6cb11d052dbc9570607892c0467d6893b1ad20cd502fda1` built successfully |
| Docker smoke | Same 21 checks passed against real SQLite/files/headless Chromium on local port 8788; public canonical/llms/sitemap used that origin, unknown path returned 404 |
| CLI archive | Extracted `bestagentkits-design-studio-ai-0.2.0.tgz` prints `0.2.0` and includes get/put/interview/approve commands; eight CLI integration/packaging tests passed in the 70-test suite |
| Live browser | Latest workspace and guide load, System/Dark selection persists across navigation, existing GitHub session remains authenticated |

The E2E harness now waits for its own server's listening signal as well as health, and gives each device a fresh rate-limit bucket instead of relaxing production limits. An earlier overlapping review server invalidated one run; only the subsequent clean 14/14 run is counted. A stale locator was scoped to the Settings dialog after the account button gained an accessible name.

Cloud smoke accounts, projects and temporary keys were removed. The real GitHub account was preserved. The disposable Docker container used tmpfs and was stopped/removed; test and review listeners were closed.

## Performance and review

The production entry bundle is 63.95 kB gzip; the workspace is loaded separately at 68.51 kB gzip. Documentation is 18.61 kB gzip and the guide 6.40 kB gzip. The 159.39 kB gzip Three.js scene and 123.20 kB gzip PowerPoint modules are lazy-loaded. These are build measurements, not a synthetic Lighthouse score or a network-latency guarantee. Public pages contain meaningful content before JavaScript executes.

Direct [Claude Design exploration](claude-design-observation.md) informed contextual questions, explicit scope, simple/progressive editing controls, and theme tweaks. [Authentication/brief review](auth-brief-review.md) and [onboarding review](onboarding-quality-review.md) found and resolved the object-property question-ID bug and pending-request edit race. Actual Cloudflare execution exposed unsupported `redirect: 'error'`; GitHub and provider transports now use `manual` and reject non-success responses without forwarding credentials.

## Boundaries

Live AI-provider generation and Google Slides authorization need credentials not present in this environment; configuration/error paths were verified without fabricating success. Native WebMCP remains experimental. PowerPoint preserves supported native text/shapes while rasterizing complex content; Google Slides rejects unsupported nodes explicitly. MP4 depends on runtime codec support; WebM was verified. No claim of full Claude Design/After Effects/Three.js Editor parity is made.

The current dependency audit still reports five upstream high findings through browser-downloader ZIP extraction and PowerPoint image parsing. The downloader path is unused at Cloudflare runtime and PowerPoint raster inputs are application-generated PNGs. These findings remain disclosed in [deployment security](../../../docs/deployment.md#dependency-security); the dependency tree is not audit-clean. npm registry publication is unavailable; the release distributes a directly installable CLI archive and agent skill ZIP.
