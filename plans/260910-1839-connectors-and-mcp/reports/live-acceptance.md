# Live acceptance — 2026-09-11

## Passed

Public server: `https://docs.mcp.cloudflare.com/mcp`, anonymous. Current application Node DNS-pinned transport negotiated `2026-07-28`; server identified itself as `docs-ai-search` 0.4.13. Discovery returned `search_cloudflare_documentation` and `migrate_pages_to_workers_guide`. A documentation query about public Workers fetch returned real textual results.

The same public server passed the application's project-binding, exact-action approval, refresh recovery and single-dispatch flow on Chromium desktop/mobile, Firefox desktop and WebKit mobile. This used isolated local Studio persistence; it is not evidence of beta connector execution. No private content, provider credentials or paid model request was sent. Test data was disconnected/deleted by the test finally block.

## Required but not performed

- Real MCP write and outgoing OAuth reconnect/revoke against an external authorization server.
- One authorized supported model tool loop with refresh/approval and final unsaved proposal.
- GitHub App selected installation/repository source-to-reviewed-React-PR, inspecting the actual remote commit and PR.
- Google OAuth/Picker selected files and multiple-account isolation; actual PDF/PPTX uploads and native Slides inspection in a designated folder.

Beta's configured secret names currently contain only ENCRYPTION_KEY. Native connector app registrations/secrets and authorized test destinations/model have been requested and are still absent. Do not mark this plan's overall acceptance complete or enable general connector execution based on contract fixtures, public documentation search, green CI or a disabled beta deployment.

Cloudflare remote preview also passed the fixed public documentation search through `createWorkersConnectorFetch` and the same `withMcpClient`: profile 2026-07-28, two discovered tools, 2,038 text bytes, isError false. Executable probe: `probes/public-mcp-edge.mjs`. Preview used nodejs_compat/global_fetch_strictly_public, no application database/bucket/credentials and no caller-supplied targets. The remote preview process was stopped after the request. This does not enable beta routes or establish native-provider/model acceptance.
