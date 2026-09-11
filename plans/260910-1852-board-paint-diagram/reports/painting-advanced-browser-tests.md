# Advanced Paint browser acceptance

Added `tests/painting-advanced-ui.spec.ts` with two independent, real-account browser workflows:

- Resize the painting to 256 × 256; rectangle-select and fill; inspect opaque interior and transparent exterior pixels; assign and lock a group; prove a blocked stroke leaves pixels untouched; create and erase a mask; undo/redo; save and reload; disable the mask and prove underlying pixels remain.
- Abort an actual asset upload; reload and inspect recovered pixels; switch accounts in the same browser; verify original project is inaccessible and new painting has no draft; log back in; retry the recovered transaction; save/reload and inspect persisted pixels.

No fabricated rendering or provider output. Network abortion models transport failure. Test accounts and projects are created in the parent-owned isolated E2E environment.

Verification: Playwright discovery passed, listing four desktop/mobile instances. Browser execution delegated to controller on its owned port 19203; no server started here. Physical Pencil input remains untested.

Unresolved questions: none.
