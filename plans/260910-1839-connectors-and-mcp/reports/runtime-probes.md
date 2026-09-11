# Connector runtime probes — implementation checkpoint

Observed 2026-09-10 in `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai`.
Base `3545d18d06215c6c4e5e188761818bba98a2e688`; branch `codex/connectors-and-mcp`.

## Decision and current gate

Use the separately published `@modelcontextprotocol/client@2.0.0` for the outgoing client; keep incoming `@modelcontextprotocol/sdk@1.30.0` unchanged and pinned. The new client defaults to legacy mode: modern mode must explicitly use version negotiation. This selection has executable local interoperability evidence below. It is not a claim that outgoing OAuth or the connector product is complete.

Phase 1 remains incomplete. Its exact acceptance says: “An unsupported profile or unproven public egress remains a blocking dependency for phase 3, not a successful degraded implementation.” The plan validation also forbids phases 2/3 from bypassing transport prerequisites. Do not enable custom endpoints based on URL syntax validation or the literal-IP results below.

### Selected next path

User selected native Cloudflare validation and authorized `studio.agentkit.best`, an isolated `beta.studio.agentkit.best`, and deployment on pushes to `dev`. The project-scoped Cloudflare credential successfully created isolated DNS records, D1 and R2 resources. The unrelated default Wrangler login was not used for these resources. Gateway remains unselected.

Native transport now has controlled hostname evidence, including public-to-loopback DNS changes, plus a documented platform boundary: [Cloudflare explains that global fetch reaches only the public Internet](https://blog.cloudflare.com/workers-environment-live-object-bindings/). The documented legacy exception concerns same-zone origin bypass; the probe explicitly enables `global_fetch_strictly_public`, has no origin or private-network bindings, and never dispatches user URLs through a resource binding. This supports continuing with native Cloudflare transport under those constraints; finite probes alone are not a universal security proof.

Shared transport is now implemented, independently reviewed and verified on actual Node HTTPS, local workerd and remote Cloudflare preview; see [transport results](connector-transport-results.md). OAuth covers both profiles and JSON/SSE. [Execution measurements](execution-budget-results.md) establish tested payload caps and request-driven checkpoint behavior. Remaining gate: integrate credential-audience/lifecycle handling and settle step budgets from integrated execution before enabling product execution. No extra domain/access decision is pending. The complete MCP + GitHub + Drive scope remains queued.

## Runtime and dependency evidence

| Item | Observed |
| --- | --- |
| Node | v25.2.1; repository requires >=24 |
| Existing SDK | 1.30.0; exported latest protocol is 2025-11-25 |
| Outgoing client | 2.0.0, exact root dependency; isolated probe also pins 2.0.0 |
| Probe modern server | @modelcontextprotocol/server 2.0.0, scratch-only dependency |
| Wrangler | 4.129.1 |
| Miniflare | 5.20260907.0-alpha; requires new options or convertV4MiniflareOptions |
| Compatibility date | 2026-09-07 with nodejs_compat |
| Probe client bundle | 317741 bytes, minified, browser/workerd conditions, explicit CF schema validator |

`npm ci` and `npm ci --prefix packages/cli` passed. Root installation reported 8 high-severity dependency findings; this work did not run a forced audit upgrade or claim an audit-clean tree.

## Executable probes

Run from repository root. Install isolated dependencies with `npm ci --prefix plans/260910-1839-connectors-and-mcp/reports/probes` before the MCP probe. These scripts use real local runtime/server/SQLite/D1 execution; the arithmetic tool is an isolated interoperability endpoint, not a substitute provider or product feature. Probe HTTP loopback URLs are test-only and are never passed through a production connector service.

### MCP profiles, JSON/SSE and disconnect

`node plans/260910-1839-connectors-and-mcp/reports/probes/mcp-interop.mjs`

| Profile | Encoding | Node | Local workerd |
| --- | --- | --- | --- |
| 2025-11-25 | JSON | list/call result 42; legacy era | Same |
| 2025-11-25 | SSE | list/call result 42; legacy era | Same |
| 2026-07-28 | JSON | list/call result 42; modern era | Same |
| 2026-07-28 | SSE | list/call result 42; modern era | Same |

Pinned modern client rejected the legacy-only endpoint. All clients and servers closed in finally blocks. Initial paired Node/workerd elapsed times: 602, 36, 44, 33 ms respectively; these tiny local operations do not validate production tool budgets, provider latency, CPU or memory envelopes. The separate OAuth probe below covers both profiles and JSON/SSE. Pagination, resource reading and integrated interruption recovery remain downstream implementation work.

### Outgoing OAuth feasibility

[OAuth probe results](oauth-probe-results.md) records twelve matching cases for every Node/local workerd × legacy/modern × JSON/SSE combination (96 executions) using the actual client SDK and a real isolated HTTP authorization/MCP contract peer. Coverage includes discovery, S256 PKCE, denial, application-owned callback state, SDK issuer checks, code replay, refresh and authenticated tool calls on both profiles and encodings. No external provider account or production lifecycle is claimed.

The combined Node peer/client needed Hono's `overrideGlobalObjects: false` to keep SDK error parsing compatible with native fetch responses. `server/node.ts` currently uses the same adapter default; integration must carry this requirement or otherwise prove error parsing under that entrypoint. Callback state, durable discovery/verifier persistence, one-use authorization state and credential encryption remain application responsibilities.

### Connection-time lookup hook

`node plans/260910-1839-connectors-and-mcp/reports/probes/egress-runtime.mjs`

- Node custom lookup called once and prevented connection with `connection-time-policy-denied`.
- Local workerd custom lookup called zero times and returned `The options.lookup option is not implemented`.
- This proves the Node hook cannot be reused as a Workers guard. It does not prove a full Node public-IP classifier/pinned TLS implementation; the implementation is now independently verified in [transport results](connector-transport-results.md).
- First scratch run used obsolete Miniflare constructor options and failed validation. Switched to the installed exported conversion helper. Second run exposed the expected synchronous lookup rejection outside the initial JSON wrapper; corrected the probe error capture. Neither scratch failure affected application code or checks.

### Node pinned TLS connection

`node plans/260910-1839-connectors-and-mcp/reports/probes/node-dns-pinning.mjs` passed on Node v25.2.1. A real HTTPS call to example.com returned 200 with the TLS peer authenticated and its socket address equal to the sole checked address returned by the lookup hook. The resolver was called once; its programmed second answer would have been loopback. Loopback, RFC1918, link-local, IPv6 loopback and IPv4-mapped-loopback answers were rejected before connecting (five cases). The scratch address list is deliberately not claimed as a complete production classifier.

### Cloudflare remote preview

Started only the isolated, binding-free probe:

```sh
node node_modules/wrangler/bin/wrangler.js dev --remote \
  --config plans/260910-1839-connectors-and-mcp/reports/probes/wrangler.jsonc \
  --ip 127.0.0.1 --port 18841 --inspector-port 18842 \
  --no-show-interactive-dev-session
curl --fail --max-time 25 --silent http://127.0.0.1:18841/
```

Observed `https://example.com` → 200; `https://127.0.0.1` → 403; `https://[::1]` → 403; HTTPS lookup hook → `The options.lookup option is not implemented`.

This was actual remote preview execution, not a production deployment. It used no project database, bucket, application secrets, routes or provider credentials. Stopped the harness after the probe. Cloudflare blocks direct IP fetches generally, so literal loopback rejection **does not establish hostname rebinding protection**. That first probe did not test controlled DNS/CNAME changes; the later experiment below does.

### Controlled hostname and DNS change experiment

[Machine-readable results](cloudflare-dns-evidence.json), [fixed-target Worker](probes/dns-edge-worker.mjs), [configuration](probes/dns-wrangler.jsonc). Executed with the project account in Cloudflare remote preview, local forwarding port 18842. No application database, bucket, credential or provider account was bound to the probe.

Created seven temporary, DNS-only records under `beta.studio.agentkit.best`, with TTL 60. The public control `https://example.com` returned 200. Hostnames pointing at loopback IPv4, RFC1918, link-local metadata IP, IPv4-mapped IPv6 and CNAME-to-loopback returned HTTP 403 / Cloudflare 1002. IPv6 loopback returned HTTP 403 / 1102; record the observed result without interpreting its code as a DNS-specific guarantee.

For DNS mutation, Cloudflare DNS-over-HTTPS first reported public A `1.1.1.1`. The same owned record was changed to `127.0.0.1`; after TTL, DNS-over-HTTPS reported loopback and the remote Worker fetch returned HTTP 403 / 1002. This is an observed public-to-private DNS transition followed by connection rejection, not a nanosecond race stress test or a successful TLS origin exchange at the initial public IP. Mixed A/AAAA and credential-bearing OAuth/redirect behavior remain separate transport tests.

All seven temporary DNS records were deleted after recording evidence; production and beta application domain records were not changed by this experiment. The preview process was stopped.

### Persistence and interrupted writes

`node plans/260910-1839-connectors-and-mcp/reports/probes/lease-runtime.mjs`

Passed with Node in-memory SQLite and local D1:

- Duplicate idempotency reservations create one row.
- Concurrent tabs acquire one lease only.
- A different owner cannot claim it.
- Expired running write becomes `outcome_unknown`, revision 3.
- Late completion CAS cannot overwrite recovered state.
- An unknown write cannot be blindly dispatched again.

SQL belongs only to scratch probes. It is not a migration or the finished operation service. No remote D1 database was used for this lease probe; the separately authorized beta deployment has its own D1 database. Production run/provider budgets, revocation races and full request-driven execution remain pending.

## Shared schema foundation

Added `src/shared/connectors.ts`, `connector-values.ts`, `connector-operations.ts`, `agent-runs.ts` and `tests/connector-contracts.test.ts`.

These define strict metadata/configuration, principals, selected sources, policy grants, immutable snapshot provenance, operation pins/approval metadata, state transitions and bounded run contracts. They reject self-approval fields, secret metadata fields, unbounded/non-JSON values, external JSON Schema references, traversal paths and inconsistent lease/approval/run states.

They are not yet imported by application routes or clients. Ownership, authorization, credential handling, current revision comparisons and approval consumption must still be enforced by future server services. Endpoint schema validation is syntax-only; it does not block private addresses or authorize outbound fetches. The shared endpoint and transport policy permits non-credential query parameters and rejects known credential-bearing names, fragments and embedded user information. Run budget values remain provisional ceilings, not measured production guarantees. No document/brief schema changed.

## Verification

- `npx tsx --test tests/connector-contracts.test.ts`: 9 passed, 0 failed.
- `npm run build:cli`: passed.
- `npm run typecheck`: passed.
- Initial `npm test`: 157 passed; after merging current main and aligning the run provider schema with its owning validator: 166 passed, 0 failed.
- `npm run build`: passed; generated normal documentation/renderer output. Existing ineffective dynamic-import warning for document-view remains.
- Final schema review added malformed-URL regression cases and allowed base64url identifier prefixes; focused tests and typecheck rerun afterward.
- `git diff --check`: passed at checkpoint.
- Beta enabling work: Chromium desktop 31 passed, mobile 30 passed with one existing skip, and exact-commit beta CI/deploy passed. See [beta rollout](beta-rollout.md). Real connector accounts, paid model tool loop, GitHub PR/Drive artifacts and production deployment remain unperformed.
- Independent review of beta workflow, native egress evidence and provider-schema alignment completed; recorded workflow lookup finding fixed and re-reviewed. This does not constitute a review of the unimplemented connector product.

## References checked during execution

- [MCP July release](https://blog.modelcontextprotocol.io/posts/2026-07-28/): separate stateless protocol lifecycle.
- [Workers HTTP compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/): unsupported lookup/createConnection hooks.
- [Workers DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/): missing lookup and resolver differences.
- [Workers fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/): global fetch and strictly-public routing flag; not a full DNS pinning guarantee.
- [Workers known issues](https://developers.cloudflare.com/workers/platform/known-issues/): direct-IP fetch limitation; remote preview caveats.

## Remaining work

No domain or DNS-access question remains. Native Cloudflare is selected and the controlled experiment succeeded for the recorded cases. The shared transport and OAuth compatibility matrix now pass. Payload/checkpoint measurements are recorded; integrated budgets and credential lifecycle remain uncompleted. Phase 2 persistence can be built without enabling custom-origin execution, whose release gate remains enforced.
