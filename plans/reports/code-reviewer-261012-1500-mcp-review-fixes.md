# Re-review: MCP ChatGPT discovery review fixes (issue #92)

An isolated reviewer checked how each finding in [the first review](code-reviewer-261012-1435-mcp-chatgpt-discovery.md) was fixed. The reviewer then reported new findings; the controller resolved them as listed below.

## First-review findings

| Finding | Verdict | Evidence |
| --- | --- | --- |
| H1 per-request schema conversion | Fixed | `server/discover` and rejected requests return before the server is built. Conversions and placeholders are cached by schema identity, keyed on the inner schema of an undescribed `.optional()` wrapper. |
| H2 duration measured late | Fixed | `started` is taken on the first line of `handleMcp`. |
| M1 unbounded log strings | Fixed | `method` is logged only if allowlisted, otherwise as `other`. `protocolVersion` is logged only if it is a supported version, otherwise as `unsupported`. |
| M2 `get_tool_schema` answered with about 290 KB | Fixed | Schemas over 16 KB return an outline with `$pointer` stubs, and a `pointer` argument reads one part. Across 30 calls that walked every pointer, the largest answer was 14.7 KB. |
| M3 hard-coded origins | Fixed | `/mcp` also accepts `TRUSTED_ORIGINS` (documented in deployment.md). Bearer-only authentication is unchanged. |
| L1 to L6 | Fixed | Properties are looked up with `hasOwn`. Modern requests accept modern versions only. Notifications return 202 before the `_meta` checks. Forwarded requests drop `Content-Length`. The lockfile diff is only the `ajv` line. The server version is read from `package.json` (#93). |

## New findings and resolution

| Finding | Resolution |
| --- | --- |
| N1 (medium): `.optional()` wrappers miss the cache | Cache key unwraps undescribed optionals. A regression test asserts that conversions are reused. Request time is now a median of 10 ms; it was about 300 ms before the fixes. |
| N2: whole-tool schema not cached | Cached by tool name. |
| N3: outline size not guaranteed | Falls back to stubbing every child. Test budget is tightened to 24 KB per answer. |
| N4: `#/` fragment pointers rejected | Fragment form is accepted and percent-decoded. |
| N5: transport exception is not marked as an error in telemetry | Sets `telemetryErrorCode = mcp_internal_error`. |
| N6: AGENTS.md change included | Kept intentionally: the issue requested the label workflow in AGENTS.md. It is a separate commit. |
| N7: unclear docs wording | Reworded to say the placeholder "points to `get_tool_schema`". |

Status: DONE
