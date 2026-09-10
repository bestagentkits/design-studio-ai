# Native character motion implementation decisions

- Execution authorized by user, including opening a PR and merging main. Baseline ee7ab1b; integrated main 7c75557 in 9507f53.
- Native Studio schema v2; v1 readers/writers retained, server rejects downgrade. Character IDs are document scoped; bone/slot/attachment/clip IDs are rig scoped. Existing JSON persistence and revision remain the owner; no migration.
- Shared named operations validate entire transactions. Geometry is an atomic merge field; topology version binds FFD keys. Character package import creates new character/asset IDs, retaining rig-local identities.
- Pixel x/y and degree rotation; local TRS hierarchy. Authored full turns interpolate directly. Reparent preserving world pose rejects shear. Singular inverses produce explicit failures or solver no-op rather than NaN.
- Clip time is local. Scene placements blend sequentially in list order; weights interpolate the accumulated pose, additive uses setup reference, masks include descendants. This is ordered blending, not normalized simultaneous averaging.
- Outgoing per-property easing; discrete attachment/order hold. Loop time modulo duration, nonloop final pose clamped. Placement final pose inclusive; export frame range end exclusive.
- Clips → sliders → dependency ordered IK/transform/path → fixed-step spring physics. Physics 120 Hz, revision/object scoped cache and bounded cold seek work. Bake writes a new clip with solver mixes disabled to avoid double application.
- Native WebGL textured triangles chosen from spike evidence; no new graphics dependency. Canvas2D handles unavailable/lost contexts and multiply blending, whose transparent backdrop cannot use the simple fixed-function WebGL blend equation. SVG adapter serves static output and existing ordered 3D composition.
- Existing main scene composition remains authoritative for 3D pages. Two-dimensional characters participate through shared SVG evaluation in those ordered layers; standalone 3D nodes on DOM character pages have transparent isolated canvases.
- PNG layers and optional placement manifest use owned uploads. Native ZIP import reads bounded JSON entries only, never executes package HTML/player; embedded image bytes go through normal owned upload validation.
- Motion AI context contains rig graph, image metadata and character placements, omitting unrelated page text/media URLs. Dedicated proposal allowlist; current document and brief revisions returned and checked again on apply.
- UI graph/mesh/rig gestures commit on pointer release; pointer cancellation leaves source unchanged. Numeric alternatives remain available. Auto-key starts off; setup and draft animation pose remain separate.
- Game/Spine/PSD adapters are not implemented or implied. User did not request a particular interchange version or engine. Native export is explicitly labeled; GLB/glTF reject character content instead of dropping it.
