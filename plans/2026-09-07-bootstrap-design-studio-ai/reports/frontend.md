# Frontend delivery

Status: DONE_WITH_CONCERNS

## Delivered

- Responsive React/TypeScript workspace with ivory, ink, and coral visual language informed by the supplied screenshots. Actual document previews form the gallery; user project lists use authenticated server data only.
- Brief interview, all catalog templates and six design kinds, blank canvases, custom theme tokens, project search/filter/sort/grid/list, duplication and deletion.
- Authentication, masked provider connections, API token creation/revocation, MCP connection address, and capability-detected WebMCP. Browser tools read, patch, replace validated documents, and explicitly save with revision checking.
- Conversation-driven generation with persistent message API integration, preserved current document on provider failure, and explicit AI proposal review/apply/discard.
- Document editing: selection, drag, resize, direct text input, properties, layers, order, visibility, locks, duplicate/delete, theme palette/fonts/spacing/radius, page presets/copy/delete, reusable blocks, undo/redo, explicit save and unsaved-change exit handling.
- Upload assets and preview media. BYOK image/speech/music/video controls include source assets, supported durations, transformation strength, voice/model options, and generic asynchronous job checking.
- Actual lazy-loaded Three.js scene renderer with orbit/zoom/object selection, GLB loader, six geometries, material/rotation/position/scale properties, and renderer disposal.
- Timeline interpolation, playback/scrubbing, keyframe insertion and edits at the current time. Node selection aligns with animated positions. Page duplication/deletion preserves valid timeline references.
- Cloud-first JSON/SVG/HTML/PNG/PDF/PPTX/WebM/MP4 exports; exports save current changes and submit the resulting expected revision. Browser fallback is explicit after failure and states its format limitations. Google Slides uses GIS and presents a concrete result link. Public publishing returns a snapshot URL.
- JSON imports preserve source documents. HTML imports editable text/images; SVG imports text/rectangles/images. Permanent import summaries explain unsupported CSS/layout, paths, transforms, filters and scripting rather than pretending full conversion.

## Verification

- `npm run typecheck` passed, including the CLI checks owned by the controller.
- `npm run build` passed. Three.js is split from initial load: main JavaScript is approximately 394 KB (119 KB gzip), with the scene renderer loaded only when needed.
- Real Playwright browser checks against the shared Node runtime: homepage at 1440 px and 375 px; authenticated registration and project creation; no browser page errors or horizontal mobile overflow.
- Three.js torus-knot scene rendered, changed to sphere, rotated, and saved. The 375 px view retains named Save/Export/Share controls and has no horizontal overflow.
- Timeline moved to 2 seconds; editing Y to 300 produced a persisted keyframe `{time:2,values:{y:300}}`. Copy/delete page counts changed 1 → 2 → 1.
- Blank project creation verified zero layers.
- Independent integration tester also reported desktop text/theme/save/reload/search/filter/duplication/publication passing; its final desktop/mobile run is owned by the controller.
- Screenshot evidence: `home-desktop.png`, `home-mobile.png`, `editor-desktop.png`, `editor-3d.png`, `editor-3d-mobile.png`, `timeline-desktop.png` in this directory. Earlier 3D screenshot includes the temporary message-route warning described below.

## Limitations and integration notes

- The shared local API process still returned 404 for the newly added messages route during the final blank-project smoke. The controller owns this route and must restart the API with its implementation before release. The UI reports this failure and does not simulate persisted conversations.
- No live provider or Google OAuth credentials were supplied to this frontend task. Configuration/error states and actual route wiring are implemented; external generation and Google account authorization require live verification with configured credentials.
- Native WebMCP is absent in the tested Chromium browser. The UI says so; it does not advertise active browser tools when the platform is unavailable. Network MCP remains available.
- The 3D orbit camera is an inspection view and is not serialized. Cloud exports render the declarative objects into their document rectangles; the camera composition can differ from the temporary viewport orbit.
- Browser fallback PowerPoint consists of rendered slides, PDF opens the print dialog, and WebM is silent timeline animation. Browser fallback uses only browser-generated PNG bytes with pptxgenjs, avoiding arbitrary uploaded image parsing. Cloud export remains primary and its independent format verification belongs to the controller.
- HTML/SVG import is deliberately a clearly disclosed partial conversion; unsupported elements are not executed or silently presented as preserved.
- No server or background process was started by this frontend task; the controller's existing port 8787 was reused. All temporary browser instances were closed.

Unresolved questions: none. Frontend file ownership is released to the controller.
