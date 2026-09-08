# Browser 3D authoring

Status: Complete — implemented and locally verified

## Implementation

Scene graph, shared rendering, mesh vertex/edge/face tools, parametric modeling, materials, UV editing, skeleton/weights and clips. Browser computation and export GLB/glTF; explicit limits/cancellation for expensive work.

## Acceptance

Geometry invariants, UV/skin roundtrip, GLB import validation, browser interactions and export inspection.

Evidence: [implementation status](reports/implementation-status.md). Format/runtime boundaries remain explicit.

## Safety and rollback

Keep old documents readable. No deployed data resets or secret changes. New behavior uses shared validators. Revert source additions if needed; retain user documents and additive migrations.
