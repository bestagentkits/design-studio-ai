# Local execution budget and checkpoint probe

Observed 2026-09-10. Node v25.2.1; local workerd through the repository's installed Miniflare, compatibility date `2026-09-07`, `nodejs_compat`. This is phase-1 scratch evidence, not integrated connector execution or a provider benchmark.

## Reproduce

From the repository root with its existing dependencies installed:

```sh
node --import tsx plans/260910-1839-connectors-and-mcp/reports/probes/execution-budget-runtime.mjs
```

[The probe](probes/execution-budget-runtime.mjs) owns a real loopback HTTP peer on reserved port **18846** and fails if that port is occupied. It creates in-memory SQLite and ephemeral local D1 only. It disposes workerd, closes SQLite, clears its timers and closes its HTTP connections in `finally`. No provider credentials, production accounts, remote databases or paid calls are used. The observed process was PID 98414 and exited 0.

## Parsing and validation measurements

The probe imports the actual shared `connectorToolSchema`, `boundedConnectorJson` and `agentRunLimits`. Identical workload/validation functions run in Node and in a bundled workerd module. One warm-up precedes 20 measured iterations. Each iteration parses and validates all three payloads below; the measurements are aggregate, not individual payload timings.

| Payload | Actual serialized UTF-8 bytes | Shape |
| --- | ---: | --- |
| 20 advertised tool descriptors | 1,314,931 | Every input schema is exactly 65,536 bytes, padded with an ASCII description |
| Tool response | 1,048,576 | One MCP-shaped text content item, padded to the exact proposed response ceiling |
| Traversal-heavy JSON | 1,026,001 | 19,000 short string elements, near the shared validator's 20,000-node bound |

Both runtimes rejected an extra tool (21 total), a 1,048,577-byte response, and an array with 20,001 values. The 20-tool list ceiling is explicitly composed around the existing per-tool schema inside the probe; no product service currently enforces this list boundary through this script.

| Measurement | Observed |
| --- | ---: |
| Node elapsed, 20 iterations | 940.03 ms |
| Node process user CPU, same interval | 190.663 ms |
| Node process system CPU, same interval | 50.141 ms |
| Node heap-used end minus start | +58,758,584 bytes |
| Local workerd host-observed round trip, 20 iterations | 275.96 ms |
| Probe Worker bundle | 445,132 bytes |

Node CPU includes runtime/GC work during the interval; host scheduling can inflate wall time. Heap delta includes uncollected garbage and is **not** peak memory or retained object size. Workerd round-trip time includes request serialization, dispatch and response overhead; it is **not** a Cloudflare CPU measurement. No production-edge CPU or memory envelope is established. Padding stresses byte volume; it does not represent all valid JSON Schema complexity, schema compilation, model tokenization or tool execution.

## Deadline and request-driven checkpoint measurements

The peer answers `/fast` immediately and performs its delayed completion 300 ms after receiving `/slow`, even if the caller disconnects. The scratch caller applies a **100 ms test deadline** to real fetch. Scratch SQLite/D1 compare-and-swap statements claim one revision, then persist its result before returning. This test deadline accelerates the experiment; it does not change or validate the product's provisional 30,000 ms timeout.

| Runtime | First step | Explicit continuation | Timed-out step |
| --- | --- | --- | --- |
| Node + SQLite | 43 ms; ready, revision 3, completed 1 | 1 ms; ready, revision 5, completed 2 | 106 ms; outcome_unknown, revision 3, completed 0 |
| local workerd + D1 | 8 ms; ready, revision 3, completed 1 | 7 ms; ready, revision 5, completed 2 | 120 ms; outcome_unknown, revision 3, completed 0 |

These elapsed values cover the peer request and body read, excluding database claim/commit latency. The workerd values come from its runtime clock; they are coarse observations, not a deadline SLA.

Assertions passed in both runtimes:

- One call produces one checkpoint; the 30 ms observation between calls causes no implicit continuation or additional peer request.
- A stale revision cannot dispatch the next step. A new explicit call using revision 3 advances to revision 5.
- Timeout clears the scratch lease and stores `outcome_unknown`; a subsequent call cannot replay that effect.
- The peer completes after caller timeout. Six calls reached the peer and all six completed; only four were confirmed before their callers' deadlines.

The existing [lease probe](probes/lease-runtime.mjs) separately exercises expiry recovery and late completion. This new probe tests a caught timeout and persisted checkpoint, **not** process death, eviction, request cancellation, or a deployed D1 latency/failure scenario. The SQL is scratch-only and is not a product migration or authorization implementation.

## Budget recommendations and unestablished limits

Retain **20 advertised tools** and **1 MiB per response** as implementable initial hard caps: the actual shared validators accepted the boundary workloads and rejected overflow in both target runtimes. Budget at least 1.315 MB for a full set of these descriptors before protocol framing; do not assume a tool count alone limits schema/context size. Enforce aggregate schema bytes and stream response bytes before buffering, then validate parsed JSON. This probe validates objects after parsing and does not supply that streaming transport.

Use **one bounded model/tool step per explicit request** with a durable checkpoint before returning. On a timed-out write or unknown-effect tool, persist uncertainty and require reconciliation; aborting fetch is not evidence that an external effect was cancelled. Preserve revision/lease CAS and never use a background continuation to escape an expired request budget.

Keep the current **8 model turns, 12 tool calls, 30 s tool timeout and 300 s cumulative active time provisional**. Local parsing and a 300 ms peer do not select provider-facing wall-clock budgets, justify a whole-run foreground request, establish end-to-end throughput, or validate a 30 s Workers CPU allowance. The measured workloads show no local parsing obstacle at the tested caps, while memory headroom and integrated execution remain unproven. Before enabling execution, measure representative integrated steps, remote D1 checkpoint overhead, stream cancellation/limits and real provider latency under separately authorized calls; measure CPU independently from network wall time.

Unresolved: production-edge CPU/peak memory, provider/model tool support and latency, integrated OAuth/MCP transport and streaming limits, per-step wall-clock budget and cumulative-time accounting, eviction recovery and production D1 checkpoint performance.
