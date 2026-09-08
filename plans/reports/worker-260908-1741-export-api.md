# Authenticated source and scene exports

Status: DONE

## Implemented

- REST export accepts `react`, `glb`, `gltf`; React returns `.zip` with application/zip, GLB/glTF return their actual standard MIME types and bytes.
- React calls the shared source archive builder with the trusted generated runtime manifest. Web/wireframe only; no Chromium dependency on this branch.
- GLB/glTF use the shared scene exporter inside the existing network-isolated browser; require a selected-page model3d node.
- Assets embedded through cached owner-scoped storage reads, including scene texture references in the asset registry. Existing project validation, optional revision check, rate limit, no-store headers, resource limits and browser cleanup retained. External cloud-rendered textures rejected before launch.
- MCP export_project supports all three formats as base64 resources, React URI ends `.zip`, and optional expectedRevision now forwards to REST.
- CLI export allowlist/help supports all three, requires output files for React/GLB, supports glTF as JSON text.
- User explicitly approved the source patches previously rejected by the privacy hook. Ordinary context-binding refactor allowed authorized edits; no secret files read or hooks disabled.

## Evidence

- `node scripts/build-renderer.mjs`: passed.
- `npm run typecheck`: final repeat passed after concurrent design-system test owner corrected its typing.
- `npm run build:cli`: passed.
- `npx tsx --test tests/export.test.ts tests/security-boundaries.test.ts tests/cli.test.ts`: 18 passed.
- `npx tsx --test tests/exports-agent-formats.test.ts`: 2 passed. Actual isolated SQLite, real uploaded PNG, API token authentication, real headless renderer.
- Route React ZIP includes actual component source and exact uploaded media bytes with portable document asset paths.
- Route GLB header/length and glTF embedded buffer inspected, then both loaded through GLTFLoader. Texture, red material, roughness 0.7, animation clip and 45-degree midpoint rotation retained.
- All three formats exported through actual MCP SDK route and built CLI subprocesses; decoded/downloaded files inspected.
- Stale revision rejected409; unsupported project format rejected400; anonymous rejected401; different owner rejected404.
- `git diff --check`: passed.
- Tests close browser processes, isolated port0 HTTP server and database; temporary files removed. No use of port8791.

## Limits and handoff

- Cloudflare Puppeteer production runtime not live-tested; local Playwright adapter exercises shared route and encoder.
- React output is a frontend prototype; existing React ZIP build regression owns production Vite compilation.
- Parent owns final full test/build, docs synchronization and review. Architecture browser-only/pending statements are obsolete after this patch.
- Supersedes prior export-runtime report's privacy-blocked follow-up section. No export implementation remains blocked.

Unresolved questions: none.

## Google Fonts cloud integration

- Server fetches only the shared generated Google CSS URL. Redirects rejected manually; fixed HTTPS fonts.gstatic.com origin and font extensions required. Bounds: 15-second overall deadline, 128 KB CSS, 2 MB per font, 10 MB aggregate, 128 font files.
- CSS font URLs become data URLs. Style marker matches shared font loader; isolated renderer loads embedded faces without external network access. Local Arial/Georgia/default stacks perform no fetch. Unavailable selected Google fonts produce explicit font_load_failed.
- Transport boundary test rejects redirects, foreign hosts and oversized CSS.
- Live official Roboto fetch succeeded: one face, 165144 bytes embedded CSS. Real renderer using that CSS produced PNG61598 bytes; document.fonts.check reported true and browser external request count was zero. Browser closed afterward.
- Final renderer build, new focused tests2/2, typecheck and diff whitespace check passed.
