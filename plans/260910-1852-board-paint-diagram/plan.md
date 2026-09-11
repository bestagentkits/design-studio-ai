---
title: "Board, advanced Paint, Elements and diagrams"
description: "Add a coherent human and agent creative workspace to the shared Studio document."
status: in-progress
priority: P1
effort: "56–88 engineering days; provisional, re-estimate after Phase 01"
tags: [feature, frontend, backend, api]
blockedBy: []
blocks: []
created: 2026-09-10
baseline: "3545d18 (detached HEAD)"
branch: "codex/board-paint-diagrams"
---

# Board, advanced Paint, Elements and diagrams

Implementation authorized on 2026-09-10; the improved drawing demo was approved on 2026-09-11 and the user requested production integration. Canonical v2, editable board/paint workspaces, immutable tile uploads, painting save receipts, server compositing and public-source redaction now have production source implementations. Integration, recovery and cross-browser acceptance are in progress; the complete nine-phase scope is not finished. See [production integration evidence](reports/production-integration.md) and [earlier feasibility evidence](reports/implementation-progress.md). No commit or deployment performed.

## Outcome and boundaries

One canonical versioned Studio document powers Draw, Diagram, Elements and focused Paint, including editable board/artwork embeds in existing designs. Preserve textured brushes, actual mixing, multiple paint layers, stickers/emoji/GIFs, and equally complete flowchart, architecture, user-flow and mind-map workflows.

MIT/self-host first; tldraw is a UX reference only. Excalidraw is conditional; native permissive interaction/rendering is the fallback. Primary devices are desktop and physical iPad/Pencil; phone basic actions remain required. No paid SDK, CRDT/presence system, PSD, portable asset archive or physical pigment simulator is added.

Authority: [confirmed intake](reports/intake-and-source-map.md), [proposed architecture](architecture.md), [acceptance and workloads](acceptance-matrix.md). Research is supporting evidence; its alternate workloads/merge suggestions do not override these decisions.

Review: [findings, dispositions and checks actually run](reports/review-and-validation.md).

## Phases and provisional estimates

All estimates are engineering effort, not delivery dates or benchmark evidence. Sum: 56–88 engineering days. Native fallback may add effort; re-estimate openly after the bounded spike without cutting requested scope.

| Phase | Delivery | Dependency | Estimate | Status |
| --- | --- | --- | --- | --- |
| 01 | [Engine, UX and paint feasibility](phase-01-engine-ux-paint-spike.md) | None | 3–5 days | In progress |
| 02 | [Canonical v2, assets and safe writes](phase-02-canonical-v2-assets-cas.md) | 01 | 7–10 days | In progress |
| 03 | [Board, Draw and embedded editing](phase-03-board-draw-embed.md) | 02 | 8–12 days | In progress |
| 04 | [Four diagram families and routing](phase-04-diagrams-routing-layout.md) | 03 | 7–11 days | Pending |
| 05 | [Stickers, emoji and animated GIFs](phase-05-elements-gif.md) | 03 | 4–7 days | Pending |
| 06 | [Advanced layered Paint](phase-06-advanced-paint.md) | 02, 03 | 12–20 days | In progress |
| 07 | [Semantic agents and safe providers](phase-07-semantic-agents-providers.md) | 04, 05, 06 | 4–6 days | Pending |
| 08 | [Rendering, export and publication](phase-08-render-export-publication.md) | 04, 05, 06 | 6–10 days | Pending |
| 09 | [Acceptance, docs and release handoff](phase-09-acceptance-docs-handoff.md) | 07, 08 | 5–7 days | Pending |

Every feature phase includes shared validators/operations, minimum REST/MCP/CLI/WebMCP access, documentation and meaningful tests before its controls are considered complete. Phase 07 improves semantic workflows; Phase 09 verifies integration and generated discovery rather than deferring parity.

## Execution and completion gates

- [ ] Record pinned engine/license/API fit, paint math/resource budgets and physical-device evidence in 01. Failed adoption selects the native path; unavailable hardware leaves that quality gate open.
- [ ] Stage v2-capable readers before new writes; reject downgrade saves/merges, preserve brief revisions and existing v1 behavior.
- [ ] Use painting-wide generation CAS initially; pixel/settings writes to the same painting conflict. Finer tile merging is optional, not a release requirement.
- [ ] Protect immutable assets through staging, history/recovery pins and concurrent commits before enabling deletion; reserve in-flight quotas atomically, keep idempotent paint receipts/monotonic undo, and publish sanitized visible projections without private source layers.
- [ ] Satisfy every functional, device, cross-surface and artifact row in the acceptance matrix. Record actual browsers and limits.
- [ ] Finish focused and full gates from existing npm scripts, independent review and authorized release handoff. Build, CI, merge, deploy and live verification remain distinct states.

Shared files make phases 04–06 logically independent after 03 but not safe for overlapping edits without explicit ownership. This checkout uses one E2E harness on port 19203; port 8791 belongs to another checkout.

## Open evidence

Native fallback selected from the released Excalidraw probe. User has no iPad available; recommended baseline is iPad Air 11-inch M2 + Pencil Pro, stable supported iPadOS/Safari at test time. Hardware quality remains unmeasured. Phase 01 still needs integrated input/history/render workload evidence and production retention choices; existence of helper code does not close those gates. Phase file proposed paths identify intended ownership; the execution report identifies implemented files.
