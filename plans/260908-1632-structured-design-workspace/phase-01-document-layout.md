# Shared document and layout

Status: Complete — implemented and locally verified

## Implementation

Typed containers, component instances, scene geometry, animation and presentation settings; preserve v1 legacy coordinates. Implement shared hierarchy/layout resolution and semantic operations. Validate cycles, references, units and limits.

## Acceptance

Schema/operations/layout tests, legacy fixtures and renderer tests.

Evidence: [implementation status](reports/implementation-status.md). Format/runtime boundaries remain explicit.

## Safety and rollback

Keep old documents readable. No deployed data resets or secret changes. New behavior uses shared validators. Revert source additions if needed; retain user documents and additive migrations.
