# Remote MCP client review

Status: DONE. Both findings below are repaired and independently verified. Source remained read-only; fixes coordinated with the adapter owner.

## Findings

### Resolved: Unsolicited SDK requests could amplify one response into thousands of HTTP requests

`withMcpClient` injects a guarded endpoint fetch but does not limit total dispatches or concurrent requests within a scope. The installed SDK automatically responds to remote `ping` requests. Real HTTP legacy peer returned its ordinary initialization reply plus 30 pings in one JSON response batch: observed 33 total fetches, including 30 automatic response POSTs. Thousands of such messages fit within the transport's 1 MiB response limit, creating thousands of concurrent sockets before the scope deadline. Catalog page/count limits do not cover this path.

Verified repair: per-scope 64-dispatch and four-active-stream caps abort excess traffic with a sticky `limit_exceeded` error. Slots remain held through body consumption/cancellation/error. Executable unsolicited-ping and sequential-total-budget regressions pass.

### Resolved: Closing a local client did not terminate its remote session

The original `finally` calls `client.close()` and `transport.close()`, which only abort local transport resources. The installed SDK exposes `terminateSession()` separately to send DELETE with the assigned session ID. Real HTTP legacy peer assigned `Mcp-Session-Id`; after a successful scope, observed initialize/initialized POSTs and zero DELETE requests. Repeated scopes therefore leave remote sessions until remote expiry.

Verified repair: assigned sessions receive best-effort termination before local close, with DELETE-only cleanup, a two-second timeout, and guaranteed abort. Stateful legacy JSON/SSE tests assert one DELETE. Already-aborted requests still depend on remote expiry; cleanup does not replace the original outcome.

## Verified boundaries

- Current MCP tests: 20/20 passed independently, together with 11 OAuth tests (31 total).
- Installed Streamable HTTP SDK POST, legacy standalone SSE GET, and resumptions all use the injected fetch; exact endpoint comparison prevents a secondary destination.
- Native Node fetch composition pins validated public DNS addresses; request/response/header limits and manual redirect rejection live in the shared transport.
- Bearer resource uses the shared canonical matcher: same origin, exact query, and equal path or parent path at a slash boundary. Actual HTTP destination remains the exact configured endpoint. Bearer values are snapshotted, and incoming Authorization is replaced. No authProvider is installed; 401/403 are rejected before SDK OAuth discovery.
- Reconnect retries are disabled. No automatic sampling, roots, or elicitation handlers are registered.
- Catalog pagination is bounded and read-only hints never become local authorization (`effect` remains `unknown`). Unsupported schema metadata is marked unsupported.
- Content decoders return inert text/data. They perform no HTML execution or link fetches.
- Real peer probes used isolated loopback servers and test-only trusted transport remapping, with no provider calls or credentials. Servers closed after probes.

## Future dispatcher integration note

Modern SDK `callTool` can evict/refetch and resend after `HEADER_MISMATCH` unless a pinned `toolDefinition` is supplied. Current module has no write dispatcher. Future writes should use a single typed request or the approved pinned definition, preserving one-send/outcome-unknown behavior; do not infer retry safety from `maxRetries: 0` alone.

Unresolved questions: none for the repaired MCP scope. OAuth review is recorded separately.
