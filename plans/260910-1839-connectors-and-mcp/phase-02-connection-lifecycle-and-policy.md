---
title: "Phase 2: Persist connections, project permissions and operation state"
status: in-progress
---

# Persist connections, project permissions and operation state

Priority: P2. Status: in progress (local foundation; routes not enabled). Depends on: 1. Estimate: 5-7 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/security.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/github-login.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/node-adapters.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/observability.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/migrations/0001-initial.sql`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/security-boundaries.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/briefs.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/security.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/node.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/compose.yaml`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/wrangler.jsonc`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/browser-design-tools.ts`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connections.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connection-store.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connection-policy.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connector-credentials.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connector-operations.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/project-sources.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connector-transport.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connections.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connector-policy.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connector-operations.test.ts`

## Outcome and requirements

Implement the shared service before individual providers. Add new domain-named migrations for the architecture entities, assigning the next available number. Connections support multiple accounts and explicit project bindings. Metadata APIs never reveal secrets. Keep source revisions separate from brief and document revisions.

## Implementation steps

1. Add relational constraints/indexes for owner/resource linkage, policy/credential revisions, operation idempotency and execution leases. Exercise both a fresh database and upgrade from the current migration set. Do not assume D1 exposes arbitrary interactive transactions; use batch and guarded statements supported by both adapters.
2. Extend authenticated context with api_tokens.id or OAuth client_id/family without returning token hashes. Enforce the architecture permission matrix at service entry and before dispatch. Existing API keys and `studio` OAuth tokens acquire no automatic connector grants.
3. Add session-bound connection setup/update/disconnect and grant-management routes; use existing CSRF checks and strict ownership. Agent callers receive a bounded human setup URL when needed. Auth setup cannot accept an arbitrary callback/return URL or tokens through query parameters.
4. Reuse AES-GCM with the existing ENCRYPTION_KEY for credentials and private run payloads. Implement refresh lease/CAS, rotation, revocation and disconnect races. Keep metadata status distinct from verified provider access; reject completion writes if the connection revision changed.
5. Implement operation prepare/decision/claim/finish/cancel with atomic one-use approval and execution leases. Bind approval to canonical arguments, tool/schema version, project/brief/source versions and policy. Expired or changed approval fails without dispatch. Unknown remote outcomes remain unknown until reconciled.
6. Implement private immutable source storage, fetch provenance, bounded ingestion and explicit refresh. Use projectRow/storeAsset/validateAssets where appropriate. Define owner deletion, project deletion, clones, disconnect, source removal and cleanup of partial object writes; credentials/grants never clone.
7. Implement the proven transport from phase 1, including all discovered auth/resource/download URLs and header restrictions. Metadata/OAuth/body limits and timeouts apply before parsing; no credential redirects or arbitrary JSON Schema reference fetches.
8. Add allowlisted operation telemetry (IDs/action/status/duration/error code, nullable usage), never arguments/prompts/token-bearing URLs. Private run payloads have explicit maximum size and retention; proposed default is 7 days after terminal state, cleaned on maintenance/start without requiring a new daemon. Snapshots persist until source/project removal.
9. Add typed API reference entries only with an explicit agent-exposure field. Update browser tool generation immediately to exclude connection secret management, grants and approvals; do not wait until the final docs phase to close this boundary.

## Todo

- [x] Add and verify forward-only migrations and indexes.
- [x] Enforce human/API-key/OAuth/WebMCP/internal-run boundaries.
- [x] Implement credential refresh/revoke/disconnect races.
- [x] Implement exact approval, idempotency and unknown-outcome state.
- [x] Implement snapshot lifecycle, cleanup and clone rules.
- [x] Integrate safe transport, metadata-only telemetry and API exposure policy.

Implementation checklist verified at code `085732a`; see [verification](reports/verification.md). Live provider/model acceptance and general enablement remain tracked in phase 9.

## Validation and success

Run `npx tsx --test tests/connections.test.ts tests/connector-policy.test.ts tests/connector-operations.test.ts tests/security-boundaries.test.ts`, then `npm run typecheck`. Use real temporary SQLite/FileBucket and controlled HTTP peers; test doubles are contract fixtures, never live-provider evidence.

Cover owner crossing, two accounts, forged IDs, stale grant, revoked token family, reconnect identity change, concurrent refresh, parallel approval consumption, process interruption, project deletion, clone isolation and secret redaction. Verify Cloudflare persistence semantics in an isolated environment. A caller cannot approve its own operation by choosing a header or JSON field.

## Risks and rollback

No public rollout until policy/egress tests pass. Disable new connection creation/execution through server-side configuration while preserving old project features and readable metadata. Preserve migration data/encryption key; code rollback must tolerate added tables. Revocation cannot retract already accepted remote writes; UI must report this limit.
