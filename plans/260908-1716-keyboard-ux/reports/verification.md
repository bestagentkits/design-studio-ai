# Keyboard UX verification

Date: 2026-09-08. Status: fixed and verified locally; production shipping in progress at this checkpoint.

## Reproduced defects
- Layers: ArrowDown retained focus on the original row instead of selecting the next row.
- Export dialog: ArrowRight changed the selected canvas object's x from 72 to 73 behind the dialog.
- Zoom button: ArrowRight changed that same canvas object despite toolbar focus.
- Appearance trigger: ArrowDown opened the menu and also changed the selected object's y from 54 to 55.
- All four initial desktop regression tests failed at those assertions before the broader repair.
- The earlier thumbnail regression also failed before its original repair.

## Repair and review
- Shared sibling-button navigation owns its arrow/Home/End events, follows group orientation, clamps boundaries, skips disabled/hidden choices, retains focus, and reveals the selected item.
- Applied to thumbnail strip, layers, editor/inspector/mobile panel choices, Settings, provider choices, and appearance choices. Selection is exposed with aria-pressed.
- Global editor handler respects consumed events, IME, editable controls, overlays, preview/proposals and busy state. Node duplicate/delete require canvas or layer focus; layer arrows navigate instead of moving objects.
- Mouse object selection and newly inserted nodes gain editing focus. 3D selection focuses the stable viewport because its renderer recreates the canvas.
- Modal cleanup closes the native dialog and restores connected opener focus. Native Escape cancellation cannot bypass an owner's busy guard. Dialog titles supply accessible names.
- Appearance Escape closes only its menu and restores trigger focus, preserving editor selection and docs search.
- Self-review traced native inputs, menu bubbling, boundary keys, canvas pointer focus, preview, export busy state, and 3D renderer teardown. Existing schema, provider, persistence, and publishing contracts remain unchanged.
- Docs impact: minor; updated the owning architecture guide. Restored historical onboarding screenshots rewritten by existing E2E tests.

## Checks actually run
- `npm run build:cli`: passed before the CLI-inclusive unit suite.
- `npm test`: 70 passed, zero failures.
- `npm run build`: passed on final application source.
- `npm run typecheck`: passed, including the final browser tests.
- `git diff --check`: passed.
- Isolated Chromium E2E using `E2E_PORT=18480`, sequential desktop/mobile runs:
  - `tests/keyboard-ux.spec.ts` + `tests/slide-navigation.spec.ts`: 9 passed, 1 skipped.
  - `tests/navigation-overlays.spec.ts`: 6 passed.
  - Existing `tests/public-docs.spec.ts`, `tests/workspace.spec.ts`, `tests/onboarding-ui.spec.ts`: 12 passed.
- Total distinct E2E cases: 27 passed, 1 skipped. The skipped mobile case targets the appearance trigger hidden in the compact editor; mobile appearance behavior is tested through Settings and public docs.
- Export busy test delayed delivery of a real JSON-export HTTP response; no fake provider/export response.
- Inspected desktop/mobile Layers screenshots: selected row, visible keyboard focus, and expected layout. Other evidence: [desktop Settings](settings-desktop.png), [mobile Settings](settings-mobile.png).
- Test harnesses cleaned up temporary databases and servers; port 18480 has no remaining listener. Port 8791 belonged to another worktree and was not touched.

## Limits
- Browser verification is desktop/mobile Chromium, not a universal browser certification.
- No live provider generation, production smoke, or deployment was performed.
- No unresolved questions.

## Full shipping validation
- `npm run typecheck`, `npm test` (70 passed), and `npm run build`: passed after application patch version 0.2.1 and final browser-fixture changes.
- `E2E_PORT=18480 npm run test:e2e`: full suite passed, desktop 16 and mobile 15 with one intentional mobile skip.
- Initial full run exposed the new tests exceeding the existing signup rate limit. The new specs now share one worker-scoped isolated test account in memory; every test retains its own browser context and project. Production rate limits remain unchanged.
- Root application version is 0.2.1; the independently released CLI remains 0.2.0.
- AgentKit journal/index CLI is unavailable in this environment; this report records the local evidence.
- Independent code review identified focused-but-unselected Home/End endpoints. The boundary guard now checks selection, with real Tab/Shift+Tab regression coverage. Typecheck, build, and desktop/mobile slide tests passed again after this correction.
