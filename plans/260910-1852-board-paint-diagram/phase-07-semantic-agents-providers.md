# Phase 07 — Semantic agent workflows and provider preservation

Status: in progress. Priority: P1. Provisional effort: 4–6 engineering days.
Dependencies: Phases 04–06 already deliver minimum shared operation/API/MCP/CLI/WebMCP parity.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

Current delivery update: Shared board/diagram/layer operations and the real raster paintingCommand endpoint are wired through REST, MCP paint_document, CLI projects paint and generated WebMCP. See [current agent contract](../../../docs/agents.md); broad parity tests and provider-preservation acceptance remain in progress.

## Requirements and design

Make the complete workflow discoverable to agents: inspect named Board elements/graph/paint layers, insert/bind/layout, search/insert elements and issue real paint commands through common services. This phase refines higher-level workflow ergonomics; it does not excuse earlier UI-only slices.

Providers preserve existing v2 content and assets when proposing changes; validation and explicit revision-checked application remain separate from generation. No agent operation infers brief approval or bypasses owner/OAuth/lock boundaries.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/providers.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/briefs.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/conversations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/design-checks.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/client.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/providers.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/provider-capabilities.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/briefs.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/creative-capabilities.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/creative-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/creative-commands.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/references/board-and-paint.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/creative-agent-workflows.test.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

Reconciled 2026-09-11 against [current source and local evidence](reports/implementation-checklist-reconciliation.md). Checked rows record implemented behavior, not full device, cross-surface, format or release acceptance. Unchecked compound rows retain their unverified requirements.

- [x] Build bounded structured inspection of elements, bindings, paintings/layers, generation and budgets; return IDs and source revision without dumping all pixel bytes.
- [x] Add thin semantic helpers for insert/bind/layout/layer/stroke/fill/inspect using previously delivered validators/services, with identical typed errors and recovery steps across REST/MCP/CLI/WebMCP.
- [x] Advertise document versions, supported operations, editable/raster/rejected format behavior and feature-dependent capabilities from executable owners; update CLI schema/help and MCP resources without duplicating schemas.
- [ ] Update hardcoded v1 provider vocabulary and prompts; supplied context/proposals must preserve boards, paint manifests, unsupported unrelated nodes, IDs and owned assets. Reject malformed/oversized/downgrade proposals rather than stripping fields.
- [ ] Preserve separate approved brief revision across provider calls; late response cannot overwrite newer scope/document. Applying a proposal checks current project revision and locks through normal writes.
- [ ] Exercise a real local account/project via each surface: agent lays out four families, inserts owned GIF/emoji/sticker, performs real paint mixing/layer edits and sees equivalent persisted state in UI.
- [x] Explain local WebMCP draft operations versus saved-state REST tools, feature detection/cleanup and ordinary-browser fallback. Conflict recovery rereads/inspects and requires intentional replay, never guesses higher revisions.
- [x] Add discoverable agent skill workflows and provider limits. Record credential-dependent live generation separately; missing-config/error checks do not establish provider success.

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

Extend existing parity/CLI/provider tests and add full creative workflow tests through real local persistence/shared services. Cover malicious IDs/foreign assets, OAuth read/write scope, locked targets, stale revisions, failed generation, late brief changes and preservation of untouched v2 content.

Relevant commands (individual execution evidence is linked above): `node scripts/build-renderer.mjs`; `npm run build:cli`; `npx tsx --test tests/creative-agent-workflows.test.ts tests/agent-capability-parity.test.ts tests/cli.test.ts tests/provider-capabilities.test.ts tests/briefs.test.ts`; `npm run typecheck`; `npm test`; `npm run build`. When authorized credentials are available, record real provider/model/time/result evidence separately from deterministic contract tests.

## Success criteria

AX-1/AX-2 pass across all public agent surfaces. A semantic paint request changes actual pixels, and a provider proposal can be inspected/applied without losing untouched Board/Paint content or implicitly approving scope. Error details identify exact target and safe recovery.

## Risks, security and rollback

Prompt changes cannot guarantee model compliance; enforce preservation/version/ownership server-side. Reject unsafe proposals and retain saved source. Disable affected generation helpers if needed while preserving manual/shared deterministic edits; do not substitute fake provider responses or claim unrun success.

## Unresolved evidence / next step

Complete the remaining acceptance against the current source and linked evidence. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
