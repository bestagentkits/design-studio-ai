# Keyboard and focus UX repair

Status: implementation verified; shipping to main and production requested

## Outcome
Keyboard actions operate on the focused control, never silently mutate a design behind navigation, previews, or overlays. Audit and repair interactions similar to thumbnail navigation.

## Scope and constraints
- Keep the existing thumbnail repair and all real API/persistence behavior.
- Inspect layers, editor/inspector/mobile navigation, settings, appearance menus, modal lifecycle, and global shortcuts.
- Fix reproducible focus/navigation conflicts; preserve text editing, native inputs, and intentional canvas shortcuts.
- No visual redesign or provider changes. User subsequently authorized shipping to main, merge, and production deployment.

## Work
- [x] Inspect keyboard owners and current tests.
- [x] Reproduce suspected conflicts with real local browser tests.
- [x] Share bounded group navigation where controls already select sibling items.
- [x] Isolate shortcuts and restore modal/menu focus correctly.
- [x] Run desktop/mobile regression tests, typecheck, unit suites, build, and review diff.
- [x] Update smallest owning docs with verified behavior and report limitations.
- [ ] Commit and open a reviewed PR; require green CI on its exact head.
- [ ] Merge to main, verify deployment and public production health.

Evidence: [verification report](reports/verification.md).

## Acceptance
- Left/right changes focused horizontal choices; up/down changes focused layers/vertical choices without nudging nodes.
- Navigation retains focus and makes the chosen item visible; boundaries do not scroll accidentally.
- Dialogs, popovers, ordinary controls, preview and native editing do not leak destructive shortcuts to the canvas.
- Closing overlays preserves the underlying selection and returns focus to the opener.
- Canvas nudge/delete/duplicate and undo/redo still work in their intended context.

## Validation and rollback
Use the isolated E2E harness on port 18480, sequential device runs; port 8791 belongs to another worktree. No real user projects. Revert only this task's changes if necessary. Browser tests document supported Chromium behavior, not universal browser support.
