# Finalization evidence — 2026-09-07

Status: In progress; controller release verification remains active. This report records observations, not a substitute for executable contracts or an assertion that every requested criterion passed.

## Observed and reported verification

| Area | Evidence | State |
| --- | --- | --- |
| CLI distribution | Seven real subprocess/SQLite CLI tests passed during CLI delivery; built tarball extracted and executable ran without the repository runtime | Verified for that revision; latest media flags need final integrated run |
| Provider capabilities | Six `provider-capabilities.test.ts` tests passed; source requests, owned-source isolation, missing credentials, unsafe locations, and stored completed jobs checked | Verified locally; no live paid-provider success claimed |
| Server/CLI regression | `node --import tsx --test tests/server.test.ts tests/cli.test.ts` passed 16 reported tests including nested server checks | Verified before final conversations/viewer updates |
| Integrated checks | Controller reported `npm test` 42/42 and typecheck passing, including TypeScript renderer scripts; four additional viewer regressions then passed | Final combined run expected to contain 46 tests; not yet reported |
| Cloudflare | Controller reported deployed custom domain, D1/R2 and Browser Rendering bindings, then 11 passing production checks including registration, persisted revisions/conflict, authenticated MCP, immutable publication, PNG/PDF/PPTX | Production checks passed; later deployments require fresh reconciliation |
| Docker | Controller built a real image on Docker Engine 29.7.2 and passed 16 checks: sessions, SQLite saves/CAS/messages, MCP, publish, PNG/PDF/PPTX, real 3D PNG, WebM, interactive HTML; test container stopped/removed | Verified self-host runtime and exports |
| Browser workflows | Controller reported fresh isolated desktop/mobile E2E 2/2; runner uses temporary SQLite, deterministic port 8791, and cleanup | Passed for current UI |
| Registry/release | CLI tarball exists; npm authentication returned 401; GitHub v0.1.0 release is planned | Registry unpublished; release asset unverified |

The controller's observed deployment used D1 `920d59d1-d4e9-4e8b-b01b-9dbf45a180aa`, R2 `design-studio-ai-assets`, and [studio.agentkit.best](https://studio.agentkit.best). A deployment version beginning `6bbdc` was reported before subsequent work; the final release must record its actual final version rather than treating that earlier version as current.

## Documentation reconciliation

Created [README](../../../README.md) and [deployment](../../../docs/deployment.md). Replaced the bootstrap schema copy in [architecture](../../../docs/architecture.md) with links to machine-owned validators, operations, routes, and rendering boundaries. Updated [agents](../../../docs/agents.md), the [CLI README](../../../packages/cli/README.md), and [agent skill](../../../skills/design-studio-ai/SKILL.md) for current media flags and cloud export behavior. Swept all four phase files and kept overall status in progress.

Claims were checked against package scripts, CLI command definitions, Dockerfile/Compose, Wrangler bindings, Node entry/migration handling, export/provider/Google/MCP/conversation routes, shared rendering, and the isolated E2E runner. No changelog was added: release observations belong here, while evergreen documentation points to owning code.

Relative Markdown link validation checked 83 local links across the changed documentation and phase files with zero missing targets. The CI workflow was inspected and matches the documented dependency installation, typecheck/test/build/E2E/pack sequence. Production and latest full-suite results are controller-reported evidence; this documentation task did not independently rerun paid providers or production writes.

## Remaining release gates and disclosed limitations

- Final combined test/build/typecheck reconciliation, expanded production smoke, and remote GitHub CI. The earlier 42-test suite, additional four viewer regressions, and 2/2 desktop/mobile E2E passed.
- MP4 remains encoder-dependent and cloud recordings cap at 60 seconds. Docker WebM/3D/interactive HTML outputs passed actual checks; expanded production output verification is underway.
- GitHub release/tag/asset publication and downloadable tarball verification. npm registry publication has not happened.
- Live provider/Google integration requires external credentials not present during this work. Native Google export supports text/shapes/HTTPS images and rejects unsupported complex/private-image content; PPTX uses editable primitives plus complex-node rasterization.
- Remote media must be imported before cloud binary export. Size/pixel bounds and experimental WebMCP remain intentional capability boundaries, not hidden successes.
- Initial `npm audit` reported five high findings in upstream browser-download/PowerPoint transitive dependencies with no compatible complete fix. The affected downloader path is unused in the Cloudflare runtime; PPTX receives trusted generated PNG raster input. Findings remain disclosed and require upstream monitoring.

The final controller should replace pending entries only with fresh evidence, update phase checkboxes accordingly, and leave genuinely unavailable external checks explicitly documented.
