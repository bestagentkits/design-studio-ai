# Implementation checklist reconciliation

2026-09-11. Documentation reconciliation during integration, before final full-suite/CI/release results. This report supersedes stale pending-implementation lists in earlier delivery snapshots; it does not supersede their recorded test conditions or close acceptance gates.

## Current local evidence

- Parent integration run: desktop Board + Paint **5/5 passed**. Three Board scenarios cover creation/diagram presets/layout, Elements insertion and ordering, keyboard transforms, save/reopen, controlled GIF behavior and durable recovery across two reloads. Two Paint scenarios cover advanced group/mask editing and recovery. See `tests/creative-board-ui.spec.ts` and `tests/painting-advanced-ui.spec.ts` for actual assertions; this is desktop evidence only.
- Parent reported full local Node suite **294 passed before the latest small fixes**. This is a historical passing snapshot, not verification of the final release revision. A subsequent full run identified three failures (v1 downgrade status, schema discovery assertion and mobile hidden Clear selection); the parent applied fixes and focused reruns are running. Final passing evidence, exact-head CI and deployment are not claimed here.
- Inspected `artifacts/board-performance.json`: Chromium 153.0.8010.12; 500 elements mounted in 214 ms, frame-interval p95 17.3 ms/max 17.7 ms; 2000 mounted in 472 ms, p95 17.5 ms/max 17.6 ms. Each run completed a real stroke and observed the committed count increase to 501/2001, with no page errors.
- Probe owner: `scripts/probes/board-performance.mjs`. It bundles the production `CreativeWorkspace` into a standalone page, dispatches scripted wheel pans over animation frames, then draws through pointer input. It does not exercise the whole authenticated app, physical iPad/Pencil, input-to-pixel latency, network persistence, or complete application peak memory. The measured intervals must not be relabeled as those metrics.
- Paint CPU and browser-worker workload numbers remain in [advanced Paint evidence](advanced-paint-delivery.md), with their original environment and limitations.

## Checklist evidence owners

| Phase | Implemented evidence | Remaining acceptance distinction |
| --- | --- | --- |
| 02 | `schema.ts`, `document-upgrade.ts`, `creative-validation.ts`, `document-asset-references.ts`, server project/collaboration CAS, `asset-lifecycle.ts`, migration 0010, `creative-save-receipts.ts`; real persistence tests in `tests/creative-persistence.test.ts` | Compound resource-budget/retention gates remain open. Committed assets are retained until project deletion; automatic GC and its pin/expiry workflow are not enabled. Reader-first deployment is a release gate. |
| 03 | `creative-workspace.tsx`, Board engine/editing/selection/history modules, inspector linked view/crop controls; Board engine/history/editing tests and three desktop Board scenarios | Full IME, cancellation, touch/focus and complete live-sync sequence requirements remain distinct from the demonstrated desktop cases. |
| 04 | Diagram schema/operations/presets/routing/layout/render modules, `creative-diagram-panel.tsx`; `tests/diagrams.test.ts` and Board desktop presets/layout | Native layout was implemented; do not claim Dagre adoption/evaluation completed from that fact. Sole non-theme font fidelity and complete family workflow/error examples retain their acceptance checks. |
| 05 | Catalog, artwork recipe-to-PNG generation, safe SVG flattening, bounded image/GIF decoding, playback sampling and export hooks; `tests/creative-elements.test.ts`, `tests/creative-elements-render.test.ts` | Recolor retains a known vector recipe, while the persisted asset is PNG. Mobile/focus acceptance and the complete clone/history/reference matrix remain open compound rows. |
| 06 | Shared paint runtime/stroke/compositor, advanced selection/fill/layer operations, worker fallback, account-scoped recovery, focused UI and server semantic painting commands; advanced Paint report and two current desktop scenarios | CPU/worker and desktop tests do not establish physical iPad performance, full mask/history/media peak budget, or every late-sync finish/cancel/undo combination. Conservative asset retention is not active GC pinning. |
| 07 | Shared creative operations and paintingCommand schema, server paint service, MCP `paint_document`, CLI `projects paint`, generated WebMCP and owning agent documentation | A real account workflow exercising every family/media/mixing operation through every surface and live-provider preservation remain separate acceptance requirements. |
| 08 | Public creative projection, Board renderer, exact-time GIF export preparation, trusted published viewer and portable runtime, existing format rejection boundaries; GIF render pixel tests | Full artifact inspection, publication/clone deletion matrix, independent React ZIP installation/runtime, offline media cases, font fidelity and final generated-output verification remain open compound acceptance rows. |

Checked implementation rows are not declarations that an entire phase passed. Unchecked rows may contain implemented portions where their remaining requirement has not yet been verified. No accepted scope was removed. Earlier reports retain historical measurements; use this reconciliation for current implementation status.

## Documentation

`docs/creative-tools.md` documents Save Board and linked Board view crop behavior: linked views share source content but retain separate crops; Duplicate produces independent content; workspace camera navigation does not change the page crop. Agent operation/API descriptions remain owned by their source documentation and executable schema rather than copied into this report.

## Unresolved evidence

Physical iPad/Pencil; current full-suite result after final fixes; exact-head CI/review; complete cross-browser/mobile and export matrix; authorized release, deploy and live verification. No hardware or release gate marked complete here.

## Final integration verification update

- Final local unit/integration suite: **297 passed**, including real raster persistence, version guards, renderer/source archives and CLI behavior. Typecheck, application build, CLI build, skill ZIP and CLI pack pass.
- Fixed full-suite findings: v1 downgrade requests now report the owned project's upgrade conflict before v2-only-field validation; discovery assertions include the new canonical schemas; phone layouts expose selection actions.
- Additional regression fixes: templates avoid existing artwork, layout keeps system boundaries around their children, pointer connectors select transformed side ports, and shared static rendering retains impossible routes as explicitly dashed warned connections.
- Full-suite rerun, cross-browser runs, upstream integration, exact-head CI and production release remain separately recorded in release verification.
