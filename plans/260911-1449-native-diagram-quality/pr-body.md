Native diagrams previously used doubled outlines, approximate typography and uniform layouts; editing labels and connections relied heavily on forms. This change adds native Sketch/Clean rendering, four self-hosted Vietnamese-capable fonts, content-sized layouts for all four diagram families, editable appearance defaults/presets, direct labels and visual connection handles. Excalidraw remains a reference; no editor is embedded.

Human and agent edits use the same extended document/operation schemas. Partial updates preserve ports and existing overrides. SVG carries embedded fonts/licenses; connector exits, curve labels, rotated nodes, locked descendants and transparent/hatched hit targets have focused coverage.

Validation: typecheck, CLI build, full unit/integration tests, production build, creative browser regressions, cross-browser native diagram tests, and actual SVG/PNG/PDF inspection. Final counts and release state are tracked in `plans/260911-1449-native-diagram-quality/reports/delivery.md`.

Physical iPad/Pencil verification is unavailable. Custom nonbundled fonts require installed/loaded faces; server-only metrics are approximate. Orthogonal routing avoids obstacles; curved/manual routes remain directly adjustable. This is not a claim of complete Excalidraw parity.

Fixes #32.
