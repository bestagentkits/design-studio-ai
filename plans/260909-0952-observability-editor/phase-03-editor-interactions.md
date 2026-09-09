# Fluent editor interactions

Priority P1. Owner editor; independently executable. Read `editor.tsx`, `document-view.tsx`, `layer-tree.tsx`, `font-picker.tsx`, `canvas-gestures.ts`, `keyboard-navigation.ts`, `src/shared/operations.ts`, `layout.ts` and keyboard/structured editor tests.

## Pre-implementation observations

Editor keeps a single `selected` ID; LayerTree separately stores checked grouping IDs. Canvas pointerDown always replaces selection. Existing shortcuts protect input/IME/dialogs and preserve panel arrow navigation. Direct-text textarea uses node x/y and font size but not resolved typography/layout/rotation. FontPicker is an input/datalist, not a rendered font preview.

## Implementation

- [x] Introduce one ordered selected-ID set plus primary/anchor ID shared by canvas/layers. Shift+click toggles/adds selection, normal click replaces, Escape/empty canvas clear. Selection survives non-destructive updates and prunes deleted/page-switched nodes. Preserve touch single selection and expose discoverable multi-select controls for touch.
- [x] Apply move/nudge/duplicate/delete/group/ungroup to selected roots consistently; never move a child twice when ancestor selected, never modify locked nodes, preserve parent-relative/flex/grid behavior. Single-node resize/rotate must still work; mixed selections clearly state unsupported transformations instead of silently changing just one.
- [x] Add common canvas-scoped shortcuts and discoverable help/tooltips: select all, duplicate, delete, group/ungroup, undo/redo, save, fine/coarse nudge, Escape; keep platform Command/Ctrl variants and all existing focus/IME/modal protections. Do not hijack browser/text editing shortcuts outside canvas/layers.
- [x] Natural inline editing uses actual rendered text geometry/font family/weight/line-height/spacing/alignment/color/rotation and document theme. Match structured/nested layouts and zoom; remove artificial 200×80 minimum visual box. Double-click/keyboard edit preserves caret, multiline, IME and paste as plain text. Escape cancels, blur/explicit finish commits a coherent undo step; restore focus, avoid drag/collaboration races.
- [x] Font choices show visible family previews and searchable/filterable names, selected state, keyboard navigation and bounded lazy loading. Use existing font discovery/fallbacks; permit custom system fonts, handle failed loads, do not download the entire catalog.
- [x] Compact icon buttons for repeated editor actions; retain tooltips, accessible names, visible focus, disabled/busy state and adequate touch targets. Keep labels where icon alone is ambiguous and maintain mobile controls.

## Files / ownership

Modify editor-owned files in index; create focused selection/inline-text helpers only when they remove real complexity. Do not fork document schemas. Parent owns shared stylesheet integration; isolated feature styles are safe. Extend existing relevant tests or add focused editor spec.

## Validation

- [x] Focused browser tests cover Shift selection, shared layer checkboxes, grouped root+child drag, lock protection, batch duplicate/delete, select-all and single-step undo; unit tests cover ordered roots, hidden/locked ancestors, flow/local coordinates and accumulated rotation. Page/deletion pruning is source-reviewed.
- [ ] Shortcut matrix: selected canvas/layer, textarea/contenteditable/number input, IME, dialog/popover, preview/proposal/busy, Ctrl and Meta, touch controls.
- [x] Inline browser tests cover plain and Unicode multiline text, Escape cancel, explicit commit, undo/redo, persisted save, resolved theme typography and nested/rotated geometry.
- [ ] Physical IME composition, real clipboard paste, live remote-draft race and the full zoom/blur matrix. `isComposing`, native textarea behavior and remote-text conflict guards exist in source; filling Vietnamese text does not test an IME.
- [x] Font keyboard selection/custom-name persistence and accessible shortcut dialog controls pass focused Firefox/WebKit tests, including the empty-search ArrowDown/Enter regression and WebKit opener-focus repair.
- [ ] Induced external Google Fonts outage and physical mobile input fallback; timeout/error/fallback source exists, but no outage was induced. The external-outage experiment remains unrun.
- [x] Final broader desktop/mobile E2E, including keyboard-ux, navigation-overlays and structured-editor checks, completed: desktop 30/30; mobile 29 passed with one pre-existing appearance skip.

Risk/rollback: selection remains transient UI state; preserve stable document writes, history and conflict behavior. Test screenshot geometry, not only textbox value. Cross-browser claims require browser-specific runs.

## Acceptance reconciliation — 2026-09-09

Status: implementation complete; focused Firefox/WebKit behavior passed, wider interaction validation remains explicitly open. See [acceptance evidence](reports/acceptance.md).

- `editor-selection.ts`, `canvas-gestures.ts`, shared canvas/layer selection and batch editor commands preserve root ownership and locked-node constraints.
- `inline-text-editor.tsx` follows measured bounds/rotation and theme text style. `finishText` rejects a conflicting remote text change while retaining the draft. Native textarea provides plain-text editing; physical composition is not simulated by test `.fill()`.
- Font previews are limited to twenty families after a debounce, with timeout/error fallback and custom family entry. No external outage has been claimed as tested.
- [WebKit focus repair](reports/webkit-shortcut-focus.md) was subsequently verified by the controller's final six-test WebKit run; the unchanged assertion now passes. Final broader Chromium desktop/mobile run passed 30 desktop and 29 mobile cases with one pre-existing mobile appearance skip; parent owns phase 5.
