# Responsive design workspace

Status: In progress. Owner: frontend agent. Estimate: 10h.

Read [architecture](../../docs/architecture.md), [product brief](../../docs/product-brief.md), and screenshots under `D:/www/oss/design-studio/screenshots/`. May create/modify only `D:/www/oss/design-studio/src/app/**`. Shared modules and backend routes are controller/backend owned.

1. Build project library with real persisted data, empty/error states, search, filters, sorting, and creation from templates.
2. Build chat, preview, and manual inspector/editor with responsive panel behavior. Support selection, moving/resizing, properties, layers/pages, undo/redo, save state, and conflict feedback.
3. Expose design systems/themes/templates, imports/assets, all six design kinds, 3D controls, and timeline playback/editor using shared primitives.
4. Integrate authentication, masked provider settings for text/image/audio/video, API-token management, publish, and exports. Show missing configuration and upstream failures usefully.
5. Register WebMCP tools through feature detection, prefer current `document.modelContext`, support legacy surfaces only when present, and clean up registrations.

Acceptance: create/edit/save/reload works; a failed generation preserves the design; revision conflicts are visible and do not overwrite newer edits; exports contain visible content; mobile panels remain reachable; keyboard interaction and basic labels are usable. Verify desktop and narrow touch viewports in a real browser with screenshots. No static sample project counts, fake upload progress, or simulated success.

Risk: stale API assumptions. Use the exact architecture request/response envelopes and shared imports; ask the controller to resolve mismatches. Roll back UI components while retaining the document and API formats.

## Reconciled progress — 2026-09-07

- [x] Persisted library, templates, chat/manual editor, panels, settings, assets, 3D/timeline controls, and exports implemented.
- [x] Revision conflicts and unconfigured-provider paths preserve saved designs.
- [x] WebMCP registration is feature-detected with cleanup and ordinary UI fallback.
- [x] Latest isolated desktop/mobile end-to-end run passed 2/2, as reported by the controller.
- [ ] Verify conversation reload and source-media options against the final backend build.

The UI is English; document content supports Unicode. Experimental WebMCP is not a claim of universal browser availability. See [finalization](reports/finalization.md).

3D orbit-camera adjustments are temporary preview state. Saved geometry, material, and object rotation persist; do not claim camera orbit serialization.
