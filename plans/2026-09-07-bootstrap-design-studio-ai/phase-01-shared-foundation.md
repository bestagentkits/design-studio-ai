# Shared document, catalog, and rendering

Status: Completed. Owner: controller. Estimate: 8h.

Read [architecture](../../docs/architecture.md) and [product brief](../../docs/product-brief.md). Create `D:/www/oss/design-studio/src/shared/**`; the controller also owns root package/tooling configuration. Other agents consume these files and report missing interfaces rather than editing them concurrently.

1. Define the exact v1 document, project, theme, asset, and timeline types from the contract. Export runtime validation and actionable validation errors.
2. Implement blank documents and real templates/themes for all requested document kinds. Templates are deliberate starter content, clearly identified as templates.
3. Implement node operations, selection updates, page operations, undo/redo-compatible immutable edits, and timeline interpolation.
4. Implement safe HTML/SVG generation and reusable render primitives; allowlist style/URL properties and escape all content.
5. Provide portable exports and browser export hooks, including valid PNG, PDF, PPTX, Google Slides, and timed video with actual assets and pages.

Acceptance: shared roundtrip works for every kind, IDs and hierarchy are validated, malicious style/markup cannot execute, keyframes interpolate predictably, export bytes match the declared format. Start with schema/operation tests; then parse exported SVG/HTML and inspect generated document archives. Never declare support through extension-only file renaming.

Risk: renderer/export divergence creates misleading previews. Compare the same known document across canvas, HTML/SVG, and exported pages. Roll back individual renderer changes without modifying the stored document version or deleting projects.

## Reconciled progress — 2026-09-07

- [x] Versioned runtime schema, semantic validation, and targeted revision-compatible operations implemented.
- [x] Themes/templates/blocks and six document kinds available through shared code and CLI.
- [x] Schema/operation/static-render checks and real cloud PNG/PDF/PPTX verification completed.
- [x] Four viewer regressions passed; Docker smoke inspected real 3D PNG, WebM, and interactive HTML alongside PNG/PDF/PPTX.
- [x] Final integrated results: 46 tests, passing Linux typecheck/build/CI, 16 production and 16 Docker smoke checks.

Evidence and format boundaries: [finalization](reports/finalization.md), [architecture](../../docs/architecture.md#rendering-and-export). Cloud WebM was decoded by ffprobe after the recorder fix; SVG remains static, PPTX complex nodes are rasterized, and MP4 depends on encoder availability.
