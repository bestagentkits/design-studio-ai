# Connector transport runtime verification

Observed 2026-09-10. Scope: new transport primitives, public read-only health endpoint, local Node and actual local workerd. Passed. A separate actual Cloudflare remote preview is recorded below; application route wiring is not yet complete.

## Reproduce

From repository root:

```sh
node --check plans/260910-1839-connectors-and-mcp/reports/probes/connector-transport-runtime.mjs
node plans/260910-1839-connectors-and-mcp/reports/probes/connector-transport-runtime.mjs
```

[Executable probe](probes/connector-transport-runtime.mjs) bundles the actual server TypeScript sources with esbuild, imports the Node bundle in memory, and runs the Workers bundle through Miniflare/workerd. No generated files, server routes, configuration, dependencies, provider credentials or accounts changed. Public requests use only `GET https://beta.studio.agentkit.best/api/health`; no authorization header or application write.

Node v25.2.1, probe PID 24512, checkout `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai`. Run exited 0, printed disposal confirmation, and PID no longer exists. Miniflare compatibility date `2026-09-07`, flags `nodejs_compat` and `global_fetch_strictly_public`. No manually bound listening port or external test server was needed.

## Results

| Case | Node pinned HTTPS | Local workerd native global fetch |
| --- | --- | --- |
| Live public health request | HTTP 200, JSON `ok: true` | HTTP 200, JSON `ok: true` |
| Complete stream consumption | 40 bytes, `bodyUsed: true` | 40 bytes, `bodyUsed: true` |
| Same live endpoint with 1-byte response cap | Rejected: `Connector response body exceeds limit` | Same rejection |
| Private DNS answer | Injected resolver returning only 127.0.0.1 rejected before connection | Not exercised; Workers does not use Node resolver |
| Mixed DNS answer set | Injected resolver returning 1.1.1.1 + ::1 rejected before connection | Not exercised |
| Controlled stream actual-byte overflow | Rejected, upstream cancelled | Same rejection and cancellation |
| Controlled stalled response deadline | Rejected: `Connector request timed out`, upstream cancelled | Same rejection and cancellation |

Node live pair elapsed 2,180 ms; local workerd live pair elapsed 784 ms. These are two sequential health reads per runtime, including the deliberate capped read; they are observations, not a latency benchmark or production budget validation. Worker bundle including probe helpers: 7,313 bytes minified.

The stream/deadline cases explicitly inject trusted **in-memory fixtures** into `createConnectorFetch`; two fixture cancellations were asserted per runtime. The private/mixed DNS cases inject deterministic resolver answers; they test production all-answer policy without making private-network connections. The healthy HTTPS requests use `createNodeConnectorFetch` and `createWorkersConnectorFetch` with their actual adapters, without loopback mapping or transport bypass.

## Source identity

HEAD at run: `79f7e031b21c1fcc5496efdbc6bd8a229554a531`. Transport implementation was working-tree content; SHA-256 identifies what was exercised:

| File | SHA-256 |
| --- | --- |
| `server/connector-transport.ts` | `16af836da77d7800061c7dab91a42872b901da4245d2c0888642dfdf665a3925` |
| `server/connector-transport-node.ts` | `63ab4e6dff517b70bcf4a77a73985723faa10a7c5b8ca525361e3661226da8f8` |
| `server/connector-network-policy.ts` | `efe3b0501e2d48e9160ba6e7dc6f988c31df4ce3e8e0a64172173f27d6757205` |

## Interpretation and remaining gates

This proves the current boundary can perform and fully consume a real HTTPS JSON response on both selected local runtimes, enforce live response caps, and cancel controlled oversized/stalled streams. Earlier [runtime probes](runtime-probes.md) provide separate DNS pinning and Cloudflare egress experiments.

This run does not prove deployment/runtime wiring, universal DNS-rebinding resistance, a real remote OAuth/MCP integration through the new boundary, long-lived SSE interoperability, credential audience enforcement, request-driven execution budgets or release readiness. It does not infer edge security guarantees from Miniflare. Independent review and parent-owned remote preview remain separate evidence.

Unresolved questions: none introduced by this bounded probe.

## Actual Cloudflare remote preview

Parent executed [the fixed-target Worker](probes/connector-egress-worker.ts) using [the isolated configuration](probes/connector-egress-wrangler.jsonc), importing the same production transport source. No service/private bindings, secrets or public routes. Wrangler remote preview uploaded 16.35 KiB (gzip 4.82 KiB). Its response was:

```json
{"healthy":true,"result":{"ok":true,"service":"design-studio-ai"},"bounded":true,"privateRejected":true}
```

`healthy` consumed beta health JSON over HTTPS; `bounded` rejected the same response with a one-byte cap; `privateRejected` rejected literal loopback before dispatch. This supplements, rather than replaces, the earlier controlled DNS-change experiment. It does not test remote OAuth or arbitrary DNS changes through this exact wrapper. Wrangler process 23896 was stopped with SIGINT; parent session exited 130, port 18842 released.

Independent read-only review found no concrete defect, reran 11 focused tests, and checked response streaming in local workerd. Root Workers config now explicitly includes `global_fetch_strictly_public`; Node preserves native Response globals for SDK OAuth parsing. Neither application connector endpoints nor grants are enabled by this change.

Regression after transport/runtime compatibility changes: `npm run typecheck`, 177 tests (0 failures), and `npm run build` passed. Existing document-view dynamic-import build warning remains. These checks predate the subsequent lifecycle migration work and do not verify that later implementation.
