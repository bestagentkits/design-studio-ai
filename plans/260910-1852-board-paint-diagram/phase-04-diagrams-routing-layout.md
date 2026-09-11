# Phase 04 — Four diagram families, connectors and layout

Status: pending. Priority: P1. Provisional effort: 7–11 engineering days.
Dependencies: Phase 03 Board geometry/history and shared operations.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

## Requirements and design

Deliver flowcharts, architecture diagrams, user flows and mind maps equally. Use editable semantic nodes, ports, bound connectors, labels and groups—not four template cards over a single inadequate layout.

Connect straight/orthogonal/curved edges through move/resize/rotation/group edits, including mixed image/text/vector/painting content. Support cyclic general graphs and self-loops where appropriate; only group nesting and mind-map parentage are acyclic.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/transform.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/catalog.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/render.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/font-loading.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/inspector.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/document.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/collaboration.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/diagram-schema.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/diagram-operations.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/connector-routing.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/diagram-layout.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/diagram-tools.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/connector-inspector.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/diagram-layout-worker.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/diagrams.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/diagrams-ui.spec.ts`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

- [ ] Define semantic roles and endpoint/port/anchor/label ownership on canonical Board primitives; expose create/bind/reconnect/detach/inspect/layout operations via shared services.
- [ ] Extend font collection to reachable Board text/connector labels and bundled licensed engine fonts. Wait for font readiness before label bounds/layout; test a non-theme font used only by a connector label and match browser/export wrapping.
- [ ] Resolve transformed anchors correctly through groups/rotation; implement straight, curved and obstacle-aware orthogonal routes with editable bends/arrowheads/labels and bounded fallback behavior.
- [ ] Make endpoint deletion cascade its incident connectors in the same undoable transaction by default; explicit detach retains a free endpoint. Duplicate remaps internal bindings; document explicit external-edge policy.
- [ ] Implement flowchart start/end/process/decision presets, Yes/No branch editing, loops and selected-region layout.
- [ ] Implement architecture service/database/actor roles, ports/system boundaries, cross-boundary edges and readable labels through group edits.
- [ ] Implement user-flow screen nodes/thumbnails, action labels/decisions and stable connections as screens move or change.
- [ ] Implement keyboard/touch sibling/child insertion and tree/radial mind-map layouts; collapse hides descendants without deleting them, and expand restores their semantic data.
- [ ] Evaluate pinned Dagre release against its actual license/API; combine it with bounded native routing/tree/radial strategies. Preserve pinned nodes, manual bends and selection boundaries unless explicitly overridden.
- [ ] Tag asynchronous layout by source revision and selection generation; discard stale results. Apply accepted layout in one CAS-checked transaction/history entry and preserve locks.
- [ ] Add complete templates, public examples and agent workflows for every family, including failure/recovery examples; verify current-slice renderer output before exposing diagram controls.

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

## Future validation — not run

Create table-driven topology/transform cases for all four families, cyclic graph versus invalid mind-map cycle, mixed-content bindings, obstacle routing, self-loop labels, cascade/detach, pin/manual-bend preservation and stale worker results. Browser tests must create/edit/layout/save/reopen each family and exercise keyboard/touch mind-map entry.

Future commands: `npx tsx --test tests/diagrams.test.ts tests/document.test.ts tests/collaboration.test.ts`; `npm run build:cli`; `npx tsx --test tests/agent-capability-parity.test.ts tests/cli.test.ts`; `npm run typecheck`; `npm run build`; `npm run test:e2e -- tests/diagrams-ui.spec.ts --project=desktop`; repeat `--project=mobile`, and explicit Firefox/WebKit projects under `STUDIO_CROSS_BROWSER=1`. Inspect actual SVG connector paths/labels after building renderer.

## Success criteria

DIAG-1–7 pass for every family and mixed content, with named-object/edge access on all agent surfaces. Layout is bounded and revision-safe; graph semantics survive persistence, duplicate and inspected rendering.

## Risks, security and rollback

DAG layout alone cannot satisfy ports, cycles, obstacles or radial trees. Keep requested behavior and implement the missing bounded strategy; do not add an EPL dependency silently. Disable a defective layout action without losing manual edit/read/export, and reject stale output rather than overwriting new edits.

## Unresolved evidence / next step

Refresh the source baseline and predecessor evidence before implementation. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
