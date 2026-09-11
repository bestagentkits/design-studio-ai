# Diagram and Board implementation evidence

Current implementation/status update: [2026-09-11 checklist reconciliation](implementation-checklist-reconciliation.md). The measurements and remaining-work statements below describe their earlier execution snapshots; the reconciliation records later implementation and desktop evidence without claiming final CI, hardware or release acceptance.

Implemented shared semantic schemas, four family presets/examples, operations for node/create/update, connect/reconnect/detach, labels/arrows/bends, selected layouts, mind-map child/sibling/reparent/collapse/pin. Native MIT-source algorithms provide cyclic graph layering, tree/radial layouts, transformed port anchors, manual bends, self-loop paths and bounded obstacle-aware orthogonal routing. Added stale-layout ticket comparison. Diagram panel exposes the shared actions.

Integration owners remain parent: operation registry/server capabilities, schema, renderer, font loading, clipboard save operation and public documentation. Board thumbnail validation confirmed in creative-validation.ts.

Board review fixes: inherited lock checks, reflection orientation, rotation-aware bounds, preserved endpoint bindings on transforms, resolved external anchors on duplication/ungroup, nested ungroup parent repair, group root selection, equal-gap distribution. Added board-selection.ts capture/duplicate bundle to preserve mind-map hierarchy and external connector positions.

Verification: `npx tsx --test tests/board-editing.test.ts tests/diagrams.test.ts` passed 16/16. Final `npm run typecheck` passed after parallel changes completed. No browser test or live provider/export evidence claimed.

Remaining limits to verify: obstacle router budget is 100 obstacles/50000 visits and reports explicit failures; native layouts preserve pins but do not optimize crossings; nonuniform scale on rotated elements reports unsupported shear rather than distort geometry; browser label rendering uses shared deterministic text wrapping, with actual font readiness owned by integration. Keyboard mind-map commands are Alt+Right/Alt+Enter and explicit touch buttons. Direct connector label inputs currently share node label field. Parent must finish pending renderer curve/self-loop and label-font/position integration, preserve clipboard mindMap on paste, and verify browser workflows.
