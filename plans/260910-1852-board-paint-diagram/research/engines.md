# Board, diagram, paint engine research

Planning status: research alternatives below are evidence inputs. The final proposed decisions in [architecture](../architecture.md) and workloads in [acceptance](../acceptance-matrix.md) supersede alternate prototype workloads, memory targets and persistent replay suggestions here. Immutable layer pixels/manifests are authoritative; transient brush commands support recovery only.

Observed: 2026-09-10. Planning evidence only; no dependency installed, prototype run, or device benchmark performed.

## Accepted constraints

- Prioritize MIT/self-hosting. tldraw.com is a feature/UX reference only; do not add a paid tldraw dependency or fallback.
- Preserve advanced painting: textured brushes, actual color mixing, multiple editable paint layers. Freehand vector strokes alone do not satisfy it.
- Flowcharts, architecture diagrams, user flows, and mind maps have equal delivery priority.
- Desktop and iPad/Apple Pencil are primary; phone supports basic actions. Stickers, emoji, and animated GIFs remain required.

## Current repository boundaries

- [README](../../../README.md:5) establishes one versioned document for humans and agents; [package.json](../../../package.json:7) requires Node >=24 and currently uses React 19.
- [Schema](../../../src/shared/schema.ts:4) has six project kinds; node types at line 23 have no typed stroke, connector, or paint layer. `data` at line 32 is not a substitute for explicit shared validators and semantic checks.
- [Schema bounds](../../../src/shared/schema.ts:8) cap coordinates/dimensions; page nodes at line 34 and document nodes at line 68 are bounded. An “infinite” viewport does not imply unlimited persisted geometry.
- [Undo](../../../src/app/editor.tsx:368) clones complete documents, retains 80 history states; [save](../../../src/app/editor.tsx:439) and [live sync](../../../src/app/editor.tsx:472) rebase undo/redo against remote edits. Paint pixels must not be copied into 80 full-document snapshots.
- [Merge](../../../src/shared/document-merge.ts:23) understands arrays of objects with stable IDs and rejects competing order changes. Raw stroke-point arrays cannot be merged point-by-point safely; use atomic immutable completed strokes/tiles with explicit conflicts.
- [Uploads](../../../server/projects.ts:103) already accept signature-checked GIF assets up to 20 MB. This proves storage support, not animation or export fidelity.
- [Architecture](../../../docs/architecture.md:90) separates native/static exports from interactive playback. New rendering must work with owned assets and isolated export requests.

## Candidate assessment

| Candidate | Verified capability | Planning implication |
| --- | --- | --- |
| Excalidraw React package | MIT; React 19 included in current source peer range. [License](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [package](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json) | First board/diagram interaction candidate, conditional on adapter spike. Pin released version and inspect its shipped types; master is not proof of published package behavior. |
| Native SVG/Canvas plus perfect-freehand | MIT; pressure samples produce stroke outline polygons. [Upstream](https://github.com/steveruizok/perfect-freehand) | Permissive fallback for vector ink; selection, binding, camera, accessibility and history remain application work. Not a paint engine. |
| Dagre | MIT directed-graph layout. [Upstream](https://github.com/dagrejs/dagre) | First permissive layout candidate; validate routing/containers and provide a separate radial/tree strategy for mind maps as needed. No claim of satisfying every diagram mode automatically. |
| ELK.js | Promise/worker graph layout; ELK Layered handles labels, ports, clusters and compound edges. [API](https://github.com/kieler/elkjs), [algorithm](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) | Useful technical comparator, not selected. ELK “layers” are graph ranks, unrelated to pixel paint layers. |
| ELK.js license | EPL-2.0, not MIT. [License](https://github.com/kieler/elkjs/blob/master/LICENSE.md) | Do not call it a permissive MIT dependency. Default plan should avoid it under current preference; any exception needs explicit license review/decision. |

tldraw exposes shape utilities, state-machine tools, asset handlers, and editor history, which make useful reference categories for the product interaction contract. Its current SDK default license permits development use; production requires a valid trial, commercial, or hobby license. Excluded as a dependency by the user's choice. [Shape API](https://tldraw.dev/docs/shapes), [tools](https://tldraw.dev/docs/tools), [assets](https://tldraw.dev/sdk-features/assets), [history](https://tldraw.dev/sdk-features/editor), [license](https://tldraw.dev/community/license).

## Excalidraw adapter: possible, not proven

The documented imperative API offers `updateScene`, `getSceneElements`, `getFiles`, `addFiles`, `onChange`, pointer subscriptions and active-tool selection. `captureUpdate` distinguishes immediate, deferred and never-recorded updates. Documented history access only exposes `clear()`; do not invent public undo-stack import/rebase methods. These are useful primitives, not proof of compatibility with this repository's history semantics. [API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api).

`customData` can carry stable application IDs/metadata; the host must validate its own typed content. UI options and child components customize menus and sidebars; a custom tool name does not demonstrate a supported arbitrary raster renderer or paint-layer implementation. [Props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/), [UI options](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options), [children](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/children-components).

Recommended adapter shape, subject to spike:

1. Canonical validated document owns stable IDs, semantic graph nodes/edges, assets, paint layers and revisions; Excalidraw is an editable projection, not an opaque replacement document.
2. Keep camera, hover, selection and gesture drafts ephemeral; commit completed gestures as one semantic transaction. Prevent programmatic projection changes from echoing into save loops.
3. Round-trip paths, pressures, text, bindings, grouping, z-order, locks and flips explicitly. Preserve typed vendor-specific visual fields only when necessary for lossless rehydration, with schema/version bounds.
4. Centralize undo policy: host transactions/history are preferred; suppress duplicate SDK shortcuts/actions if supported. If SDK history must participate, prove one coherent user-visible sequence across board, diagram, paint, agent updates and remote edits.
5. Apply remote projection changes without recording them as local edits. Test stale writes and overlapping edits through the existing service; never retry with invented revisions.
6. Resolve engine binary-file references through owned assets. Do not persist base64 pixels repeatedly in scene history or issue browser-only URLs to agents/exporters.

## GIF, sticker and emoji risks

Official GIF request [#5301](https://github.com/excalidraw/excalidraw/issues/5301) remains open. Animated-image PR [#11474](https://github.com/excalidraw/excalidraw/pull/11474) was open when checked; it proposes an HTML layer. An unmerged PR and hosted-demo behavior do not establish package support. The [current renderer](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/renderElement.ts) uses cached canvas image rendering. Treat animation as an application integration requirement until a pinned package proves it.

Recommended GIF path: owned bytes plus validated dimensions/duration/frame limits; an application-controlled animated overlay or decoded-frame compositor aligned to the board camera, z-order, clip/opacity and hit targets. Keep original bytes portable; pause/resume and reduced-motion handling must be explicit. For deterministic video exports, use frame decoding/timing rather than hoping `<img>` starts at the desired frame. Static formats use a defined poster/time sample, with visible capability messaging. This is design inference, not tested capability.

Excalidraw export utilities offer canvas/blob/SVG export, not a promised animated-GIF/video recorder. [Export API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export). Preserve the studio's shared renderer/export boundary.

Sticker/emoji records should distinguish editable Unicode text from owned image/sticker assets. Emoji font appearance varies by renderer/platform; choose a documented export policy and verify actual bytes. Library packages and artwork need separate license/provenance review; MIT engine licensing grants no rights to arbitrary GIF/sticker catalogs. Local upload/paste must work without a third-party catalog service.

## Advanced paint is a separate subsystem

Proposed implementation direction: a bounded tiled raster compositor with immutable checkpoints plus replayable brush commands. Persist brush version, random seed, pressure/tilt samples, texture asset IDs, color/mixing parameters, layer order, masks/opacity/blend settings and checkpoint references in the canonical schema. Keep working buffers out of JSON.

Brush texture requires stable stamping/grain sampling; mixing requires a defined color/paint model and neighborhood sampling, not merely alpha-over compositing. Multiple paint layers require independently editable surfaces, not just vector object groups. Lossless save/reload must preserve edits and reproduce pixels within a declared tolerance; flattening is an explicit export action only.

Use Canvas2D/WebGL according to measured requirements; do not assume WebGPU support on the baseline. Feature-detect input facilities and preserve deterministic fallback paths. Pointer Events define pressure/tilt, pointer capture/cancellation and optional coalesced/predicted samples; actual Pencil/palm behavior still needs hardware testing. [W3C Pointer Events](https://www.w3.org/TR/pointerevents3/).

Memory planning: one 2048×2048 RGBA8 buffer costs 16 MiB before browser/GPU overhead; eight layers already need 128 MiB for one buffer per layer. Full copies for every undo are untenable. Tile reuse, dirty-region updates, bounded history storage and idle disposal are required; limits should be measured on the chosen iPad and 16 GB desktop.

## Bounded spike and pass/fail gates

Suggested timebox: 3 engineering days for engine selection evidence, not completion of the feature. Run sequentially on the 16 GB workstation; one browser harness at a time. Record exact package/hash, browser/device/OS and measured resources. Any failed gate keeps the capability outstanding; it does not remove the requirement.

| Probe | Pass criteria | Failure response |
| --- | --- | --- |
| Release/package integration | Pinned Excalidraw release builds with repo React/Node/Vite; assets load self-hosted; no required paid service/CDN. | Investigate supported release configuration, then native permissive renderer route. No tldraw fallback. |
| Canonical round-trip | Draw/bind/group/resize/lock/duplicate and text edit survive save/reload and JSON/REST/CLI round-trip without changed IDs, lost pressure, broken connectors or opacity/z-order drift. | Narrow adapter defect; if unsupported primitives require invasive fork, fail engine fit and choose native implementation. |
| Coherent history/concurrency | One gesture = one undo; interleaved board/paint/diagram operations undo predictably; remote non-overlap survives undo; overlap yields visible conflict preserving local content. | Fix adapter/history ownership before adoption; `history.clear()` alone is not a substitute. |
| Animated assets | Transparent GIF keeps animation, selection, transforms, clipping/z-order, pause and reload; owned asset remains usable after cloning/publication; deterministic export frame and video timing inspected. | Native overlay/compositor spike; do not count static poster as animated-GIF success. |
| Four diagrams equally | Flowchart branches/cycles; architecture containers/ports; user-flow screens/decision paths; mind-map radial/tree branches all remain semantic/editable after layout, move, reconnect, undo and reload. | Add native routing/tree layout to meet each contract; do not defer mind maps or downgrade architecture to boxes. |
| Real paint depth | Two textured brush variants with pressure, a defined mixing example, and at least eight editable layers; undo across painting/reorder and reload preserves outcome. | Separate Canvas/WebGL paint work; retain full requirements. Reject freehand-only substitution. |
| Pencil/touch and accessibility | Physical iPad/Pencil pressure ramps, palm/touch conflict, pointer cancel and pan/zoom tested; desktop keyboard/IME/focus plus phone basic selection/insertion/save remain usable. | Mark device acceptance unresolved until hardware evidence; desktop emulation is insufficient. |
| Sustained performance | Proposed benchmark: 1,000 board elements, 150-node/250-edge diagrams, 2048² eight-layer paint; 10-minute sessions without corruption or growing retained memory. Target p95 frame work ≤16.7 ms desktop, ≤33 ms iPad; input-to-ink ≤50 ms. | Profile/iterate engine or workload implementation; numbers are proposed acceptance thresholds, not measured claims or silent product limits. |

Artifacts: minimal prototype branch later, round-trip diffs, conflict/history traces, exported JSON/PNG/SVG/PDF/video samples, physical-device recording and memory/frame profiles. This report authorizes no implementation or adoption.

## Recommendation and unresolved evidence

Proceed in planning with Excalidraw as conditional board/diagram candidate, native paint compositor as necessary work, and Dagre/native tree layout as permissive candidates. Keep native SVG/Canvas plus pressure-outline geometry as fallback if Excalidraw adapter gates fail. No engine selected or parity claimed yet.

Unresolved: pinned release/API behavior; full-history integration; GIF compositor fidelity; chosen iPad model/browser and real Pencil results; agreed paint-mixing model and concrete benchmark thresholds. These are spike/implementation evidence tasks, not reasons to discard accepted scope.

Status: DONE_WITH_CONCERNS
Summary: Official-source research identifies a plausible MIT-first route and explicit engine-selection gates.
Concerns: Excalidraw GIF/history integration unproven; advanced paint needs independent engineering; ELK.js is EPL-2.0.
