# Elements and GIF runtime delivery

Current implementation/status update: [2026-09-11 checklist reconciliation](implementation-checklist-reconciliation.md). The measurements and remaining-work statements below describe their earlier execution snapshots; the reconciliation records later implementation and desktop evidence without claiming final CI, hardware or release acceptance.

Implemented original MIT sticker/emoji artwork, searchable names/keywords/Unicode, six supported thumb skin variants, owned image/GIF uploads, painting insertion, vector recoloring helper. Artwork is rendered from deterministic vector recipes into supported PNG assets; stable recipe identity and attribution are retained for recoloring. Imported SVG is parsed in a detached XML document, checked against a primitive/attribute allowlist, then decoded and uploaded as PNG with explicit flattening feedback. Scripts/external resources are rejected. PNG/JPEG/WebP/GIF imports remain supported.

GIF control/view use canonical `boardGifFrame` milliseconds. Bounded decoder retains original source, timing, disposal, transparency and a ten-minute duration limit. Raster headers bounded before client decode. Panel uploads PNG posters through existing project-owned assets API. Reduced-motion displays saved poster sample. Each GIF renders at its own position in the SVG element sequence.

## Integration

- `CreativeElementsPanel`: doc, boardId, optional projectId, onCommit(base,next), optional onInserted(id).
- `CreativeGifElement`: element, board, doc, timeMs; import from creative-elements-gif.tsx.
- `CreativeGifControls`: Elements props plus element/timeMs; import from creative-elements-gif-controls.tsx.
- `useCreativeMotionTime(playing)` supplies shared board elapsed milliseconds.
- `recolorBundledSticker(doc,element,color)` asynchronously regenerates PNG pixels and returns a validated clone, preserving original assets.
- `inspectElementImage(bytes,mime)` may be reused by server asset admission. Parent owns server enforcement.

DocumentView renders board GIFs through CreativeBoardView. Export-page samples exact GIF pixels into cloned image references before any asynchronous capture. Static export uses saved poster. Motion/video use explicit seconds converted to canonical milliseconds. Published viewer derives playing GIF duration even without a document timeline. GIF-only video derives a 30 fps timeline. React prototype manifest includes runtime source plus gifuct-js.

## Verification

- TypeScript check passed after integration changes.
- Renderer/viewer build passed.
- Focused catalog/GIF tests: 10 passed.
- Chromium pixel export test: passed; actual source GIF, timestamp-dependent red/green pixels, blue vector above, paused stability, gray static poster, original document untouched.

## Limits

- Firefox/WebKit and full published/MP4/PDF end-to-end export matrix not run in this subtask.
- SVG import supports a bounded static primitive/gradient subset; unsupported elements/resources fail visibly. Imported vectors are flattened.
- Parent owns public-contract documentation and server/client surface parity.

## Follow-up integration

Live GIFs now inherit frame clipping and parent opacity and expose a transparent hit rectangle. Portable React source packaging traverses relative/type-only imports so shared validator/diagram dependencies stay included. Browser SVG test passed for actual red-gradient pixels and rejection of six active/external inputs. Board UI specs are written for desktop/mobile; parent owns harness execution.

## Bundled artwork contract correction

Full editor E2E found bundled SVG data URLs incompatible with the document's raster-only asset URL policy. Bundled artwork now rasterizes its known vector recipe to 512×512 PNG, retaining stable recipe identity/attribution separately. Recoloring regenerates PNG asynchronously, validates the complete document, and preserves prior immutable asset bytes. The selected-sticker control uses the panel's chosen color. No SVG data URL allowance was added to the document schema.

The new Chromium regression exercises actual artwork generation, shared mutation, full document validation, rename, recolor and PNG pixel readback. All three browser render/import/artwork tests passed. Full application E2E remains parent-owned and must confirm insertion/recolor/save/reopen.
