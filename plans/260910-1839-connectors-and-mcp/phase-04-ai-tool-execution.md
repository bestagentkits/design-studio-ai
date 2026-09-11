---
title: "Phase 4: Run connector tools inside design conversations"
status: in-progress
---

# Run connector tools inside design conversations

Priority: P2. Status: in progress. Depends on: 2, 3. Estimate: 5-8 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/providers.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/briefs.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/conversations.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/observability.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/schema.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/provider-capabilities.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/briefs.test.ts`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/providers.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/agent-runs.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/agent-run-store.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/agent-tool-executor.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/provider-tool-messages.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/agent-runs.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/provider-tool-calling.test.ts`

## Outcome and requirements

AI can use project-enabled tools and sources, wait for exact human approval, resume after reload and return a normal validated design proposal. Existing `/generate` without connectors remains compatible. Implement tool calling across the existing OpenAI, Anthropic, Gemini and OpenRouter adapters where the selected model supports it; expose an honest unsupported-model fallback.

## Implementation steps

1. Extract provider request/response normalization only where required, preserving existing text completion. Represent model turns, tool-call IDs, tool results, usage and errors without losing multi-call correlation or structured content. Verify each provider's current official tool-calling API before implementation.
2. Implement persisted run and step records with owner/principal, selected model, pinned source versions, base document/brief revision, policy snapshot and explicit budgets from phase 1. Authenticate/grant-check every advance; GET must not create side effects.
3. Use start/advance POST for bounded work with lease/CAS and persisted continuation. Execute model/tool steps serially initially. Prevent concurrent tabs from dispatching one step twice. Closing the UI pauses work at a checkpoint; reload reads state and continues explicitly.
4. Discover a bounded set of relevant enabled tools on demand; use stable connection-specific names and descriptions. Do not put all remote schemas or all source contents in every prompt. Treat retrieved text as quoted external context and record provenance/citations.
5. Validate tool arguments and allowed data flow locally, then route calls to the common operation service. Pending approvals are server-owned actions with exact payload/target; model text or remote elicitation cannot approve them. Returned tool data cannot widen connection policy or access another connector's credentials.
6. Preserve canonical provider tool-call/result ordering, including errors. Handle unsupported tool models, invalid JSON/schema, empty results, repeated calls, rate limits, revoked connection and context/budget exhaustion. Reauthorization resumes only after revalidating principal and project state.
7. Recheck saved brief approval/revision and document revision before generating or accepting a proposal; reject stale runs with a conflict. The resulting document still passes documentSchema and validateAssets, keeps identity/kind and requires explicit saveDocument revision checks.
8. Persist private content separately from metadata-only activity. Surface real per-step usage and unknown provider cost. Cancellation aborts local work where possible and marks accepted-but-unconfirmed remote effects honestly. Never retry an ambiguous write as a new call merely because the model requested it again.

## Todo

- [x] Add provider-normalized tool messages and capability detection.
- [x] Add durable request-driven runs, budgets and execution leases.
- [x] Integrate tool selection, provenance and operation approvals.
- [x] Preserve brief/document concurrency and validated proposal output.
- [x] Add cancellation, reconnect, interrupted/unknown outcome recovery.

Implementation checklist verified at code `085732a`; see [verification](reports/verification.md). Live provider/model acceptance and general enablement remain tracked in phase 9.

## Validation and success

Run `npx tsx --test tests/agent-runs.test.ts tests/provider-tool-calling.test.ts tests/briefs.test.ts tests/provider-capabilities.test.ts`, then `npm run typecheck`. Controlled provider responses test wire contracts only. Separately verify actual model tool calling with authorized provider credentials before advertising that model as supported.

Test multiple tools and IDs, invalid tool name/arguments, grants revoked mid-run, stale brief during a tool pause, browser reload, concurrent advance, timeout after a write, self-approval attempts, cross-connector content exfiltration attempts, budget limits and unsupported-model fallback. A completed run cannot silently save, publish or approve scope.

## Risks and rollback

The existing completion path is single-round JSON; preserve it for non-connector requests and as the feature-disabled behavior. Do not create a pretend agent runtime around text matching. Leave incomplete runs inspectable/cancellable when execution is disabled; no untracked background processes or promises.
