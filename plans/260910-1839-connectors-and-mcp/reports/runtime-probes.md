# Connector runtime probes — implementation checkpoint

Observed 2026-09-10 in `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai`.
Base `3545d18d06215c6c4e5e188761818bba98a2e688`; branch `codex/connectors-and-mcp`.

## Decision and current gate

Use the separately published `@modelcontextprotocol/client@2.0.0` for the outgoing client; keep incoming `@modelcontextprotocol/sdk@1.30.0` unchanged and pinned. The new client defaults to legacy mode: modern mode must explicitly use version negotiation. This selection has executable local interoperability evidence below. It is not a claim that outgoing OAuth or the connector product is complete.

Phase 1 remains incomplete. Its exact acceptance says: “An unsupported profile or unproven public egress remains a blocking dependency for phase 3, not a successful degraded implementation.” The plan validation also forbids phases 2/3 from bypassing transport prerequisites. Do not enable custom endpoints based on URL syntax validation or the literal-IP results below.

### Selected next path

User selected native Cloudflare validation on 2026-09-10 at 19:11 Asia/Ho_Chi_Minh. Awaiting the actual designated test domain and DNS management access. Gateway is not selected.

1. **Continue validating native Cloudflare transport**, preserving the existing hosting topology. Needs an explicitly designated DNS test zone/hostname with authority to change A/AAAA/CNAME responses and a controlled HTTPS origin. Exercise public-to-private rebinding, mixed DNS answers, mapped IPv6, CNAME changes and redirects without real credentials. Existing Wrangler login works, but its observed scopes include `zone:read`, not DNS edit authority. No DNS records were changed. Passing these tests must be paired with platform guarantees; a few blocked requests do not establish a universal invariant.
2. **Adopt a Node egress gateway** if native transport cannot meet the invariant. A separate HTTPS service resolves and validates every address immediately before connecting, pins the selected public address while preserving target TLS/SNI validation, denies redirects, and bounds time/bytes. Workers authenticate to this service; outgoing provider credentials transit it. This adds a service, availability dependency, trust boundary, deployment secrets and compute/egress cost. No host, price, deployment, gateway implementation or credential forwarding is approved/claimed yet. A destination and budget must be selected before deployment. Self-hosted Node can use the same transport directly.

No allowlist-only substitute, Node-only product, relaxed DNS guard or gateway was silently adopted. The complete MCP + GitHub + Drive scope remains queued.

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

Pinned modern client rejected the legacy-only endpoint. All clients and servers closed in finally blocks. Initial paired Node/workerd elapsed times: 602, 36, 44, 33 ms respectively; these tiny local operations do not validate production tool budgets, provider latency, CPU or memory envelopes. OAuth, pagination, resource reading and interruption during a call remain unproven.

### Connection-time lookup hook

`node plans/260910-1839-connectors-and-mcp/reports/probes/egress-runtime.mjs`

- Node custom lookup called once and prevented connection with `connection-time-policy-denied`.
- Local workerd custom lookup called zero times and returned `The options.lookup option is not implemented`.
- This proves the Node hook cannot be reused as a Workers guard. It does not prove a full Node public-IP classifier/pinned TLS implementation; that implementation is still pending.
- First scratch run used obsolete Miniflare constructor options and failed validation. Switched to the installed exported conversion helper. Second run exposed the expected synchronous lookup rejection outside the initial JSON wrapper; corrected the probe error capture. Neither scratch failure affected application code or checks.

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

This was actual remote preview execution, not a production deployment. It used no project database, bucket, application secrets, routes or provider credentials. Stopped the harness after the probe. Cloudflare blocks direct IP fetches generally, so literal loopback rejection **does not establish hostname rebinding protection**. No controlled DNS/CNAME changes were tested.

### Persistence and interrupted writes

`node plans/260910-1839-connectors-and-mcp/reports/probes/lease-runtime.mjs`

Passed with Node in-memory SQLite and local D1:

- Duplicate idempotency reservations create one row.
- Concurrent tabs acquire one lease only.
- A different owner cannot claim it.
- Expired running write becomes `outcome_unknown`, revision 3.
- Late completion CAS cannot overwrite recovered state.
- An unknown write cannot be blindly dispatched again.

SQL belongs only to scratch probes. It is not a migration or the finished operation service. No remote D1 database was created. Production run/provider budgets, revocation races and full request-driven execution remain pending.

## Shared schema foundation

Added `src/shared/connectors.ts`, `connector-values.ts`, `connector-operations.ts`, `agent-runs.ts` and `tests/connector-contracts.test.ts`.

These define strict metadata/configuration, principals, selected sources, policy grants, immutable snapshot provenance, operation pins/approval metadata, state transitions and bounded run contracts. They reject self-approval fields, secret metadata fields, unbounded/non-JSON values, external JSON Schema references, traversal paths and inconsistent lease/approval/run states.

They are not yet imported by application routes or clients. Ownership, authorization, credential handling, current revision comparisons and approval consumption must still be enforced by future server services. Endpoint schema validation is syntax-only; it does not block private addresses or authorize outbound fetches. All query strings are currently rejected; revisit legitimate non-credential query requirements when integrating remote configuration. Run budget values remain provisional ceilings, not measured production guarantees. No document/brief schema changed.

## Verification

- `npx tsx --test tests/connector-contracts.test.ts`: 9 passed, 0 failed.
- `npm run build:cli`: passed.
- `npm run typecheck`: passed.
- `npm test`: 157 passed, 0 failed; includes existing auth/MCP/provider/export behavior.
- `npm run build`: passed; generated normal documentation/renderer output. Existing ineffective dynamic-import warning for document-view remains.
- Final schema review added malformed-URL regression cases and allowed base64url identifier prefixes; focused tests and typecheck rerun afterward.
- `git diff --check`: passed at checkpoint.
- UI/E2E, real connector accounts, paid model tool loop, GitHub PR/Drive artifacts and production deployment: not performed.
- No independent subagent review claimed; this session restricts delegation absent explicit current-request authorization.

## References checked during execution

- [MCP July release](https://blog.modelcontextprotocol.io/posts/2026-07-28/): separate stateless protocol lifecycle.
- [Workers HTTP compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/): unsupported lookup/createConnection hooks.
- [Workers DNS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/): missing lookup and resolver differences.
- [Workers fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/): global fetch and strictly-public routing flag; not a full DNS pinning guarantee.
- [Workers known issues](https://developers.cloudflare.com/workers/platform/known-issues/): direct-IP fetch limitation; remote preview caveats.

## Remaining questions

What exact test domain/subdomain and configured DNS management access should be used? Native Cloudflare validation is selected; no gateway authorization is assumed. Until the controlled experiment and remaining phase-1 requirements pass, phase 1 stays incomplete and dependent phases remain pending.
