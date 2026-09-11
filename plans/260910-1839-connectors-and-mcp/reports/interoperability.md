# Connector interoperability matrix — 2026-09-11

Current checkpoint: [full plan verification](verification-260911-1539-plan-completion.md) supersedes historical configuration/deployment statements below. GitHub is configured and partly verified; beta connectors are enabled for authorized acceptance. Overall plan remains incomplete.

| Surface / runtime | Evidence | Limit |
| --- | --- | --- |
| MCP 2025-11-25 / 2026-07-28 JSON and SSE | Existing Node/local workerd contract-peer probe matrix in runtime-probes.md | Controlled protocol peers, not real account acceptance |
| Outgoing OAuth discovery / PKCE / replay / refresh | Existing 96-case Node/workerd matrix in oauth-probe-results.md | External authorization-server interoperability remains pending |
| Native Cloudflare public egress | Controlled DNS changes and transport evidence linked from runtime-probes.md | Platform public-fetch boundary plus observed tests, not a universal race proof |
| Current Node app and Cloudflare remote preview → public Cloudflare docs MCP | 2026-07-28 discovery and documentation search, including full browser approval action | Anonymous read, no remote write or model call |
| D1 forward migration + credential/operation races | Current local workerd probe applies 0001–0017 and retains existing project revision | Not a remote provider workflow |
| PDF extraction / RSA signing | Real rendered PDF and generated RSA key in local workerd | Remote CPU not measured |
| OpenAI-compatible / Anthropic / Gemini tool messages | Focused and complete automated tests | No current paid-model acceptance |
| GitHub / Google transports | Actual application logic with isolated provider contract tests, immutable artifacts and failure cases | No native account success claimed |

SDKs remain outgoing client 2.0.0 and incoming SDK 1.30.0. See [runtime probes](runtime-probes.md), [OAuth probe](oauth-probe-results.md), [transport results](connector-transport-results.md), and [current verification](verification.md) for executable owners and evidence boundaries.
