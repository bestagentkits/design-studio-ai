---
title: "Phase 1: Freeze contracts and prove runtime feasibility"
status: todo
---

# Freeze contracts and prove runtime feasibility

Priority: P2. Status: pending. Depends on: none. Estimate: 3-5 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/README.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/architecture.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/providers.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/security.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/oauth.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/package.json`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/package-lock.json`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/wrangler.jsonc`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/package.json`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/package-lock.json`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/connectors.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/agent-runs.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connector-contracts.test.ts`

## Outcome and requirements

Freeze shared connection/source/action/run schemas and resolve transport risks before UI/backend implementation. This phase produces real isolated probes during implementation; no probe has been run during planning. Preserve the existing inbound MCP endpoint, provider interfaces and document schema.

## Implementation steps

1. Recheck HEAD/status, migrations and dependencies. Create a work branch without discarding other work. Install both dependency trees with npm using Node >=24 if missing. Current checkout has no installed SDK to inspect; lockfile/package declarations alone do not prove support.
2. Build an ephemeral remote MCP interoperability probe in the plan reports/scratch area. Exercise 2025-11-25 HTTP lifecycle and 2026-07-28 discovery/call profile, OAuth, JSON/SSE responses, disconnect and unsupported-version errors. Inspect current SDK exports and select/pin a compatible released client; preserve server SDK behavior, using an isolated dependency only if required.
3. Test the same client boundary in Node and Cloudflare's actual runtime. Record imports, bundle size, compatibility, CPU/memory/time limits and whether request-scoped transports can close without invalidating ongoing calls. Do not assume the existing server-only SDK usage proves client compatibility.
4. Prove safe custom-origin egress at connection time: rebinding, private/loopback/link-local/mapped IPv6, DNS CNAME changes, malicious OAuth discovery and credential-bearing redirects. Node requires a public-resolved-address-pinned connection; verify Cloudflare's guarantees empirically and against platform documentation. Record a concrete solution or the gateway decision required before custom URLs can ship.
5. Test bounded request-driven model/tool steps and lease recovery against D1-compatible SQL. Confirm the existing 30-second CPU setting is distinct from wall-clock network waits. Select budgets and checkpoint boundaries from measurements, not from an imaginary background worker.
6. Define Zod schemas for the entities and state transitions in architecture.md, including stable principal, policy revision, request/run ID, idempotency key, provenance, action fingerprint, errors and continuation status. Keep the design document untouched.
7. Record decisions and actual compatibility matrix in reports/runtime-probes.md; update dependent phases if new evidence requires a design change. Product scope changes or new gateway operating costs require an explicit decision, not silent omission.

## Todo

- [ ] Verify checkout/dependencies and pin protocol support with regression strategy.
- [ ] Prove Node/Cloudflare egress and OAuth discovery safety.
- [ ] Prove continuation/lease behavior and choose measured budgets.
- [ ] Add shared schemas and focused validation tests.
- [ ] Record probe results and remove abandoned scratch processes/artifacts.

## Validation and success

Run `npx tsx --test tests/connector-contracts.test.ts` and `npm run typecheck` after code exists. Use isolated test servers/accounts only, with deterministic ports and tracked PIDs. Record actual remote-protocol and Cloudflare probe commands/results. Schemas reject inconsistent state, unsafe references, unbounded payloads and unknown authorization fields.

Pass only when every claimed runtime/profile is backed by an executable probe. An unsupported profile or unproven public egress remains a blocking dependency for phase 3, not a successful degraded implementation.

## Risks and rollback

SDK replacement can change inbound MCP behavior; keep migration isolated and run existing MCP/auth tests. No persistent production data changes here. Roll back only newly introduced package/schema changes if probes fail; do not upgrade unrelated dependencies. External documentation is rechecked at execution time.
