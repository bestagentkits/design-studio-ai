# Outgoing MCP OAuth interoperability probe

Date: 2026-09-10. Status: bounded protocol feasibility passed; production OAuth and public egress remain unproven.

## Scope and executable evidence

Three isolated probe files: [runner](probes/mcp-oauth-interop.mjs), [client](probes/mcp-oauth-client.mjs), [HTTP OAuth/MCP peer](probes/mcp-oauth-peer.mjs). No production routes, configuration, dependencies, accounts, credentials or storage changed. Test tokens and codes are generated in memory, never logged, and discarded on exit. Peer implements a deliberately bounded authorization-server contract; this is not evidence of live third-party provider compatibility.

Installed `@modelcontextprotocol/client` 2.0.0 exports `auth`, `StreamableHTTPClientTransport`, issuer/resource validators and OAuth errors from its main package. The probe uses the supported public imports, real HTTP discovery/token requests, SDK-generated S256 challenge/verifier, and a real `@modelcontextprotocol/server` 2.0.0 MCP handler. Static test client registration avoids an unrelated registration lifecycle.

Commands, from repository root:

```sh
lsof -nP -iTCP:18845 -sTCP:LISTEN
node --check plans/260910-1839-connectors-and-mcp/reports/probes/mcp-oauth-peer.mjs
node --check plans/260910-1839-connectors-and-mcp/reports/probes/mcp-oauth-client.mjs
node --check plans/260910-1839-connectors-and-mcp/reports/probes/mcp-oauth-interop.mjs
node plans/260910-1839-connectors-and-mcp/reports/probes/mcp-oauth-interop.mjs
```

Port check found no listener before startup. Final run exited 0. Node v25.2.1; peer PID 50894, port 18845, worktree `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai`. Miniflare ran actual local workerd with compatibility date `2026-09-07`, `nodejs_compat`, and workerd bundler conditions. Worker bundle: 320,432 bytes minified, including the test client and assertion helpers; not a production bundle-size estimate. Runner disposes Miniflare, closes the MCP handler and HTTP server in `finally`; final output confirmed shutdown.

## Results

All twelve cases passed in Node and local workerd, with identical result arrays:

| Case | Actual evidence / owner |
| --- | --- |
| Initial unauthorized connection | HTTP 401 initiates protected-resource metadata and authorization-server discovery, then SDK produces authorization redirect |
| PKCE and resource request | Authorization URL includes S256, expected resource, and application-generated state; peer validates request |
| User denial | Local authorization endpoint returns `access_denied`; SDK callback handling rejects |
| State mismatch | Probe application callback rejects before `finishAuth`; **SDK does not supply this application state check** |
| Callback issuer mismatch | SDK rejects altered `iss` before code exchange |
| Wrong verifier | Peer recomputes SHA-256 challenge and returns `invalid_grant`; SDK rejects |
| Valid code exchange | SDK sends verifier/resource, peer returns token, SDK persists issuer stamp |
| Code replay | Peer consumed code; repeat SDK exchange rejects `invalid_grant` |
| Refresh | SDK sends resource-bound refresh; peer rotates access/refresh tokens |
| Authorized MCP | Fresh authenticated transport discovers `sum`, calls with 17 + 25, receives 42 on pinned `2026-07-28` profile |
| Token audience mismatch | Same access token sent to another local MCP resource receives 401 from peer |
| Bad discovery metadata | Separate SDK probes reject mismatched authorization-server issuer and unrelated protected-resource URL |

The twelve result labels count discovery/PKCE together and bad issuer/resource separately. Across both runtimes the peer recorded 2 successful code exchanges, 2 refreshes, 6 authenticated MCP requests, and 8 rejected grants. Eight rejected grants reflect the SDK retrying each invalid-grant exchange once, across wrong-verifier and replay cases in both runtimes.

## Harness correction and interpretation

Initial Node attempt failed while parsing a valid HTTP OAuth error: Hono's default global `Response` replacement caused SDK `parseErrorResponse` (`input instanceof Response`) to misclassify native fetch responses and produce `[object Response]`. Setting the peer adapter's supported `overrideGlobalObjects: false` preserved native globals; all assertions then passed without changing SDK policy or weakening expected OAuth errors. Keep this option when running this combined Node server/client harness. This is a harness interaction, not evidence that deployed Workers OAuth is broken.

Source inspection also confirms callers must persist discovery state alongside verifier to retain SDK callback issuer binding. The probe provides both methods. Its state guard is illustrative application code, not a shipped callback/session implementation.

## Missing coverage and downstream gates

- No deployed Cloudflare edge, real external OAuth provider, browser consent flow, DCR/CIMD, confidential client auth, or enterprise authorization tested.
- No product session/principal binding, one-time state storage, encryption, disconnect/revoke, refresh concurrency, token expiry recovery or persistence/lease semantics implemented.
- Modern JSON MCP tested here. Legacy 2025-11-25 and SSE remain covered only by the separate non-OAuth interoperability probe; this run does not establish their OAuth combinations.
- No malicious redirect, DNS rebinding, public address pinning, credential-bearing redirect rejection or custom-origin SSRF proof. Local loopback is an intentional test endpoint supported by the SDK, not a production egress exception.
- No CPU/memory limits or production latency measurements; bundle compatibility alone does not establish operational budgets.

Phase 1 may now cite bounded outgoing OAuth protocol feasibility in Node/local workerd. Phase 3 must still resolve public egress and implement application-owned OAuth lifecycle checks before custom connections ship.

References: [official MCP specification index](https://modelcontextprotocol.io/llms-full.txt), [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). Installed package source and executable local results above are the authority for observed SDK behavior.

Unresolved questions: no new product decision required by this probe; previously unresolved custom-origin egress remains a release gate.
