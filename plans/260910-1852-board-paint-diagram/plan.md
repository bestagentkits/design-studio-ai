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

Implementation authorized on 2026-09-10; the improved drawing demo was approved on 2026-09-11. Production source now includes Board selection/transforms/paste, four diagram families, Elements/GIFs, advanced Paint, semantic raster commands and time-aware export integration. v0.4.0 was merged, released and deployed on 2026-09-11; see [release verification](reports/release-verification.md). Broader physical-device and complete artifact-matrix acceptance remains open. Current evidence: [Board/diagrams](reports/diagram-board-delivery.md), [Elements/runtime](reports/elements-runtime-delivery.md), [advanced Paint and measured workloads](reports/advanced-paint-delivery.md), [earlier persistence integration](reports/production-integration.md). Release: v0.4.0, merge 012c4e3; exact-head CI and Cloudflare deployment verified separately in the release record.

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
| 04 | [Four diagram families and routing](phase-04-diagrams-routing-layout.md) | 03 | 7–11 days | In progress |
| 05 | [Stickers, emoji and animated GIFs](phase-05-elements-gif.md) | 03 | 4–7 days | In progress |
| 06 | [Advanced layered Paint](phase-06-advanced-paint.md) | 02, 03 | 12–20 days | In progress |
| 07 | [Semantic agents and safe providers](phase-07-semantic-agents-providers.md) | 04, 05, 06 | 4–6 days | In progress |
| 08 | [Rendering, export and publication](phase-08-render-export-publication.md) | 04, 05, 06 | 6–10 days | In progress |
| 09 | [Acceptance, docs and release handoff](phase-09-acceptance-docs-handoff.md) | 07, 08 | 5–7 days | In progress |

Every feature phase includes shared validators/operations, minimum REST/MCP/CLI/WebMCP access, documentation and meaningful tests before its controls are considered complete. Phase 07 improves semantic workflows; Phase 09 verifies integration and generated discovery rather than deferring parity.

## Execution and completion gates

- [ ] Record pinned engine/license/API fit, paint math/resource budgets and physical-device evidence in 01. Failed adoption selects the native path; unavailable hardware leaves that quality gate open.
- [ ] Stage v2-capable readers before new writes; reject downgrade saves/merges, preserve brief revisions and existing v1 behavior.
- [ ] Use painting-wide generation CAS initially; pixel/settings writes to the same painting conflict. Finer tile merging is optional, not a release requirement.
- [ ] Protect immutable assets through staging, history/recovery pins and concurrent commits before enabling deletion; reserve in-flight quotas atomically, keep idempotent paint receipts/monotonic undo, and publish sanitized visible projections without private source layers.
- [ ] Satisfy every functional, device, cross-surface and artifact row in the acceptance matrix. Record actual browsers and limits.
- [ ] Finish focused and full gates from existing npm scripts, independent review and authorized release handoff. Build, CI, merge, deploy and live verification remain distinct states.

Shared files make phases 04–06 logically independent after 03 but not safe for overlapping edits without explicit ownership. This checkout uses one E2E harness on port 19203; port 8791 belongs to another checkout.

## Current local evidence

[Checklist reconciliation](reports/implementation-checklist-reconciliation.md) records the desktop Board/Paint run (5/5), the earlier 294-test local Node suite and the production CreativeWorkspace probe. At 500/2000 elements, Chromium frame-interval p95 was 17.3/17.5 ms; this measures a standalone scripted pan workload, not physical-device or input-to-pixel latency. The post-merge full Node suite passed 298 tests; post-merge Creative acceptance passed 18 Chromium desktop/mobile executions, 7 Firefox and 7 WebKit executions. See [release verification](reports/release-verification.md). Exact-head PR/main CI passed 298 Node tests and 107 Chromium E2E executions; v0.4.0 is deployed. Remaining acceptance limits are recorded separately.

## Open evidence

Native fallback selected from the released Excalidraw probe. User has no iPad available; recommended baseline is iPad Air 11-inch M2 + Pencil Pro, stable supported iPadOS/Safari at test time. Hardware quality remains unmeasured. Local CPU and actual browser-worker workload measurements are recorded in the advanced Paint report; they do not measure physical-device input, complete editor latency or total peak memory. Asset retention remains bounded by quotas with no automatic garbage collection. Remaining workload and release gates stay open until independently verified. Phase file proposed paths identify intended ownership; the execution report identifies implemented files.
