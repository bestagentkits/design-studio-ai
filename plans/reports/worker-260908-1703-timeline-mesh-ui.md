# Timeline and mesh authoring

Status: DONE_WITH_CONCERNS

## Delivered

- Timeline node/property creation, property rows, numeric/color value editing, track deletion, mute/lock, snapping and zoom.
- Multi-key selection, delete/copy/paste, atomic drag/keyboard movement and speed retiming. Collisions and differing easing at shared timestamps reject without replacing animation. Bezier controls obey locks and bounds.
- 3D transform and bone position/rotation property entries; captures current interpolated values with legacy scene defaults.
- Mesh operation payload validation rejects unknown operations, malformed vectors and invalid selection. Planar UV chooses largest mesh axes.
- Mesh workers cancel cleanly and reject results when current scene changed. Face/edge/vertex operations use correct indices.
- UV vertex selection and drag editing; bone naming, parenting, transform, normalized primary/remaining weights, bind/unbind, and guarded bone deletion.
- Viewport reuses renderer on playback; catches initialization failure, cleans async scene/control resources, highlights selected geometry, picks nearest edges, and displays unbound skeletons/joints.

## Evidence

- `npm run typecheck` passed after implementation.
- `npx tsx --test tests/document.test.ts`: 6 passed.
- `npx tsx --test tests/structured-design.test.ts`: 18 passed.
- Inline assertions: malformed mesh payloads, face bounds, translation/subdivision/planar UV; atomic timeline move, collision, bounds and locked track.

## Integration and limitations

- No new styles required; uses existing motion/mesh classes.
- UI/browser fidelity still needs controller's browser suite; this worker did not launch a competing server.
- Easing remains shared by all properties at one track timestamp, matching the document schema; UI states this and rejects conflicting moves/paste.
- UV viewport displays up to 3,000 base points plus selected vertices; indexed selection reaches all mesh vertices.
- Imported glTF geometry is retained; interactive mesh editing operates on converted primitives, as the existing schema/workflow supports.
- Controller notified to preserve legacy transform defaults when interpolating new scene properties, and to clean partially built scenes/skeleton textures inside scene-runtime.

Unresolved questions: none.
