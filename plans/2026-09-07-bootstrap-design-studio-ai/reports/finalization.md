# Finalization evidence — 2026-09-07

Status: Original v0.1.0 implementation delivery completed with explicit external-integration and format boundaries. The user's subsequently added [GitHub login phase](../phase-05-github-login.md) is in progress and is not covered by the release checks below. No paid-provider success, universal browser support, or full editable export parity is implied.

## Release and verification

| Area | Final evidence |
| --- | --- |
| Source | Implementation commit `96c792e` pushed to [bestagentkits/design-studio-ai](https://github.com/bestagentkits/design-studio-ai); final documentation is committed separately |
| Integrated checks | 46/46 tests passed, including CLI subprocess/SQLite, provider input/ownership, security, renderer, and viewer regressions; typecheck and build passed |
| Browser workflows | 2/2 desktop/mobile Chromium E2E passed against an isolated temporary SQLite server |
| Linux CI | [Run 34144355459](https://github.com/bestagentkits/design-studio-ai/actions/runs/34144355459) succeeded with dependency installation, 46 tests, typecheck, build, E2E, and CLI packing |
| Cloudflare | Final production smoke passed 16/16: authenticated persistence/revisions/messages, MCP, publication, PNG/PDF/PPTX, real 3D, WebM, and interactive HTML |
| Docker | Real image built on Docker Engine 29.7.2; the equivalent self-host smoke passed 16/16 with SQLite/files and Chromium |
| Video artifact | After the cloud recorder fix, ffprobe decoded VP9 WebM at 1280×720 containing 11 frames |
| Distribution | [v0.1.0](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.1.0) published with CLI/skill archives; both downloaded, CLI SHA-256 matched the local package, and extracted CLI ran `--version` (0.1.0) and media help with the new flags independently |
| Secret/process cleanup | Controller scanned 95 staged files for secret values successfully, stopped/removed its Docker test container, and stopped its API process PID 46200 |

The verified deployed Worker version is `e4bc730e-cd8e-4867-a0f8-dd29c2cba59a` at [studio.agentkit.best](https://studio.agentkit.best), with D1 `920d59d1-d4e9-4e8b-b01b-9dbf45a180aa`, R2 `design-studio-ai-assets`, and Browser Rendering. These are release observations, not instructions for another operator to reuse production resources.

CLI asset: [bestagentkits-design-studio-ai-0.1.0.tgz](https://github.com/bestagentkits/design-studio-ai/releases/download/v0.1.0/bestagentkits-design-studio-ai-0.1.0.tgz), GitHub-reported SHA-256 `1ca1819579225923ad4ab693a6890635897faa501155aff1a513713aca69f90b`. Skill asset: [design-studio-ai-skill.zip](https://github.com/bestagentkits/design-studio-ai/releases/download/v0.1.0/design-studio-ai-skill.zip), SHA-256 `2d2b260f36689dd9b6cd1de67145abbec920df6451d1ba10122804caf31fceee`. The controller verified both downloads and the CLI's hash and extracted executable. npm authentication returned 401, so no npm registry publication is claimed.

## Resolved findings

Security review found and fixed OAuth privilege escalation, asset clones depending on source storage, unsafe render workloads, and renderer network exposure. Regression tests exercise token/ownership boundaries, independent copied assets, pixel budgets, and blocked external requests.

Expanded production smoke initially found cloud WebM returning HTTP 200 with invalid bytes while Docker passed. The recorder was fixed to deliver explicit frames with a visible canvas and to reject empty output. The final production smoke and independent ffprobe decoding passed. The failed check is resolved; HTTP status alone was not accepted as proof of export validity.

## Documentation reconciliation

[README](../../../README.md), [deployment](../../../docs/deployment.md), [architecture](../../../docs/architecture.md), [agents](../../../docs/agents.md), [CLI README](../../../packages/cli/README.md), and the [agent skill](../../../skills/design-studio-ai/SKILL.md) reflect release commands and boundaries. Architecture links to executable validators/operations/routes instead of copying a stale schema. The original four phases are completed; the overall plan remains in progress for the later GitHub-login request.

Claims were checked against package scripts, CLI flags, Dockerfile/Compose, Wrangler, Node migrations, provider/export/Google/MCP/conversation routes, rendering, and the isolated E2E runner. The release-doc pass validated 86 local Markdown links with no missing targets, including the README screenshot. `git diff --check` passed. GitHub independently reported the linked CI run completed successfully for full commit `96c792e5e31eea4a900be77aa3495219f956fb4e`. The updated skill passed the installed skill-creator `quick_validate.py`. No changelog was created because this report owns release observations.

Production, Docker, latest full-suite, secret-scan, and cleanup results are controller-reported evidence. This documentation task independently inspected release asset metadata and local document references; it did not rerun paid providers or production writes.

After adding the user-requested GitHub-login phase, the final local-link pass checked 94 targets with zero missing references. The new phase is the only phase with open implementation acceptance checks; it does not retroactively invalidate the released v0.1.0 results.

## Remaining capability and configuration boundaries

- Provider creation/editing/music/video and Google Slides call real APIs but require external credentials/account access unavailable during delivery. Their upstream successful output and quality are not live-verified.
- Native Google Slides supports text/shapes/HTTPS images and rejects unsupported complex nodes/private image URLs. PPTX retains editable primitives with complex-node rasterization; SVG is static; interactive HTML and binary WebGL have different capabilities.
- Remote media must be imported before cloud binary export. Pixel/byte limits apply; motion caps at 60 seconds. MP4 depends on runtime encoder support; verified WebM does not establish MP4 support everywhere.
- Cloud motion mixes imported audio/video. Browser fallback recordings are silent. 3D object properties persist, while orbit-camera adjustments are temporary preview state.
- Browser WebMCP is experimental and feature-detected. Registration behavior and fallback are implemented; native WebMCP availability in every browser is not verified or claimed. Network MCP provides the supported 2025 SDK transport and does not advertise the newer 2026 transport.
- Five high upstream dependency audit findings remain in browser-download/PowerPoint transitive dependencies without a compatible complete fix. The affected downloader is unused in the Cloudflare runtime, and PPTX receives trusted generated PNGs; these boundaries do not erase the findings. Monitor upstream updates.

These disclosed boundaries are not fabricated passing checks and are not hidden incomplete implementation tasks. Additional provider credentials, browser capabilities, or upstream fixes can enable further validation without changing the completed delivery evidence above.
