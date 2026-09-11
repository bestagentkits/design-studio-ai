# Acceptance matrix and reference workloads

Status: proposed implementation targets, not measured results. All requested capabilities are release requirements. A prototype or one completed slice is not full delivery.
User confirmed desktop + physical iPad/Apple Pencil; phones cover basic operations. tldraw and Excalidraw are interaction references, not automatic promises of every feature on their hosted sites.

Execution update: user has no iPad at hand and delegated recommendation. Proposed physical baseline: iPad Air 11-inch M2 + Apple Pencil Pro, stable supported iPadOS/Safari at test time ([Apple compatibility](https://support.apple.com/en-euro/108937)). This is a selected target, not a completed device test.

## Functional coverage

| ID | Requirement | Observable acceptance | Primary phase |
| --- | --- | --- | --- |
| DRAW-1 | Freehand pencil, ink, brush, eraser | Fast curves, tiny dots, slow strokes, crossings and pressure changes stay continuous at several zoom levels; undo removes exactly one completed gesture. | 03, 06 |
| DRAW-2 | Vector pen and coloring | Create and edit a closed/open path with curve handles; recolor stroke/fill without rasterizing editable paths. | 03 |
| DRAW-3 | Selection, transforms, group and clipboard | Hit-test visible geometry, select a group or child, rotate/resize, align/snap, copy/paste and duplicate with stable geometry and correctly remapped references. | 03 |
| DRAW-4 | Camera and input | Pan/zoom never accidentally draws; two-finger gesture cancels the draft stroke cleanly; pressure/tilt feature detection has usable fallback. Escape, blur and pointercancel leave no stuck tool. | 03, 06 |
| PAINT-1 | Textured brush | Brush tip/grain, size, spacing, flow, opacity and stylus response change actual deposited pixels, with repeatable seeded output. | 06 |
| PAINT-2 | Actual color mixing | Smudge/mix samples existing surface color; changing pickup/deposit changes output. A two-color mixing test distinguishes mixing from transparency-only overdraw. | 06 |
| PAINT-3 | Multiple paint layers | Add/reorder/group/rename/hide/lock layers; opacity, supported blend modes, alpha lock, clipping and masks render consistently and survive reload. | 06 |
| PAINT-4 | Fill and selection | Flood fill honors tolerance/contiguous sampling, layer selection and transparent boundaries. Lasso/rectangle selections, feather and erasing respect masks/locks. | 06 |
| PAINT-5 | Recovery | Interrupted upload, tab reload, GPU context loss and revision conflict retain a recoverable last committed artwork; draft state is never reported as server-saved. | 02, 06 |
| ELEM-1 | Stickers | Search a bundled licensed catalog and owned uploads, insert, rotate/flip/resize, preserve transparency, recolor supported vector stickers. | 05 |
| ELEM-2 | Emoji | Search names/keywords, select variants, preserve semantic Unicode and licensed artwork identity; selected appearance matches previews and exported static artifacts. | 05 |
| ELEM-3 | GIF | Upload/search owned library, preview, insert, play/pause, loop, choose poster frame and timeline start; no external marketplace account required. | 05, 08 |
| DIAG-1 | Bound connectors | Straight, orthogonal and curved edges remain bound through move/resize/rotation and group transforms; labels and bend handles are editable. | 04 |
| DIAG-2 | Flowchart | Create process/decision/start-end nodes, labeled Yes/No branches and loops; edit manually and auto-arrange a selected region. | 04 |
| DIAG-3 | Architecture | Create service/database/actor nodes, ports and system boundaries; preserve crossing edges and labels on group edits. | 04 |
| DIAG-4 | User flow | Connect screen nodes/thumbnails with action labels and decision branches; move/revise screens without disconnecting flow. | 04 |
| DIAG-5 | Mind map | Add sibling/child topics by keyboard/touch, collapse/expand branches, choose tree/radial arrangement, preserve hidden descendants. | 04 |
| DIAG-6 | Mixed content | Connect an image, vector shape, text and artwork in one board. Duplicate remaps internal edges, external edges follow an explicit documented policy. | 03, 04 |
| DIAG-7 | Layout controls | Preserve pinned nodes and manual bends unless explicitly changed; stale async layout cannot overwrite later edits. All four families have usable presets, not placeholder cards. | 04 |
| AX-1 | Human-agent parity | Read and modify named objects/edges/layers through REST, MCP, CLI and available WebMCP; use shared operations and validation; error identifies target and recovery. | 02–08 |
| AX-2 | Safe generation | Provider proposals preserve existing board/paint content; applying approved edits is revision checked; brief approval remains separate. Locked content remains protected by shared mutation semantics. | 07 |
| SAVE-1 | Version compatibility | Existing v1 documents continue to round-trip; opt-in upgrade preserves IDs/content; old/downgrade writes to upgraded content are rejected without data loss. | 02 |
| SAVE-2 | Asset lifecycle | All nested assets remain owned, clone independently, snapshot immutably, survive source deletion where promised and are cleaned without breaking undo/recovery references. | 02, 05, 06, 08 |
| SAVE-3 | Unknown commit outcome | Drop a committed paint response, retry the same operation ID/hash and verify pixels change once; mismatched hash is rejected; undo increments generation and cannot trigger a delayed stale job. | 02, 06, 07 |
| SAVE-4 | Concurrent admission | Parallel uploads/jobs cannot exceed reserved+committed quotas; expiration prevents late commit and cleanup does not remove pinned data. | 02, 06 |
| SAVE-5 | Remote response during gesture | Start sync, begin gesture, deliver remote response, then complete/cancel/save/undo. Independent remote edits survive; same-painting source change conflicts; no stale snapshot overwrite or mixed-generation smudge. | 03, 06 |
| COMPAT-1 | Existing composition library | Applying tokens or inserting v1 compositions preserves v2 roots; unsupported Board/Paint library capture rejects before save with no dangling references. Editable page embedding remains supported. | 02, 03 |
| EXPORT-1 | Font and package closure | A font used only by a Board label is collected before measurement and offline rendering; an exported supported React ZIP containing Board/Paint has complete source/dependencies/assets and builds/runs independently. | 04, 08 |
| EXPORT-2 | Offline CLI capability | Vector-only HTML/SVG renders; verified local media works; missing/stale media gives actionable error without network/browser installation or incomplete artifact. Static GIF poster and interactive server export are distinguished. | 08 |
| PUB-1 | Private paint source containment | Public HTML/viewer payload and asset routes expose only visible rendering assets; masked original pixels, hidden elements/layers and recovery data remain inaccessible. | 08 |
| EMBED-1 | Existing Studio integration | Standalone Board and board/artwork embedded in a slide/report reopen as editable source; unrelated web/layout/3D interactions remain intact. | 03, 08 |
| UX-1 | Accessible human workflow | Tool names, keyboard navigation, focus restoration, selected state and recovery notices work; touch targets and bottom sheets usable at phone width. | 03–09 |

## Quality comparison protocol

Compare the same tasks on a fixed reference-device/browser matrix. Record app/build/date, hardware, input hardware, refresh rate, zoom, object count, assets, warm/cold state and recording method. Do not claim app-to-app latency comparison from a synthetic pointer test alone.

- tldraw reference: fast/slow curves, dots, erasing, pan/zoom, selection, nesting, drag/resize/rotate, snapping, paste and undo.
- Excalidraw reference: quick shape/text creation, arrows, labels, endpoint rebinding, multi-select, diagram edits, libraries and export appearance.
- Studio-specific requirements: advanced painting, agent writes, saved revisions, embedded designs and GIF playback are tested independently; a reference lacking a feature does not remove it from this plan.

### Workloads and initial budgets

These are engineering targets to validate in Phase 01, not user-selected thresholds. Record any proposed adjustment and its reason before implementation; never label a failing workload passed by silently reducing it.

| Workload | Reproducible input | Initial target |
| --- | --- | --- |
| Normal Board | 500 mixed objects, including 150 connected edges and 100 text labels | Target 60 FPS pan/draw at 60 Hz; p95 presented-frame interval <=20 ms during active interaction; <=50 ms p95 input-to-visible ink on desktop and iPad, measured separately. |
| Stress Board | 2,000 mixed objects including 600 edges, within document quotas | Responsive selection; target >=30 FPS navigation; no lost edits, crashes or unbounded memory growth. |
| iPad Paint | 2048x2048 artwork, 12 layers, textured pressure strokes and mixing | Target >=30 FPS painting, <=80 ms p95 input-to-visible stroke; layer/tile cache remains within a measured device budget and recovers from pressure. |
| Desktop Paint | 4096x4096 artwork, 24 layers, masked textured brush and mixing | Same correctness; target >=30 FPS. All proposed reachable assets must fit quota or fail preflight before work is lost. |
| GIF composition | Three imported animated images with differing frame durations/transparency plus vector overlays | Stable layer order, deterministic selected-time render/poster, no uncontrolled animation while paused. |
| Persistence | 100 draw/transform actions; undo/redo sequence; save/reload; interrupted upload | Canonical content equals expected committed state; no duplicate history entries or phantom saved indicator. |

Physical iPad model/iPadOS/Pencil generation and desktop model/OS/browser versions must be recorded at implementation start. Device unavailability blocks the corresponding quality claim, not unrelated implementation. Playwright WebKit is useful automated coverage but does not replace Apple Pencil verification. Phone workload: view/pan/zoom, select/move, add text/shape/element, edit labels, simple stroke, save and undo; controls must remain usable at 390x844.

## Export behavior to implement and inspect

| Output | Required new-content behavior |
| --- | --- |
| Saved project / JSON | Preserve canonical vector/diagram/paint layer metadata and versioned asset references. JSON with references is not an offline portable asset archive. |
| SVG | Editable vector structure where supported; paint and selected GIF poster embedded as raster. No silently missing nodes or external private asset URLs. |
| PNG / PDF | Composite the selected page/artboard deterministically; GIF uses the explicitly chosen poster or requested snapshot time. |
| PowerPoint | Preserve existing editable text/primitives; composite Board/Paint content where native fidelity is unsupported, and document that boundary. |
| HTML / published viewer / React prototype | Render board/artwork through trusted runtime, owned or packaged assets; GIF playback controls and reduced-motion fallback. No external SDK activation call or third-party app iframe. |
| WebM / supported MP4 | Render GIFs at timeline time with the same compositor and existing duration/pixel bounds; unsupported encoder returns the existing actionable error. |
| Google Slides | Preserve existing native/HTTPS-image rules. Unsupported board/paint nodes must fail preflight explicitly; never auto-publish private raster assets to satisfy the API. |
| GLB / glTF | Preserve existing 3D behavior; preflight explicitly identifies unsupported 2D content instead of pretending it is exported scene geometry. |

Verify server and browser routes, CLI offline vs server export, and immutable publication snapshots. A screenshot, a file extension or a passing build does not prove editability, animation timing or format fidelity.

## Commands and ownership of evidence

Current commands to run during implementation (not executed for this planning-only task):

```sh
npm ci
npm ci --prefix packages/cli
npm run build:cli
npm run typecheck
npm test
npm run build
npm run pack:skill
npm run test:e2e
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- --project=firefox
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- --project=webkit
```

Install needed Playwright browsers before those runs. New focused tests are named in phase files and must exist before their commands are run. `npm test` builds the renderer; direct renderer-related test runs need `node scripts/build-renderer.mjs` first. CLI tests need the CLI build. Run `npm pack` with working directory `packages/cli`, not `npm pack --prefix packages/cli`.

Run E2E projects sequentially on the harness's reserved port 8791; never start a competing server or kill another owner's listener. Use isolated test accounts/data, never the production smoke script as a local check. Capture physical-device evidence without real credentials/private content. Public deployment, exact-head CI and live rollout evidence are separate from local acceptance and occur only in an authorized shipping task.

## Unresolved questions

Physical device identifiers and measured engine fit are not known yet. These are Phase 01 evidence tasks. The user has already resolved device class, license preference and feature priorities; do not ask those again.
