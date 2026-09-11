# GIF decoding and timeline feasibility

Date: 2026-09-10. Status: DONE_WITH_CONCERNS. Real deterministic GIF byte decoding/composition is implemented as internal shared helpers; no production UI, asset pipeline, public contract or export wiring was added.

## Release evidence and choice

Use **gifuct-js 2.1.2**, exact runtime dependency installed by the controller. Inspected the released tarball in `/tmp/dsa-gif-probe` (no dependency modifications by this subtask). The tarball contains MIT LICENSE, CommonJS runtime and TypeScript declarations. It depends on `js-binary-schema-parser` and exposes `parseGIF`/`decompressFrame` for actual palette/LZW/interlace decoding. [Upstream API explanation](https://github.com/matt-way/gifuct-js) distinguishes decoded image patches from host-owned disposal/compositing.

[Release tarball](https://registry.npmjs.org/gifuct-js/-/gifuct-js-2.1.2.tgz):

- SHA-256: `6c7d1a46e36ce1ede8de4f928683bd6801022fd112342aebb36604d9d064e9f7`
- npm integrity: `sha512-rI2asw77u0mGgwhV3qA+OEgYqaDn5UNqgs+Bx0FGwSpuqfYn+Ir6RQY5ENNQ8SbIiG/m5gVa7CD5RriO4f4Lsg==`
- `src/index.js` supplies raw patch/decompression behavior; `src/lzw.js` pads incomplete output with palette index zero. The wrapper must validate compressed image structure and exact decoded length before trusting that permissive behavior.

## Implemented boundaries

- `src/shared/gif-bounds.ts`: reads actual GIF87a/89a byte blocks before calling the external parser. Validates canvas/frame rectangles, palette presence, source/frame/cumulative-pixel/memory budgets, sub-block truncation, LZW code size, dictionary references, output lengths and end-of-information marker. Rejects unknown graphic extensions, user-input waits, disposal modes 4–7, missing trailer and trailing bytes with explicit errors. The LZW check validates lengths without allocating image pixels; the actual decoding still runs through the released package.
- `src/shared/gif-timeline.ts`: keeps a copied original byte asset, derives per-frame RGBA patches, selects frames using explicit elapsed time, and composites without a browser or uncontrolled animated `<img>`. Selected-frame output is deterministic and supports out-of-order seeks.
- `tests/gif-timeline.test.ts`: actual encoded GIF bytes, not arrays standing in for decoded GIF frames. A tiny valid GIF89a writer generates four independently timed frames. A second embedded GIF is produced by released MIT **gifenc 1.0.3** in scratch and tests nontrivial LZW dictionary growth. No encoder dependency was added to the project.

The externally encoded 32×32 fixture SHA-256 is `61dd5d9ddc9519d7fd5da9b0d55d105e3751fce4db3322008d79b76485a7677a`. Its palette is `[i*17,255-i*17,i*7]` for indices 0–15. Starting at seed 42, xorshift32 (`<<13`, `>>>17`, `<<5`) low four bits generate its 1,024 palette indices; the test checks every decoded pixel against that independently specified sequence. Generation used `GIFEncoder().writeFrame(pixels,32,32,{palette,delay:50,repeat:0})`, then `finish()`.

## Explicit semantics

- Durations are centiseconds converted to milliseconds. Absent or zero delays use the declared 100 ms fallback; positive durations remain exact. No browser-dependent minimum-duration clamp.
- Disposal 0/1 retains prior pixels; 2 clears the disposed rectangle; 3 restores the canvas before that frame. Transparent pixels do not overwrite prior content. Restore-background clears to transparent for a transparent frame and to the logical global background otherwise. This is an explicit alpha policy; the [GIF89a specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt) defines disposal and palette transparency but does not define a browser's surrounding transparent page surface.
- Absent loop extension plays once, loop count zero repeats indefinitely, positive count means that many repeats after the first cycle. Explicit `loop` overrides encoded repetition. Completed finite playback holds the last frame.
- `startMs` is document timeline time; `pausedAtMs` is animation-local elapsed time. Before start, the selected poster frame is returned. Paused playback ignores changing document time. Static exports can call `renderGifFrame` with an explicit poster index.
- The original GIF remains byte-for-byte available. Neither patches nor flattened posters replace the authoritative owned asset.

## Bounds and measured checks

Defaults are provisional decode safety guards, not measured product capacity: 20 MiB input, 4096² logical pixels, 300 frames, 32 Mi cumulative patch pixels, estimated 256 MiB working bytes. The estimate accounts for compressed parser storage, patch cache, current decoded palette indices and two compositor buffers. It is **not** an observed heap/RSS bound. Callers must supply their workload-specific validated budget and run decode in a cancellable worker or isolated export task before public exposure.

Executed on Node 25.2.1:

```sh
npx tsx --test tests/gif-timeline.test.ts
npx tsc --noEmit --pretty false
```

Both pass. Five focused tests verify: source-copy preservation; exact colored pixels for transparency and disposal 1/2/3; out-of-order seeks; durations 20/30/40/50 ms; frame boundaries; finite/infinite/no-extension loops; pause/start/poster; local color tables; zero-delay policy; opaque background restore; dictionary growth from external encoder; byte, frame, pixel and working-memory rejection; truncation and early LZW termination rejection.

## Remaining integration and evidence

No claim of the full three-GIF/vector-overlay acceptance workload: mixed z-order, transforms, clipping, selection/hit-testing, publication assets, original-byte clone/reload, WebM/MP4 timing, reduced-motion UI and export samples remain unimplemented. Helpers produce RGBA bytes; they have no independent DOM layer, so the parent compositor can order them with vectors and Paint without an overlay topology constraint.

No physical-device/browser performance, large-corpus GIF compatibility, cancellation latency, adversarial fuzzing, interlacing fixture or peak-memory measurement was run. Decoding is synchronous and replay-to-selected-frame is linear in earlier frame patches; production needs a bounded worker/cache policy. Helpers are not wired to public uploads or APIs and do not by themselves authorize untrusted main-thread decoding. Font/catalog/media provenance is unrelated to the decoder's MIT license and remains asset-owned.

Docs impact: internal feasibility only; owning report records choices. No evergreen product capability is claimed.
