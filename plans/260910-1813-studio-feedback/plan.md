# Studio feedback

Status: in progress

## Outcome and acceptance
Deliver all reported home, navigation, thumbnail, editor, 3D, motion, presentation, template and design-system improvements. Human controls remain keyboard/touch usable; saved changes use existing shared document validation and services. Back/Forward and reload restore meaningful screens. Thumbnail previews reflect actual saved documents. Texture/material edits persist and layer composition honors ordering. Cross-browser, mobile and desktop verification required.

## Constraints / non-goals
Preserve authentication, revisions, exports and existing documents. No fake previews, reset databases, paid provider calls, or new rendering schema without need. Use shared component props and scene material fields. Decorative animation respects reduced motion. Do not introduce new UI frameworks or standalone design-system implementations.

## Inspection and reviewed approach
React/TypeScript/Vite, Hono shared server, Three.js scene runtime. App navigation currently loses project history; docs/guide own divergent headers. LayerTree drag/drop has no placement feedback. SceneView places 3D canvas separately from 2D overlays. SceneInspector exposes only part of existing material schema. Component props already serialize but lack an inspector. Extend these existing owners rather than duplicate contracts. New presets use supported Ant/shadcn renderers with clearly attributed visual inspiration.

## Work
- [ ] Shared public navigation, home decoration, project thumbnails, route/history state.
- [ ] Layers DnD, component icons/properties, collapsible editor panes, preview toggle.
- [ ] Material/texture tools, camera/light layout, 3D/2D composition order.
- [ ] Motion workspace and Space playback; presentation controls and contrast.
- [ ] Additional use-case templates and well-known system-inspired presets.
- [ ] Owning docs and generated discovery synchronization.
- [ ] Tests, browser checks, review, ship/deploy per standing authorization.

Review: scope maps to existing owners; no material user decision missing. Keep library presets distinguishable from official framework implementations. Review each change against above acceptance before completion.
