# Research and source evidence

Inspected 2026-09-10. Baseline: detached HEAD `3545d18d06215c6c4e5e188761818bba98a2e688`, clean before planning. No application code changed and no tests/provider calls were executed during this planning session.

## Verified repository owners

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Hono runs with D1/R2 on Cloudflare and SQLite/files on Node | [types](../../../server/types.ts), [Node adapters](../../../server/node-adapters.ts), [Worker config](../../../wrangler.jsonc) | Use portable contracts and verify both runtimes |
| Current text generation has no tool-call round trips | [providers.ts:195](../../../server/providers.ts#L195), completeText; generation route at line 277 | Add a tool-capable provider/run layer; a connection settings screen is insufficient |
| Generation validates independent brief/document revisions | [providers.ts](../../../server/providers.ts), [brief tests](../../../tests/briefs.test.ts) | Tools and approvals must preserve the existing proposal/save boundary |
| Incoming MCP uses server SDK with protocol allowlist | [mcp.ts](../../../server/mcp.ts), lines 1-69 | Outgoing client is a new role; do not silently upgrade inbound contract |
| OAuth only advertises/accepts studio scope | [oauth.ts](../../../server/oauth.ts), lines 20-43 and 103 | Add explicit connector delegation; no blanket authority inherited from existing scopes |
| Authentication currently retains only user/authMethod/tokenKind | [security.ts](../../../server/security.ts), lines 76-99; [types](../../../server/types.ts) | Add stable API-token/OAuth-family principal for grants |
| API tokens have IDs; OAuth tokens have client_id/family | [initial migration](../../../migrations/0001-initial.sql), lines 10-15 | Reuse those identities; do not key permissions by bearer hash or user alone |
| WebMCP loops through most typed API operations | [browser-design-tools.ts](../../../src/app/browser-design-tools.ts), lines 21-40 | New credential/approval routes need explicit agent exclusion before exposure |
| GitHub sign-in asks read:user/user:email | [github-login.ts](../../../server/github-login.ts), line 42 | Use a separate GitHub App for repository access |
| Slides route receives accessToken per request | [google-slides.ts](../../../server/google-slides.ts), lines 21-25; browser helper in [editor](../../../src/app/editor.tsx), line 2601 | Add stored-connection path while preserving the legacy route |
| Export already supports real React ZIP/PDF/PPTX | [exports](../../../server/exports.ts), [React export](../../../src/shared/react-export.ts), [format tests](../../../tests/exports-agent-formats.test.ts) | Reuse actual artifacts; never substitute placeholders |
| Encryption key must stay stable across rollout/backup | [deployment](../../../docs/deployment.md#backups-and-rollback), [security](../../../server/security.ts) | Encrypt new credentials without rotating the existing key |
| Typed reference and human docs own generated discovery | [web documentation](../../../docs/web-documentation.md) | Update source and rebuild, including llms output |
| Firefox/WebKit are available behind STUDIO_CROSS_BROWSER | [Playwright config](../../../playwright.config.ts), [deployment](../../../docs/deployment.md) | Include real cross-browser commands; default CI remains Chromium |
| No lint script; release checks include CLI/skill packaging | [package](../../../package.json), [CI](../../../.github/workflows/ci.yml) | Name checks that exist and do not claim invented lint execution |
| ApiError currently carries status/code/message only | [security.ts](../../../server/security.ts), line 51; [error handler](../../../server/index.ts), lines 94-137 | Add only sanitized recovery fields if needed for run/approval handoff |

Line citations are baseline navigation hints; re-resolve after code changes. Proposed new files in phases are not presented as already existing.

## Official external references checked

- [GitHub App vs OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps): supports the choice of selected-repository installations and fine-grained credentials. It does not prove this project's installation workflow works.
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): drive.file is per-file and non-sensitive; broad read scopes are restricted. Use Picker and verify requested permissions.
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview): browser picker integration is a separate credential/UX boundary.
- [Slides create reference](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/create): verify exact accepted scopes before replacing the legacy token path.
- [MCP July 2026 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/): new lifecycle differs from the older initialized/session profile. Supports a separate version matrix, not a claim that the installed SDK works.
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): protected-resource discovery, issuer/resource binding and client registration strategies guide the outgoing OAuth client.
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): schema/content semantics and untrusted annotations guide tool policy. Read earlier in this conversation.
- [TypeScript SDK documentation](https://ts.sdk.modelcontextprotocol.io/): the opened site identifies as v1. Pin a tested compatible client in phase 1 rather than assuming documentation home and latest protocol are equivalent.

The attempted versioned MCP security-best-practices page did not load. No claims depend on that page. Egress proof and current provider tool-calling API checks are explicit implementation tasks, not completed research claims.

## Options and decision

Native-only would require a new service-specific implementation for every integration and does not satisfy the user's MCP request. MCP-only assumes each service exposes all required workflows with suitable UX/permissions; it fails first on provider-specific picker/export fidelity. Selected approach: shared connection/policy/operation service with native adapters and a remote MCP adapter. It costs an adapter boundary but retains high-quality GitHub/Drive workflows and user-supplied MCP servers. No superior alternative to this combined requested direction was found in the inspected code.

On-demand snapshots were selected as the planning default; global indexing and bidirectional sync add separate storage/permission/conflict requirements with no explicit request. Proposed defaults remain labeled as defaults, not invented user approvals.

## Tooling observations

`ak` was not on PATH. The installed `/Users/duynguyen/.local/bin/ak` succeeded. Used live create/add-phase help and CLI scaffolding, then normalized the created directory to the injected local-time naming path. Initial checkout lacks node_modules, so SDK runtime compatibility is untested. No broad environment files, secrets or production data were read.
