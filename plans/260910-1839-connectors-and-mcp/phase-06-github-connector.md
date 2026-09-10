---
title: "Phase 6: Add selected GitHub sources and React export PRs"
status: todo
---

# Add selected GitHub sources and React export PRs

Priority: P2. Status: pending. Depends on: 2, 4, 5. Estimate: 4-6 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/github-login.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/react-export.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/exports-agent-formats.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/node.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/compose.yaml`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connections-settings.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connector-source-picker.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connector-operation-dialog.tsx`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/github.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/github-auth.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/github-export.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/github-destination-picker.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/github-connector.test.ts`

## Outcome and requirements

Use a GitHub App for selected repositories without changing the current GitHub login OAuth app. Read selected project source files pinned to a commit; export real React project files into a new branch and PR. No merge, force-push, arbitrary repository execution, workflow editing or default-branch push.

## Implementation steps

1. Configure GitHub App ID, signing key, webhook secret and connector callback as separate named settings. Reuse verified sign-in utilities only where semantics match; never widen its read:user/user:email scope. Verify human identity/installation access through GitHub before binding an installation_id from a callback; do not trust a URL ID.
2. Request repository metadata/contents read for source access. Explain GitHub App installation permission upgrades honestly: write support may require app-level contents/PR permission approval, not a pretend per-tool OAuth scope. Local project policy still separates reads and writes.
3. Mint short-lived installation tokens for allowed repositories; never expose the app private key to users or tools. Confirm selected repo access and authenticated installation authorization. Validate webhook signatures and replay/delivery IDs for uninstall/suspend/repository-access changes; also handle API denials without waiting for a webhook.
4. Implement repository/ref/path selection. Resolve branch to SHA before reading; pin snapshots to commit/blob IDs. Fetch bounded UTF-8 Markdown/text/JSON and supported image bytes. Reject traversal, symlink/submodule following, ignored secret paths and unsupported binary content; never run code from a repo.
5. Extract/reuse the real React export service, preserving document/asset ownership and expectedRevision. Safely materialize ZIP entries with size/count/path bounds. Select target repo/base/path, compute a file diff and list unsupported changes before approval; do not delete unrelated files or include workflow/credential files.
6. Create a new operation-specific branch and atomic commit tree from the approved base SHA, then a PR. Record remote branch/commit/PR identities durably at each stage. Recheck relevant local revision/policy and remote base conditions; stale approvals require a refreshed diff.
7. Reconcile partial failures by known branch/ref/commit/PR identity. Unknown outcomes are not retried blindly. An internal idempotency key does not replace GitHub-side reconciliation. Leave user-visible partial artifacts with recovery guidance rather than deleting them automatically.
8. Add repo/ref/destination UX and human/agent capability descriptors through the shared service. Verify tenant/installation isolation even when two Studio users reference the same organization.

## Todo

- [ ] Add independent GitHub App authentication and verified installation binding.
- [ ] Add selected repo/file sources pinned to immutable SHA.
- [ ] Produce reviewed real React file diffs and branch/PR writes.
- [ ] Add webhook revocation and partial-write reconciliation.
- [ ] Complete provider-specific UX/reference and acceptance tests.

## Validation and success

Run `node scripts/build-renderer.mjs`, then `npx tsx --test tests/github-connector.test.ts tests/exports-agent-formats.test.ts tests/security-boundaries.test.ts` and `npm run typecheck`. Controlled GitHub HTTP contracts cover paths, permissions, rate limits, partial success, duplicate requests and base movement.

Live acceptance uses an explicitly authorized disposable repository/app installation: read an actual file, inspect exported React files, open the created PR, verify no default-branch mutation, retry the same operation and observe the same result. Record actual URLs/SHAs without private file contents or tokens. Do not call local test success live GitHub success.

## Risks and rollback

GitHub organization approval may delay external verification. Disable the adapter or revoke its installation token without breaking sign-in. Disconnect blocks future calls; preserve PRs/files already created unless the user separately requests cleanup. Existing GitHub login/account linking must retain its tests.
