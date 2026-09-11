# Phase 02 — Canonical v2, asset lifecycle and revision safety

Status: in progress. Priority: P1. Provisional effort: 7–10 engineering days.
Dependencies: Phase 01 engine/model feasibility and resource/retention decisions.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

Current implemented subset and remaining gates: [production integration](reports/production-integration.md). Open checklist rows contain requirements beyond the current slice; they are not silently waived.

## Requirements and design

Implement one canonical v2 with typed boards/elements, painting manifests/layers/masks and explicit embed references; retain valid v1 unchanged until committing a new feature. Keep schema version, project revision and brief revision distinct. A stored v2 project rejects v1 PUT/merge even when the supplied project revision is current. Read the current stored row, require caller expectedRevision to equal its observed revision, inspect its version, then condition CAS on that same observed revision; guessed future revisions cannot skip the guard.

Use atomic coupled connector records and painting-wide generation checks for pixel/settings changes. Different paintings and independent Board edits may merge only with unchanged dependencies. No disjoint-tile merge requirement. Tiles are immutable owned 512px lossless assets; preview hashes cover every contributor.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/document-merge.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/collaboration-contract.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/design-systems.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/design-system-library.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/catalog.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/file-formats.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/scene-view.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/collaboration.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/design-systems.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/node-adapters.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/architecture.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/deployment.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/document.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/collaboration.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/regressions.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/design-systems.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/security-boundaries.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/document-upgrade.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/board-schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/painting-schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/document-asset-references.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/board-operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/painting-operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/asset-lifecycle.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/painting-transactions.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/migrations/0009-asset-lifecycle.sql`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/document-v2.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/asset-lifecycle.test.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Reconciled 2026-09-11 against [current source and local evidence](reports/implementation-checklist-reconciliation.md). Checked rows record implemented behavior, not full device, cross-surface, format or release acceptance. Unchecked compound rows retain their unverified requirements.

- [x] Add discriminated version readers, a pure v1 upgrade and shared semantic validators; preserve IDs, layouts, kind and metadata. Enforce board/group/mind-map rules separately from valid cyclic general graphs.
- [x] Inventory every version consumer: CLI schema assertion currently expects const 1; browser JSON import rejects non-v1; scene fallback constructs v1; design-system compositions construct v1 with empty assets. Preserve v2 boards/paintings on system apply/insert; explicitly reject unsupported new library compositions before stripping fields.
- [x] Reject Board/Paint-dependent reusable composition capture before save in both shared validation and library UI; explain unsupported library packaging. Preserve existing token application and v1 composition insertion into v2 documents. Keep editable page embedding fully supported; test these three paths independently.
- [x] Add stored-version downgrade guards to both save and merge, bound to the observed database row revision rather than trusting a caller-supplied future number. Advertise true versions/operations in schema resources and actionable upgrade errors; do not flatten GET responses for old clients.
- [x] Implement a typed reference collector/remapper across existing URLs/node src/3D texture IDs and Board/GIF/tile/mask/brush/composite references. Use it for ownership validation, duplicate/clone/import/publication/export; ordinary duplicate copies content, linked insertion is explicit. Public snapshots serialize a sanitized render projection with only needed visible assets; do not publish full private manifests, hidden/masked layer bytes or source tile URLs.
- [x] Add staged asset/lease metadata through an additive migration only if required. Proposed 0009 number must be refreshed against current migrations at execution. Preserve ENCRYPTION_KEY and existing storage.
- [ ] Validate decoded dimensions/frame/pixel counts before expensive operations; preflight live assets, storage, dirty tiles, bytes and base+local merge size against current limits. Atomically reserve quota for in-flight uploads/render jobs before admission; release on abort, expire orphan reservations and reconcile committed usage without double-counting. Do not inflate global caps to conceal workload failure.
- [x] Implement validate/stage/CAS/ack transactions with owner/project-scoped operation ID, payload hash and durable status/committed receipt. A repeated ID with the same payload returns the prior result; a changed payload conflicts. Resolve uncertain responses by receipt lookup rather than reapplying pixel work; failed document CAS leaves recoverable staging and never a saved response. Painting-wide generation protects all sampled layers/neighbors/settings; no generic merge of tile hash/asset/generation fields.
- [x] Make undo restore content through a new revision/generation: never decrement painting generation or schemaVersion. Upgrade v1 history entries through the pure upgrade before applying to a v2 document.
- [ ] Retain committed assets conservatively first. Add history/recovery leases and pins for current projects, immutable publications and in-flight commits before enabling GC. Recheck pins against concurrent commit at deletion; expire history explicitly with notices rather than breaking undo.
- [ ] Stage v2-capable readers/render fallbacks before enabling new writes. Add readable recovery/error behavior for unavailable capability; never deploy a v1-only rollback over persisted v2.

## Slice parity and documentation

Before this slice is complete, expose its validated operations and capability/errors through the common server service, REST, MCP, CLI and feature-detected WebMCP. Preserve local-draft versus persisted-state semantics, expected revision and separate explicit brief approval. Update these existing owning surfaces with only this slice's changes:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

Update public content sources, then run `npm run build` to regenerate documentation/llms output. Never hand-edit generated `dist/` or renderer/viewer bundles. Unsupported actions must report a precise capability/version error rather than silently flatten or ignore content.

## Validation coverage and remaining acceptance

First create failure regressions for downgrade/save/merge, stripped fields, design-system apply, source-delete clone survival (including 3D textures), cross-owner nested assets and interrupted commit. Add pin/GC races, undo-retained assets, expiry notices, oversized decode/body/assets and concurrent same-painting different-tile/settings conflicts. Test lost-response idempotency and changed-payload IDs, simultaneous quota reservations, guessed-future revisions, monotonic generation/schema on undo and public projection redaction. Verify independent paintings/Board edits only merge with unchanged dependencies.

Relevant commands (individual execution evidence is linked above): `npx tsx --test tests/document-v2.test.ts tests/document.test.ts tests/collaboration.test.ts tests/asset-lifecycle.test.ts tests/regressions.test.ts tests/design-systems.test.ts tests/security-boundaries.test.ts`; `npm run build:cli`; `npx tsx --test tests/cli.test.ts tests/agent-capability-parity.test.ts`; `npm run typecheck`; `npm test`; `npm run build`. Renderer-related direct tests require `node scripts/build-renderer.mjs` first.

## Success criteria

SAVE-1/SAVE-2 and foundational AX-1 pass with real persistence/owned bytes. Legacy documents remain unchanged, every v2 field survives the supported paths, no partial paint commit or downgrade succeeds, and cleanup cannot delete pinned assets.

## Risks, security and rollback

Migration ordering and old clients create data-loss risk. Use additive metadata, back up per deployment guidance, roll readers first and keep a v2-readable rollback baseline. Disable new writes/GC if defects occur; retain committed bytes and recovery drafts. No database reset or applied-migration rewrite.

## Unresolved evidence / next step

Complete the remaining acceptance against the current source and linked evidence. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
