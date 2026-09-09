# Editor interaction delivery

Status: DONE
Work context: `/Volumes/GOON/codex/worktrees/ba17/design-studio-ai`

## Delivered

- Unified ordered canvas/layer selection. Shift toggles membership; touch checkboxes mirror selection. Batch moves, nudges, duplicate/delete/group/ungroup operate on eligible roots once; locked subtrees protected; flow-layout rules retained. One undo snapshot per action, not pointer click.
- Discrete shortcuts and accessible help: select all, group/ungroup, duplicate/delete, nudge, save, undo/redo, text editing/insertion, deselect, fit. Preserved local input, IME, dialog, preview and layer-navigation ownership. Space-pan restricted to canvas.
- Transparent inline text draft with resolved typography, measured structured layout, accumulated rotation/pivot and opacity. Escape cancels; blur or Command/Control+Enter commits one undo state. Command/Control+S commits and saves. Concurrent text changes reject overwriting the draft.
- Accessible searchable font combobox/listbox with bounded twenty-family preview loading, system/custom fonts, keyboard navigation, explicit apply, blur commit, and loading-failure feedback. Empty-result ArrowDown/Enter guarded and tested.
- Compact labelled icon actions, selection count and transformation boundary, larger touch checkbox targets. Existing lock/unlock remains usable.
- Fixed hidden mobile canvas fit: ignore zero-sized viewport to prevent negative scale and mirrored/stale DOM selection bounds.
- Discrete allowlisted edit-intent telemetry; no content, font names, coordinates or raw errors captured.

## Files

Modified: editor.tsx, document-view.tsx, layer-tree.tsx, font-picker.tsx, canvas-gestures.ts.
New: editor-selection.ts, inline-text-editor.tsx, editor-ergonomics.css, editor-selection.test.ts, editor-ergonomics.spec.ts.
All paths relative to `src/app/` except test files under `tests/`.

## Verified

- `npm run typecheck` passed.
- `npm run build` passed; existing DocumentView mixed static/dynamic import warning remains.
- `npx tsx --test tests/editor-selection.test.ts`: 4 passed.
- Combined editor-ergonomics, keyboard-ux, navigation-overlays, structured-editor-ui, workspace browser specs: desktop 17 passed; mobile 16 passed, one existing desktop-only appearance test skipped.
- Following final reviewer guard and animated-pose movement preservation: editor-ergonomics rerun desktop 4 passed, mobile 4 passed.
- Persisted source inspected in browser tests for grouped subtrees, deleted/duplicated roots, original text styles, multiline text and custom font names.
- New screenshot evidence: `plans/260909-0952-observability-editor/reports/inline-text-desktop.png` and `inline-text-mobile.png`. Desktop inspected visually.
- Restored only four older tracked keyboard-plan screenshots overwritten by their existing tests. All owned E2E processes stopped through the runner; port 8791 released to controller.

## Limits

Chromium desktop/mobile tested here; controller owns additional engines. Remote Google font availability was not made an external-network test gate; system-family face styles and custom font persistence verified, loading/failure behavior implemented. Textarea uses native wrapping while SVG uses its existing custom wrap algorithm, so this change does not claim byte-for-byte exported glyph layout parity. Native IME is preserved via textarea and composition guards; no physical IME device run.

Docs impact: minor; controller/docs owner received behavior summary. Shared document/API schemas unchanged.
Unresolved questions: none.
