# Onboarding quality review

Reviewed 2026-09-08 against [accepted interview scope](../phase-07-interview-quality.md), using the code-review/spec-compliance workflow. Read-only review of the brief workspace, editor integration, appearance selector, application loading boundary, shared design checks, and related tests. No product files changed by this review.

## Verified finding: request edits could disappear during save — fixed by controller

**P2:** The original-request textarea was outside the disabled fieldset and remained editable while a save, approval, or interview request was pending. `accept(next)` replaced its state with the earlier response. The affected control is now at [design-brief.tsx:451](../../../src/app/design-brief.tsx#L451), with replacement at [design-brief.tsx:130](../../../src/app/design-brief.tsx#L130).

Reproduced in real Chromium against the application HTTP routes and real in-memory SQLite, with existing built frontend assets. The browser submitted “Request submitted at save start”; the harness held the real successful PUT response after its database commit. The textarea remained enabled and accepted “Newer text entered while save is pending”. Releasing that same response replaced the textarea with the first string; the database also contained the first string. There was no provider simulation or fabricated API response.

The controller added `disabled={!!busy}` to the request and model inputs and added a durable test holding an actual HTTP response in [onboarding-ui.spec.ts](../../../tests/onboarding-ui.spec.ts). The source correction is verified; the controller owns the final test run of that correction.

## Additional verified behavior

- **Unsaved design checks and mobile selection:** In real Chromium at 390 × 844, invoked registered `studio_set_design` and `studio_update_node` callbacks to add an unsaved second page and move its heading outside the page. `studio_inspect_design` returned the matching page and node IDs. Clicking the corresponding Design checks item switched to that second page and selected its actual canvas target. The database still contained only the original page, proving that inspection and navigation used local edits. Implementation: [editor.tsx:251](../../../src/app/editor.tsx#L251), [editor.tsx:1150](../../../src/app/editor.tsx#L1150), and [editor.tsx:2337](../../../src/app/editor.tsx#L2337).
- **Agent brief updates and local edits:** Invoked the actual registered WebMCP brief callback against the real HTTP/SQLite routes, edited Audience locally, then invoked a second agent update with the saved revision. The UI preserved the local Audience value and displayed the concurrent-edit conflict. Agent tooling uses the same persisted endpoint and revision contract; callback registration was exposed to the test harness without replacing endpoint behavior. Implementation: [editor.tsx:1092](../../../src/app/editor.tsx#L1092), [design-brief.tsx:82](../../../src/app/design-brief.tsx#L82).
- **Approval handling:** Source requires explicit approval; any dirty local scope removes the Generate action. Save/approve pass the exact brief revision and retain local values on HTTP conflict. Generation rereads the saved approved revision and rejects dirty canvas edits before provider work. No approval inference from missing answers was found.
- **Loading, errors, and appearance:** Source supplies brief-load retry, disabled provider actions when unconfigured, retained saved state on request failure, lazy-route loading and a reloadable error boundary. Appearance initializes before React, responds to system changes only in System mode, and synchronizes stored preference across tabs. Existing onboarding tests cover save/reload, explicit approval, stale revisions, 390px overflow, and appearance selection; they do not constitute successful provider-generation coverage.
- **Check bounds:** Shared inspection caps returned issues at 200 while retaining full counts. Its explicit limitations cover rotation, animation extremes, composited backgrounds, and text metrics. No aesthetic or accessibility-certification claim is made.

## Runtime and limits

Two short-lived review harnesses used in-memory SQLite and deterministic port 8791 (foreground PIDs 36868 and 18080). Both closed Chromium, awaited HTTP server shutdown, closed SQLite, and exited successfully. The second overlapped controller E2E startup; the controller was notified and owns restarting that run. No review server remains active. No credentials or private data were printed or persisted by these probes.

No additional verified blocker remains in the reviewed scope. Final full-suite/build results, the new save-race regression, and successful live provider generation remain controller-owned validation; this report does not claim those were independently rerun here.
