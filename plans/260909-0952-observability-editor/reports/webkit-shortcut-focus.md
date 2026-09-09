# WebKit shortcut dialog focus

Status: implementation complete; browser rerun owned by controller.

Observed: WebKit editor font/shortcut test reached dialog dismissal, then failed focus restoration to Keyboard shortcuts. Pointer clicks on buttons do not necessarily focus them in WebKit, so Modal recorded the previously focused font field as its opener.

Fix: the shortcut button explicitly focuses itself before setting the dialog-open state. Modal's existing opener capture and cleanup now use the actual invoking control. Keyboard question-mark invocation still restores the originating canvas/layer focus. No shared Modal semantics or assertions weakened.

Validation: `npm run typecheck` and `git diff --check` passed. No E2E process started; port 8791 retained by controller. Existing `tests/editor-ergonomics.spec.ts` font-preview test remains the browser regression assertion.
