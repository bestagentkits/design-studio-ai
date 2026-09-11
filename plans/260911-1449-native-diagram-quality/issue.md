## Problem
Native diagrams currently look and feel substantially below the requested Excalidraw reference: doubled jitter outlines, approximate text wrapping, uniform templates, crowded connections and form-heavy editing. The existing Creative Playground demo exposes these limitations.

## Accepted direction
Build native Design Studio AI diagram authoring. Do not embed Excalidraw or adopt its editor/document model. Excalidraw is a visual and interaction reference only. Keep permissive self-hostable dependencies, shared canonical documents and browser/REST/MCP/WebMCP/CLI parity.

## Scope
- Natural deterministic sketch strokes and clean mode, configurable roughness, width, bowing, solid/dashed/dotted strokes and solid/hachure/cross-hatch fills with angle, gap and opacity.
- Self-hosted handwriting font with Vietnamese coverage, customizable family/size/alignment/color, accurate measurement/wrapping and content-aware node sizing; matching editor and export.
- Improved flowchart, architecture, user-flow and multi-level mind-map templates and family-aware layouts.
- Connections with safe source/target exits, obstacle avoidance, rounded elbows/curves, consistent arrowheads and readable adjustable labels.
- Direct label editing, visual connection/bend manipulation, snapping/alignment, contextual controls, keyboard authoring and editable reusable style presets/defaults.
- Preserve user overrides, pins, locks, groups, undo/redo, existing documents and semantic agent operations.

## Acceptance
- Four realistic editable diagrams reviewed visually at usable zoom, including Vietnamese and long labels.
- No node/label overlaps in acceptance samples; edges do not cross their bound nodes; drag/resize/font edits preserve bindings and readable text.
- Sketch and Clean presets plus per-object and board-wide customization persist through save/reload.
- SVG/PNG/PDF use consistent geometry and self-hosted fonts; inspect actual exports.
- Focused geometry/schema tests, browser authoring tests, typecheck, full tests/build, synchronized docs and generated capability references.
- Report browser coverage and remaining physical-device limits honestly. Functional tests alone do not establish aesthetic equivalence.
