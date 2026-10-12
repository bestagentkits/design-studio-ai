# Code review: MCP ChatGPT discovery fix (issue #92)

## Scope
- Files: server/mcp.ts, server/mcp-protocol.ts (new), server/mcp-tool-schemas.ts (new), tests/mcp-chatgpt-connector.test.ts (new), scripts/smoke-production.mjs, docs/agents.md, docs/architecture.md, skills/design-studio-ai/SKILL.md, src/app/documentation.tsx, package.json, package-lock.json
- Focus: uncommitted diff, read-only
- Checks run: `npm run typecheck` passed. `npx tsx --test tests/mcp-chatgpt-connector.test.ts` passed (5/5). MCP-adjacent suites (agent-capability-parity, discovery, community-agent-parity, observability-parity, custom-providers): 14 passed, 2 failed. Both failures came from the missing Playwright Chromium binary, not from this change. The local Node is v22.22.0, while package.json `engines` requires >=24.
- I also ran an in-process probe (scratchpad, `app.request` with an API token) and captured a CPU profile.

## Overall assessment
The protocol bridge covers the spec checks that matter (header/_meta mismatch -> 400/-32020, unsupported version -> 400/-32022, -32601 -> 404, base64 `Mcp-Name`, `server/discover` shape). Legacy `initialize` clients still work. `tools/list` drops to about 63 KB. Auth runs before the body is read. I found no validation bypass: oversized arguments are parsed once against the full zod schema, and normal-sized arguments are parsed once by the SDK.

The main problem is per-request CPU cost. On top of that, the diagnostic log hides that cost and can carry unbounded client strings.

## High

### H1. Every /mcp request now spends about 300 ms of CPU converting zod schemas to JSON Schema, including `server/discover` and rejected requests
- Location: server/mcp.ts:71-78 (`compactToolInput` runs in the per-request `registerTool` wrapper); server/mcp-tool-schemas.ts:99-112 (`z.toJSONSchema` runs for every argument of every tool, and runs again inside `placeholder` for oversized arguments).
- Evidence: in the in-process probe, an authenticated `GET /mcp` (which returns 405 before tool registration) took 3.6-5.3 ms. `server/discover` took 296-575 ms, and every `tools/call` took 300-400 ms. The CPU profile puts 3,967 ms of inclusive time in `compactToolInput` (3,824 ms of it in `toJSONSchema`) across about 13 requests. Only about 5 ms was in `dispatchMcpRequest` and 5 ms in the SDK `handleRequest`.
- Failure scenario: ChatGPT sends `server/discover`, then `tools/list`, then calls tools. Each POST builds a new McpServer and re-derives about 1 MB of JSON Schema just to measure it, even when `dispatch` already holds a finished response (discover, header mismatch, notification 202). Every call gets 300+ ms of added latency, Workers CPU billing goes up by roughly 25x for MCP traffic, and concurrent agents compete for CPU. The cap is `cpu_ms: 30000` in wrangler.jsonc, so a single request will not hit a hard failure, but this regresses every existing MCP client as well.
- Fix:
  1. Memoize per schema object. The schemas are module-level constants, so cache by identity: `const sizeCache = new WeakMap<z.ZodType, number>()`, and cache the placeholder result in the same way. Compute the JSON Schema once, not twice.
  2. Return early when `'response' in dispatch`, before constructing `McpServer` and registering about 100 tools.

### H2. The diagnostic `durationMs` leaves out the cost from H1
- Location: server/mcp.ts:601 sets `const started = Date.now()` after all registration.
- Failure scenario: the new `mcp_request` log line reports `durationMs: 13` for a request that took about 330 ms (confirmed in the test output). Anyone using this line to diagnose ChatGPT timeouts will be misled.
- Fix: capture `started` at the start of `handleMcp`, or log the registration time and the dispatch time as separate fields.

## Medium

### M1. The log line contains unbounded, client-controlled strings
- Location: server/mcp.ts:623 together with server/mcp-protocol.ts:41-46. `method` comes from the request body. `protocolVersion` is `metaVersion ?? header`, where `metaVersion` is any string in `_meta`.
- Failure scenario: an authenticated token holder sends `method` or `_meta["io.modelcontextprotocol/protocolVersion"]` as a multi-MB string. The body limit is 21 MB (server/index.ts:102). The request is rejected, but `console.info` still writes the whole string to Workers/Node logs. This lets a caller inflate logs and push other entries out of retention. JSON.stringify prevents line injection, but the size is not bounded.
- Fix: log `method` only when it is in a known set, otherwise `"other"`. Truncate `protocolVersion` to about 32 characters, or log it only when it is in `supportedProtocolVersions`.

### M2. `get_tool_schema` returns about 290 KB, which is the size this change set out to avoid
- Location: server/mcp-tool-schemas.ts:123-130. The test log shows `responseBytes: 296895` for `{tool:"patch_document", property:"operations"}` and 135,275 for `create_project`.
- Failure scenario: the ChatGPT model sees `operations: array<unknown>` with an instruction to call `get_tool_schema`. It calls it and gets a roughly 300 KB tool result. That can exceed the host's tool-output or context budget (the failure mode in issue #92 came from the same tool family), so the recovery path the tool description points to may be unusable in practice. This is the AX priority from AGENTS.md.
- Fix: make lookup finer-grained. For example, accept `variant`/`op` (one `oneOf` branch or one `$defs` entry), or return a list of variant names first with per-variant schemas on demand. Add a test that keeps each `get_tool_schema` response under the same 256 KB budget.

### M3. The trusted-origin list is hard-coded and does not use the existing `TRUSTED_ORIGINS` configuration
- Location: server/mcp.ts:35 and :44. Compare server/index.ts:123-126 (`TRUSTED_ORIGINS` env) and docs/deployment.md:29.
- Failure scenario: the next hosted connector (or a self-hoster's own gateway) sends a different `Origin`, e.g. `https://claude.ai`, gets 403, and needs a code change and deploy. Operators also cannot narrow the allowlist. Security impact is low: `authenticate` (server/security.ts:74-97) only marks Bearer credentials as `authMethod: "token"`, and a cookie session can never reach MCP, so the comment's claim holds.
- Fix: add an env-configurable MCP list (or document why ChatGPT is built in) and document it next to `TRUSTED_ORIGINS` in docs/deployment.md. docs/architecture.md still says "independent Origin validation" and does not mention the third-party allowlist.

## Low

### L1. `get_tool_schema` with an inherited property name leaks an internal exception
- Location: server/mcp-tool-schemas.ts:127 (`entry.full[property]` on a plain object).
- Probe result: `{tool:"patch_document", property:"constructor"}` (or `"toString"`) returns `isError` with text `Cannot read properties of undefined (reading 'def')`, instead of the intended "has no argument" message plus the property list.
- Fix: `const schema = Object.hasOwn(entry.full, property) ? entry.full[property] : undefined;`

### L2. Modern-shaped requests that declare a legacy version are served as modern
- Location: server/mcp-protocol.ts:45 and :52. `supportedProtocolVersions` includes the legacy versions.
- Probe result: `_meta` version `2025-11-25` with matching headers and no `initialize` is answered with `resultType` and serverInfo `_meta`. `server/discover` also advertises the legacy versions in `supportedVersions`, so a modern client may legitimately pick `2025-11-25` and get modern-shaped answers it did not ask for.
- Impact: ChatGPT uses 2026-07-28, so it is not affected.
- Fix: in the modern branch, accept only `modernProtocolVersions`, and return -32022 with `supported` for the rest.

### L3. Notifications must carry `_meta`
- Location: server/mcp-protocol.ts:62-63. A notification with a 2026 header but no `_meta` returns 400 -32602.
- Spec: "header requirements for notification POSTs are not defined by this revision", and core defines no client notifications over HTTP. So this is harmless today but stricter than the spec.
- Fix: move the `single.id === undefined` -> 202 check above the `_meta` requirements.

### L4. `forward()` copies the original `Content-Length` onto a re-encoded body
- Location: server/mcp-protocol.ts:28-31.
- Failure scenario: `raw.text()` strips a UTF-8 BOM and replaces invalid bytes with U+FFFD, so the forwarded body length can differ from the copied header. The tests pass on Node; I did not verify behavior on workerd.
- Fix: `headers.delete('content-length')` in `forward`.

### L5. Unrelated churn in package-lock.json
- Many `"peer": true` flags were removed. This looks like a different npm version rewriting the lockfile and is unrelated to the `ajv` devDependency. Regenerate the lockfile with the toolchain from `engines` (Node >=24) so the diff contains only `ajv`.
- The test comment "Ajv ships as a dependency of the MCP SDK" contradicts adding ajv as an explicit devDependency. One of the two should go.

### L6. Hard-coded server version now appears in discovery
- `serverInfo.version` is the hard-coded "0.4.2" (server/mcp.ts:37), but package.json is 0.4.3. This existed before, but it is now also published through `server/discover`.

## Verified non-issues (evidence)
- **Validation bypass.** Oversized arguments are advertised as `z.record`/`z.array`/`z.unknown` placeholders, and then `validateHeavyArguments` parses them with the full schema before the handler runs (mcp.ts:82-83). This is covered by the invalid `patch_document` and `create_project` cases in the test. Normal-sized arguments are parsed once by the SDK and never re-parsed, so transforms do not run twice. Tools without an input schema are not wrapped (`isShape(undefined)` is false), so `args[0]` (`extra`) is never treated as arguments. The observability/design-system/community helpers register through the patched `server.registerTool`.
- **Auth ordering.** Origin -> auth -> method -> body read. Unauthenticated callers never reach dispatch or logging.
- **Legacy behavior.** Without a modern header or `_meta` version, requests are forwarded unchanged. The removed `unsupported_protocol` error code has no dependents (grep). Legacy unknown headers now get JSON-RPC -32022 instead of the app error envelope, which is acceptable.
- **Spec behavior.** Unknown method -> 404 -32601. Bad base64 `Mcp-Name` -> 400 -32020. `Accept: application/json` alone -> SDK 406, which matches the spec "client MUST list both". Unknown tool -> `isError` result.
- **Docs.** The llms.txt and llms-full.txt files are generated from documentation.tsx (scripts/build-public-docs.mjs:131-132), so they need no hand edits.
- **Concurrency.** No shared mutable state: the server, the `toolInputs` map and the span are per request, and the module-level constants are read-only.

## Recommended actions
1. H1: cache schema sizes and placeholders at module scope, and return the dispatch response before building the server.
2. H2: measure the duration from the start of `handleMcp`.
3. M1: bound or allowlist the logged `method` and `protocolVersion`.
4. M2: make `get_tool_schema` granular and add a size-budget test.
5. M3: make the trusted MCP origins configurable and documented.
6. L1-L5: small fixes. Regenerate the lockfile with Node 24.

## Unresolved questions
- Which `Origin` did ChatGPT actually send in the 403 evidence? It decides whether `chat.openai.com` is needed.
- Does ChatGPT enforce a size limit on tool results? It decides how urgent M2 is.

Status: DONE_WITH_CONCERNS
Summary: The protocol bridge and argument validation are correct, and typecheck and the focused tests pass. The change adds about 300 ms of CPU to every MCP request through per-request schema compaction (H1), which the new duration metric hides (H2). Smaller issues: the diagnostic log takes unbounded client strings, and the `get_tool_schema` recovery path returns about 290 KB.
