# Drawing quality correction — 2026-09-11

User rejected the initial prototype as too primitive. Existing full product scope stays open. This correction implements the previously missing input/render quality boundary within the engine work.

Observed causes: mouse pressure is fixed at 0.5; pressure geometry is a disc/quad union without smoothing; paint runs only at pointer release with the same hard round stamp/noise for every brush. No user-facing brush controls exist.

Acceptance for this correction:
- Same spatial mouse trace drawn faster produces thinner ink; slow/fast transitions are smooth. Actual stylus pressure is preserved. Event timestamps, not event count alone, drive velocity.
- Smooth pressure outline, rounded taps, controlled start/end taper, final endpoint retained, deterministic rendering and matching hit geometry. Use MIT perfect-freehand with pinned version, no paid SDK.
- Incremental paint appears during pointer movement, uses one algorithm for preview/final pixels, and cancel restores previous pixels. Bristle/dry/wash/smudge profiles differ in actual pixels, with controls for size/color/flow and two independent layers.
- Undo/redo covers both vector and paint gestures; pointer cancellation/capture loss and switching tools never commit a partial mark. Local probe stays clearly labelled unsaved.
- Browser pixel tests prove before-release paint, cancellation, speed-width behavior, color pickup and history; inspect actual rendered strokes in a fresh visual capture.

Implementation owners: shared ink geometry and paint runtime/kernel; existing probe wiring plus focused UI/style modules; owning unit/browser tests. Existing shared pressure geometry keeps its current semantics for compatibility. No production schema/API change or shipping claim in this correction.

Status: correction implemented in the local lab. Review: root inspected the input/render/history boundaries; no independent subagent review claimed for this correction. Physical Pencil acceptance and full Studio integration remain unfinished. This is not tldraw parity or shipment certification.

User acceptance — 2026-09-11 10:40 Asia/Ho_Chi_Minh: “ok hơn nhiều rồi đó, duyệt nha”. The revised local demo is approved. Preserve its speed-sensitive ink, smoothing/taper, live paint profiles and unified undo/redo as the accepted interaction baseline when integrating the production editor. Do not revert these qualities during integration. This acceptance closes the user's review of this demo; it does not assert unmeasured physical-device results or completion of the remaining product phases.

## Implemented

- `ink-stroke.ts`: pinned MIT `perfect-freehand@1.2.3`, timestamp velocity/pressure filtering, quadratic outline, taper and nonzero-winding hit testing. Legacy pressure geometry remains unchanged for existing callers. Package source/docs: https://github.com/steveruizok/perfect-freehand. The standalone HTML includes dependency license notices.
- `paint-stroke.ts`: one incremental CPU draft used by preview, pointer-up, batch and paged execution; fixed source sampling, bounded work, copy-on-write commit and generation conflict rejection. Brush tip/hardness are optional; legacy callers retain their previous pixel behavior. Existing paint/paged tests pass.
- Bristle fibers, stable paper grain, soft wash and color-carrying smudge, with size/flow/color controls. Smudge on blank paper creates no invented color. This is sRGB pickup/deposition, not a physical fluid/pigment simulator.
- Local unified 16-step vector/paint undo/redo using immutable tile snapshots. Two paint layers expose selection/visibility/locking. Readable unsaved-state label, responsive artboard, cursor, keyboard cancellation/undo, pointer capture loss and touch arbitration.

## Verification and limits

- Full `npm test`: 189 passing, zero failures (29,340.53 ms). Added tests cover true velocity width, actual stylus pressure preservation, preview/commit/batch pixel equality for all profiles, cancel/stale generations, color pickup and immutable history forks.
- A new dot hit-test initially failed: the outline can overlap itself, so even-odd testing disagreed with SVG's nonzero fill. Replaced with winding-count testing; all ink tests pass. Hit subdivision is bounded for extreme coordinates and remains an approximation.
- `npm run typecheck` passed. Production build passed with the pre-existing ineffective dynamic-import warning. No public schema, API or production editor capability changed.
- Browser checks cover live pixels before release, undo/redo pixels, cancellation, final endpoint, oversized gesture rollback, timestamp-driven rendered width and GIF behavior. Synthetic timestamp tests prove the code path, not physical input latency.
- Six browser tests pass in each of desktop Chromium, mobile Chromium, WebKit and Firefox (24 executions). A final touch-arbitration guard was subsequently verified by the desktop run; no physical palm-rejection claim follows.
- Actual Playwright mouse gestures produced desktop and 390px-wide captures, visually inspected. Reproduce: `node scripts/probes/build-creative-probe.mjs`, then `node scripts/probes/capture-drawing-quality.mjs`. Output `artifacts/creative-probe.html`, `artifacts/drawing-quality.png`, `artifacts/drawing-quality-mobile.png`. Chromium 153.0.8010.12 reported no page errors.
- There is no direct benchmark against a pinned live tldraw build, no measured hardware input-to-photon latency and no physical Pencil/palm/tilt evidence. The full product plan remains in progress; this correction is not production integration.

Docs impact: internal lab/runtime only. The production documentation must not advertise these as shipped controls. No commit, push, deployment or memory write. No new long-running dev server; the isolated E2E harness uses 19203 and owns its cleanup.

Unresolved product questions: none. Open evidence: reference-quality comparison, physical-device behavior, full Studio integration and remaining accepted feature phases.
