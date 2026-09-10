---
title: "Phase 3: Connect remote MCP servers and expose bounded capabilities"
status: todo
---

# Connect remote MCP servers and expose bounded capabilities

Priority: P2. Status: pending. Depends on: 1, 2. Estimate: 5-7 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/oauth.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/providers.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/connectors.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connection-policy.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connector-transport.ts`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connections.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/node.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/compose.yaml`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/mcp-client.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/mcp-auth.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/mcp-catalog.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/mcp-content.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/mcp-connector.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/mcp-connector-auth.test.ts`

## Outcome and requirements

A user can add a remote HTTPS server, authenticate, discover/select capabilities, read resources and execute a permitted tool with traceable results. Use the phase 1 support matrix; do not expose stdio/command execution. Third-party instructions/descriptions/results remain untrusted data.

## Implementation steps

1. Implement a request-scoped client adapter using the verified SDK profiles. Isolate session/resumption data by connection/user for older servers and close owned transports deterministically. Distinguish transport/version incompatibility from credentials or missing capabilities.
2. Implement anonymous, encrypted bearer and OAuth modes. Follow protected-resource and authorization-server discovery, canonical resource binding, issuer validation and exact callbacks. Support CIMD, pre-registered clients and legacy DCR as required by the selected profile; user consent is required for step-up scopes.
3. Separate connect, authenticate, discover and first successful tool call states. Metadata can succeed when tool access is denied. Handle denied consent, missing refresh token, expiry, revocation, org restrictions and a changed account identity without overwriting another connection.
4. Fetch paginated tools/resources/templates within bounded catalog/schema limits. Validate supported JSON Schema locally without remote references. Cache per owner/credential/policy and fingerprint security-relevant definitions. Bind tool IDs to connection + original name, preventing collisions across servers.
5. Execute only locally enabled tools through the common operation policy. Show actual arguments, destination server and local authorization status; unknown custom tools require confirmation even when annotations claim read-only. Check policy changes immediately before dispatch.
6. Decode text/structured content and bounded supported image/audio/resource results safely. Tool errors are errors, not successful text. Resource links require a separate allowed read; never render returned executable HTML or forward credentials indiscriminately.
7. Handle version-appropriate input requests through persisted user-input state where supported. Unsupported extensions return a clear error. Remote prompts may be manually selected as data templates; they do not replace the Studio system policy. No automatic sampling, filesystem roots or remote UI execution.
8. Publish typed first-party capability/operation schemas for callers without blindly re-exporting every remote tool into Studio's incoming MCP namespace. Add focused metadata, permission and resource round-trip tests before downstream chat integration.

## Todo

- [ ] Implement verified HTTP profile adapter and transport cleanup.
- [ ] Implement OAuth/bearer/anonymous auth and recovery.
- [ ] Implement bounded catalog discovery, namespace and schema fingerprinting.
- [ ] Execute tools and read resources through shared policy.
- [ ] Preserve errors, safe content, input-required state and provenance.

## Validation and success

Run `npx tsx --test tests/mcp-connector.test.ts tests/mcp-connector-auth.test.ts tests/connector-policy.test.ts` and `npm run typecheck`. A controlled real HTTP MCP peer must exercise auth/lifecycle, pagination, malicious schema/result, timeouts, list changes, same-named tools, stale credentials and redirect/SSRF boundaries.

Before claiming interoperability, separately connect a designated real third-party HTTPS server using authorized test credentials and record supported profile, actual tools, read result and disconnect. Repeat the transport smoke in Cloudflare. Deterministic peer tests do not establish third-party account access.

## Risks and rollback

Remote servers can change behavior without schema changes; annotations cannot establish trust. Unknown writes can have uncertain outcomes. Disable an individual connection/adapter without disabling native Studio operations; do not silently downgrade to unrestricted raw fetch or bearer passthrough when OAuth fails.
