---
title: "Phase 8: Complete shared agent APIs and documentation"
status: todo
---

# Complete shared agent APIs and documentation

Priority: P2. Status: pending. Depends on: 3-7. Estimate: 3-4 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/web-documentation.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/packages/cli/src/client.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/scripts/build-public-docs.mjs`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/README.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/architecture.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/README.md`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connector-tools.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/packages/cli/src/connector-commands.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/connectors.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connector-agent-surfaces.test.ts`

## Outcome and requirements

People and external agents discover/use the same first-party connector services with intentionally different management rights. Browser, REST, network MCP, CLI and WebMCP expose consistent schemas/errors/recovery. Documentation is generated from owning sources and does not claim capabilities that have not passed tests.

## Implementation steps

1. Add explicit agentExposure/policy metadata to typed API operations if not already completed in phase 2. Use positive allowlisting for generated WebMCP tools. GET metadata is not automatically safe merely because the HTTP verb is GET. Account/credential/grant/approval APIs remain human-only.
2. Add first-party network MCP tools for granted connection discovery, project source handling, operation preparation/status, and bounded run start/advance/cancel. Every handler reuses the same server checks. Never mirror all remote tools into the global Studio tool namespace or forward the inbound bearer to a third-party server.
3. Add `dsa connections`, `dsa sources`, `dsa connector-operations` and `dsa agent-runs` command groups with explicit subcommand schemas. Setup/approval opens or prints an authenticated human URL; token input is handled only in the human management flow. Polling is read-only; continuation is an explicit action. JSON output keeps server codes and request/operation IDs.
4. Publish clear errors for missing grant, needs_reauthorization, approval_required, revision_conflict, schema_changed, unsupported_protocol, limit_exceeded and outcome_unknown. Ensure error metadata necessary for recovery is actually serialized; existing ApiError currently exposes only code/message.
5. Ensure new routes appear in OpenAPI/playground and schema discovery. Extend test coverage for human-only API calls so a docs endpoint entry cannot accidentally create a self-approval WebMCP tool. API docs may document a restricted endpoint without exposing it as an agent tool.
6. Write docs/connectors.md as the owning product/maintainer guide. Link from docs navigation, architecture, agents and README; document OAuth/app setup, capability support, snapshots, credentials, approvals, protocol matrix, stdio boundary and unknown write outcomes. Avoid duplicating schema inventories.
7. Update beginner guide, public reference/search content, installable agent skill, and CLI examples. Clearly separate incoming Studio MCP from outgoing MCP connections. Explain real provider/model support and export limitations.
8. Regenerate via normal build: build CLI, typecheck, npm run build and pack skill. Verify generated Markdown/OpenAPI/llms/sitemap reflect source changes. Never hand-edit dist or bundled renderer/viewer artifacts.

## Todo

- [ ] Complete explicit agent-safe API exposure policy.
- [ ] Add shared MCP/CLI/WebMCP connection/source/run operations.
- [ ] Verify useful typed recovery errors and schema parity.
- [ ] Update owning docs, public guide/reference and agent skill.
- [ ] Rebuild generated references and verify links/examples.

## Validation and success

Run `npm run build:cli`, `npx tsx --test tests/connector-agent-surfaces.test.ts tests/cli.test.ts tests/security-boundaries.test.ts`, `npm run typecheck`, `npm run build`, `npm run pack:skill`, then `npm run test:e2e -- tests/public-docs.spec.ts --project=desktop`.

A parity matrix must map each action to REST, UI, CLI, incoming MCP and WebMCP: implemented, human handoff, or intentionally unavailable with reason. Test denied self-approval, secret/grant management, old-token access, run continuation and same error across clients. Documentation-only checks never invoke real connectors/providers.

## Risks and rollback

Generic WebMCP generation is a real escalation path if new endpoints are merely appended. Close it before exposing new routes. Keep versioned compatibility for existing public APIs; connector feature disable must yield documented errors instead of missing or misleading tools. Docs reflect implementation status, not plan completion.
