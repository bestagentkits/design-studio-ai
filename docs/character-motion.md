# Character motion

The public [motion guide](https://studio.agentkit.best/docs/motion) is authored in [motion-documentation.tsx](../src/app/motion-documentation.tsx). Use Setup to assemble imported PNG layers, Animate for local clip time and per-property curves, and Compose for instance skins and scene placements.

## Contract and ownership

[character-schema.ts](../src/shared/character-schema.ts) owns rig/clip/instance fields; [character-validation.ts](../src/shared/character-validation.ts) validates references, geometry, asset IDs and dependency cycles. [schema.ts](../src/shared/schema.ts) retains v1 and adds optional characters in v2. Adding a character upgrades the document; server writes reject a schema downgrade. No database migration is needed: documents remain JSON in the existing versioned row.

[character-operations.ts](../src/shared/character-operations.ts) supplies named operations through the existing REST, MCP, WebMCP and CLI validators. Transactions validate only after all operations, so a bone and its slot can be changed together. Deletions never silently cascade through rigs. IDs are character-scoped internally, document-scoped for character definitions; instances can reuse the same definition. Cloned projects copy assets and remap attachment image/frame IDs.

Geometry is an atomic merge field. Concurrent edits to one mesh conflict even when separate arrays changed. Key IDs allow independent channel/key edits; duplicate times fail validation. Topology version must match deformation channels. Reparent-with-world-pose refuses shear, which the TRS model cannot represent.

## Runtime

[character-runtime.ts](../src/shared/character-runtime.ts) evaluates setup → clips/masks → sliders → ordered constraints → fixed-step spring physics. x/y are local pixels; rotation is degrees and retains authored full turns. Keys use their outgoing easing, sparse channels use setup values, discrete attachment/order keys hold. Looping clip time is modulo duration; nonlooping clips clamp to the final key. Scene placements use inclusive end for their final pose; exported frame ranges exclude end.

[character-webgl.ts](../src/shared/character-webgl.ts), [character-canvas.ts](../src/shared/character-canvas.ts), and [character-svg.ts](../src/shared/character-svg.ts) share affine and weighted vertex evaluation. Native WebGL handles textured triangles and up to eight stencil masks; Canvas2D provides context-loss/unavailable fallback. The static SVG representation retains mesh textures using clipped affine triangles. Runtime shaders are trusted application code, never document inputs.

## Agent and export workflows

`GET /api/projects/:id/motion` returns compact rig/clip/skin IDs and optional pose sampling via `characterId`, `nodeId`, `time`. MCP `inspect_motion` and CLI `dsa motion` use it. Writes use the regular operation and expected document revision contract.

Generation `mode: motion` returns operations plus preview document and base document/brief revisions. `PUT /document` accepts `expectedBriefRevision` for atomic proposal application. Manual editing does not require brief approval. Provider success must be tested with a configured account; validation tests do not establish live provider quality.

[export-contract.ts](../src/shared/export-contract.ts) owns format/range fields. `motion` returns native ZIP with embedded media/player; `png-sequence` and `spritesheet` return PNG files plus time/rectangle manifest. `start`, `end`, `fps` control sampling, with bounded frame/pixel counts. HTML/React use trusted bundled sources. Game engines, Spine file import/export and PSD parsing are separate integrations, not implied by this native format.

## Verification

Use focused character tests and the isolated browser harness. Runtime spike results in the implementation plan measure CPU submission and synchronous layout, not full device FPS. Full frame latency, blend/alpha fidelity and context-loss behavior need browser tests and artifact inspection before claiming parity. Do not interpret a build as proof of live provider generation or deployment.
