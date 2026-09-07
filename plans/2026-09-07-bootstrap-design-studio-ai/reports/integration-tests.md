# Integration and UI verification

## Summary

Real SQLite and file-backed asset regressions pass. Complete Chromium browser workflows pass at desktop and 390px mobile sizes using a fresh temporary database and local server.

## Verified behavior

- A duplicate receives independent asset identifiers and bytes. Deleting the original project leaves the copied asset readable, saveable, and publishable; anonymous visitors can load the publication asset while its private URL remains protected.
- A real OAuth consent and PKCE exchange yields credentials that can list, create, and edit designs. Those credentials cannot list, create, or delete permanent tokens or provider connections. Denied calls do not create database rows.
- Excessive page dimensions, object dimensions, and cumulative PDF render size return 413 before a browser is needed. The editable JSON source remains exportable.

## Commands and results

- `npx tsx --test tests/regressions.test.ts`: 4 passed, 0 failed.
- `npm run typecheck`: passed, including CLI typecheck.
- `npm run build`: passed.
- `npm run test:e2e`: 2 passed, 0 failed in 8.7 seconds. Desktop took 4.1 seconds and mobile 3.8 seconds. Both downloaded valid server-rendered PNG files with the expected signature and canvas dimensions. No uncaught browser errors or horizontal viewport overflow occurred.
- Initial `npx playwright test --project=desktop`: failed while finding the exact Text label. The shared Field component wrapped the textarea's current text in its implicit label. The frontend owner patched explicit field labels; the subsequent run passed this step.
- Second desktop run passed registration/sign-in, create, text/theme edits, save/reload, search/filter, duplicate, and publication. Its plain-text publication assertion did not account for SVG wrapped tspans. The test now joins those lines and compares the original saved text.
- The first full desktop/mobile run after the final frontend build hit the real 5-registration-per-IP limit from combined development smoke runs. Both returned the user-visible rate-limit error. The controller added `scripts/run-e2e.mjs` to isolate each suite in its own temporary database, and the final run passed without changing the app's rate limits.

## Browser suite

The Playwright suite uses Chromium at 1440 × 1000 and 390 × 844. Each run registers a unique test account, signs out and back in, creates a website template, edits text and theme, saves and reloads, searches and filters, duplicates the project, opens a publication in a separate anonymous context, and downloads a server-rendered PNG. It checks PNG bytes and dimensions, horizontal viewport fit, and uncaught browser errors.

No provider keys or fake API responses are used. Traces are disabled because authentication requests contain generated test credentials. Created projects are deleted in cleanup and sessions are logged out. The isolated runner removes the complete temporary database, so its test accounts do not persist; no account deletion API exists. The first timed-out shared-server run left one test project because cleanup exhausted the same timeout; the suite now reserves cleanup time, and the controller was notified. Final port inspection confirmed no listener remained on port 8791.

## Unresolved questions

- None for the assigned workflow and regression scope. Live AI providers, cloud deployment bindings, and external OAuth services were outside this suite.

## Published interactive viewer verification

Added `tests/published-viewer.test.ts` with real SQLite, file-backed assets, the built `public/studio-viewer.js` bundle, a short-lived HTTP server, and anonymous Chromium pages. The test creates and publishes documents through real authenticated endpoints, then navigates to the actual public responses so Chromium enforces their response CSP.

- The viewer script's nonce matches the response policy. The sandbox permits scripts but has no `allow-same-origin`; cookie access throws `SecurityError`, confirming its opaque origin.
- A published 3D sphere produces a visible canvas with more than 20 distinct sampled colors, hides its static SVG placeholder, and emits no uncaught browser error.
- Keyboard scrubbing moves a published shape between its exact initial and final SVG coordinates. Play advances animation time and changes coordinates, and Pause restores the play control.
- Text containing closing script tags, a new script, and an image error handler remains document data. It creates neither extra scripts nor image/event-handler elements, never sets its execution marker, and does not break the trusted viewer.

`node scripts/build-renderer.mjs`, `npx tsx --test tests/published-viewer.test.ts` (4 passed, 0 failed), and `npm run typecheck` passed. The suite closes its browser and HTTP server and removes its temporary database and asset directory in `finally`. No source changes were needed.
