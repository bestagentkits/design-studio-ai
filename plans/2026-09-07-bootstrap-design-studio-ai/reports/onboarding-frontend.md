# Chat-first interview frontend

Date: 2026-09-08
Status: DONE_WITH_CONCERNS

## Delivered

- A nonempty homepage prompt creates a real empty project and saved brief, then opens the interview workspace. The project URL resumes the owned project after reload and prompts for authentication when needed. Explicit template, blank, and import creation remain available.
- The interview has conversation context, provider/model controls, dynamic single/multiple/text questions, custom answers, saved answer recap, manual scope authoring, and palette/type reference choices. Provider availability comes from saved connections, including changes made in Settings.
- Objective, audience, visual direction, deliverables, constraints, and acceptance criteria are editable. Save, approve, and generate are separate actions. Editing invalidates local approval immediately; the backend invalidates saved approval on each write. Manual editing is available without treating it as scope approval.
- Refresh resumes the persisted brief. Revision conflicts preserve local fields and offer explicit reload. Requests prevent duplicate submissions; errors preserve the local brief. Browser navigation warns about unsaved fields. Question IDs such as `constructor` use own-property reads and safe type checks.
- First generation validates the returned document and persists it before opening the editor. A generated draft is retained in memory if its save fails, allowing save retry without repeating generation at the same brief revision. Later editing keeps the existing proposal/apply workflow.
- WebMCP registers saved brief read/update/approve operations only when the browser exposes the API, with explicit approval guidance and honest read/write annotations. It also exposes read-only inspection of the current unsaved document.
- Design checks show bounded deterministic findings for the current unsaved canvas, counts and limitations. Clicking a finding selects its page/layer. Checks do not block export or imply visual-quality scoring or accessibility certification. Mobile canvas tools remain accessible through horizontal scrolling.

## Verification

- `npm run typecheck` passed.
- `npm run build` passed, including public documentation generation.
- Durable `tests/onboarding-ui.spec.ts` passed on desktop and mobile against a real isolated Node/SQLite server. It verifies prompt creation, agent-authored questions through the public API, the `constructor` question ID, saved answers, reload, scope approval, approval invalidation, concurrent save conflict recovery, manual editor access, design checks navigation, dark appearance, and horizontal overflow.
- Visual inspection: [desktop](onboarding-desktop.png), [mobile](onboarding-mobile.png). The sample questions are authored through the real external-agent API in the test; they are not represented as a provider response.
- Fixed two UI issues found by browser testing: mobile homepage creation lacked an accessible button name; older responsive rules hid the entire canvas toolbar end, including the new checks control.

## Limits

- No live provider key was available. Paid AI interview/generation was not exercised; backend contract tests and schema validation cover those paths separately. The UI correctly disables provider-dependent actions while keeping manual scope and external-agent paths available.
- Native WebMCP execution was not available in the test browser. Registration is feature-detected; no simulated active connection is shown.
- Incomplete manual scopes remain local until required scope fields pass the shared schema. Navigation warns before abandoning unsaved edits; complete scope/answer changes are saved explicitly.
- Full-suite registration rate limits should be handled with isolated server data per browser project, without weakening production limits. This spec registers one disposable account per configured browser project.

## Process cleanup

Reused no production data. Owned temporary API ran on port 8793 with `.data/onboarding-frontend`, then `.data/onboarding-final`, and a generated temporary encryption key. Both managed server sessions were stopped after verification. No unrelated process was stopped.
