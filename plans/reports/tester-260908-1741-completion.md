# Advanced design verification

Status: DONE

## Scope and changes

- Added `tests/design-systems.test.ts`: real migrated temporary SQLite and Hono routes; immutable versions, concurrent CAS, ownership, project revision CAS, pinned apply, repeated insertion and ID/action/parent remapping, legacy absolute coordinates, private media rejection, deletion persistence.
- Added `tests/advanced-editor-ui.spec.ts`: real registration and saved projects, no mocked API or geometry behavior. Three workflows on desktop and mobile: mesh conversion/extrusion/UV/weighted rig/material with bone-animation bind-pose preservation; timeline add/move/custom easing/lock/delete; library create/version/history apply/component insertion/reload.

## Verification

- `npx tsx --test tests/design-systems.test.ts`: 10/10 passed, including root test, final focused run ~1.01 seconds.
- `npx tsc --noEmit`: passed after adding advanced browser tests; parent subsequently rebuilt/typechecked the integrated sources before final E2E.
- `npx playwright test tests/advanced-editor-ui.spec.ts --list`: six cases discovered.
- `npm run test:e2e -- tests/advanced-editor-ui.spec.ts`: final session 81179 exit 0. Desktop 3/3 (18.5 s); mobile 3/3 (15.7 s).
- Initial E2E found a real toolbar obstruction: absolutely positioned `.scene-view` covered the mesh toolbar. Parent fixed workspace flex layout and canvas positioning; final rerun passed without forced clicks or weakened assertions.
- Test expectation correction: legacy coordinate target page explicitly uses absolute layout, avoiding unrelated default template padding.

## Process cleanup

Official harness used port 8791 with per-device temporary databases. Final server PIDs 35798 and 37081 absent after completion; `lsof` confirmed no listener. Earlier failed-run PIDs 10669 and 12450 also stopped. No owned server left running.

## Limits

Browser coverage proves the exercised Chromium desktop/mobile flows and persisted model data. It does not establish universal browser support, exported 3D pixel fidelity, real provider generation, or exhaustive mesh operation combinations. Existing shared tests cover topology restrictions beyond this UI path.

Docs impact: none; test-only changes and execution evidence.

Unresolved questions: none.
