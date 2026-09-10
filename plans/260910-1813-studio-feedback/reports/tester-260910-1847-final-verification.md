# Studio feedback verification

## Summary

Requested verification completed on the working tree based on `3545d18d06215c6c4e5e188761818bba98a2e688`, package version 0.3.1, Node 25.2.1. The mobile 3D rendering repair passed the actual pixel assertion, full mobile suite, and focused WebKit suite. No production accounts, providers, or smoke script were used.

## Results

| Check | Observed result | Log |
| --- | --- | --- |
| CLI build | Passed after version bump | `/tmp/studio-feedback-final-build-cli.log` |
| Typecheck | Passed after final rendering repair | `/tmp/studio-feedback-final-typecheck-repair.log` |
| Unit/integration tests | 150 passed, 0 failed/skipped after shared-renderer repair | `/tmp/studio-feedback-final-tests-repair.log` |
| Production build | Passed after rendering repair; ineffective dynamic import warning for document-view remains | `/tmp/studio-feedback-final-build-repair.log` |
| Skill package | Passed | `/tmp/studio-feedback-final-pack-skill.log` |
| Full Chromium desktop, 1440×1000 | 36 passed before final zero-size guard | `/tmp/studio-feedback-final-e2e-complete.log` |
| Focused Chromium mobile pixel regression | 1 passed after rendering repair | `/tmp/studio-feedback-final-mobile-pixel-repair.log` |
| Full Chromium mobile, 390×844 | 35 passed, 0 failed, 1 existing skip after repair | `/tmp/studio-feedback-final-mobile-repair.log` |
| Focused Firefox desktop | 11 passed, including 3D pixel check, before final zero-size guard | `/tmp/studio-feedback-final-firefox-complete.log` |
| Focused WebKit mobile | 11 passed, 0 failed/skipped after repair | `/tmp/studio-feedback-final-webkit-repair.log` |

## Findings

- Resolved mobile 3D failure: after returning to Canvas, the composited 3D canvas previously contained no nonzero alpha pixels within 10 seconds. Guarding zero-size renderer resizing/copying now passes the unchanged actual-alpha assertion in Chromium mobile and WebKit mobile. This verifies rendered content beyond DOM layer ordering.
- Resolved WebKit test input limitation: Playwright does not support mouse wheel in mobile WebKit. The test now exercises the visible Zoom in control there, while other projects retain wheel verification. The full grouping scenario passes.
- Resolved cascading mobile registration failure: the earlier 429 followed an authenticated-worker restart after the rendering failure. The full mobile rerun passes registration on a fresh isolated database without changing production rate limits.
- Existing mobile skip: `tests/keyboard-ux.spec.ts:148`, appearance-menu keyboard scenario; compact editor hides its trigger. No new skip was added.
- Earlier failures were corrected: new fixture used invalid `scene.primitive` and inherited torus-knot geometry; modal close label was stale; screenshot wait relied on an empty-project heading; WebKit Live checkbox collapsed in flex layout. Live checkbox tests now pass without forced clicks or weaker checks.

## Process and limitations

E2E ran through the repository harness on port 8791, with isolated temporary databases and observable subprocess cleanup. Port was checked between runs. One superseded full rerun was stopped using SIGTERM to its owned harness after newer fixes arrived; its result is not a pass. Generated browser screenshots were retained, not manually reverted.

Typecheck, build, all 150 unit/integration tests, full mobile Chromium and focused WebKit were repeated after the final shared-renderer repair. Desktop Chromium and Firefox passes precede that final zero-size guard; they were not rerun afterward. All owned test processes exited, and port 8791 was verified free. No code coverage, provider-generation success, production deployment, or universal browser support claim is made.

## Unresolved questions

None.
