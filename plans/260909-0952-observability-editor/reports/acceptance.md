# Acceptance reconciliation — 2026-09-09

This record reconciles phases 1–4 against source, tests and review evidence. A checked implementation item means its behavior is present and source-reviewed; test evidence is named separately. Open validation items do not imply missing source. No scope was removed, and an unavailable metric is not marked implemented.

## Phase status

| Phase | Implemented behavior | Verification status |
| --- | --- | --- |
| [1 · Observability contract](../phase-01-observability-contract.md) | Persisted request/tool/provider/export observations, internal correlation, owner/operator APIs, nullable measurements, retention and coverage | Real SQLite/API/client tests pass; media race regression passes. Live provider generation and runtime rollout remain separate. Stale leases are source-reviewed; no full elapsed provider lease experiment claimed. |
| [2 · Dashboard and analytics](../phase-02-dashboard-analytics.md) | Real activity/trace/usage dashboard, operator gate, bounded filtering/pagination/refresh, safe first-party events and optional explicit PostHog capture | Activity/error/filter/reload and ordinary-owner denial pass focused browser tests. Reliable retry attribution is unavailable; no retry ratio is fabricated. Full egress/identity-transition/failure matrix remains unverified. |
| [3 · Editor interactions](../phase-03-editor-interactions.md) | Shared multiselection and batch edits, protected shortcuts, measured inline typography/geometry, font previews/custom names, accessible compact controls | Four focused editor cases pass in Firefox and WebKit. Physical IME, physical mobile input, induced font-provider outage and exhaustive shortcut/draft-conflict matrix are not established. |
| [4 · Guidance and navigation](../phase-04-guidance-deeplinks-docs.md) | All six kind references plus shared layout checks, recursive skill ZIP, supplied optimized README images, clean workspace view URLs and synchronized public contracts | Source/links/images reviewed, actual ZIP inspected, client parity passes, public docs pass four cases on each desktop/mobile viewport. Remote README rendering and publication are later evidence. |

## Completed local gates

| Evidence | Result | Scope / provenance |
| --- | --- | --- |
| [Final unit gate report](tester-260909-final-ship-gates.md) and [full log](final-unit-suite.log) | 148/148 passed; CLI build and application/CLI typecheck passed | Final unit run after accounting race repair; working-tree evidence, not remote CI. |
| [Media race report](tester-260909-media-usage-race.md) | 21 focused tests passed; typecheck passed | Cached-first regression failed before fix (`null !== 12`), then passed both serial orders, concurrent completion, error-first enrichment, preserved zeros/timestamps and exact summary counts. Reviewer independently reran the named regression successfully. |
| [Cross-client parity](../../reports/tester-260909-observability-parity.md) | Passed | Actual SQLite, ephemeral HTTP server, built CLI, MCP and Chromium browser registration. Verifies root/tool/internal HTTP correlation, request header, 30-day lookback, cross-owner denial and configured operator versus OAuth behavior. Included in final 148-test run. |
| Firefox focused run | 6/6 passed, 17.2 s | Inspected `/tmp/design-studio-observability-firefox.log`: four editor ergonomics cases plus workspace deep links and activity trace/filter cases. |
| WebKit focused final run | 6/6 passed, 12.2 s | Inspected `/tmp/design-studio-observability-webkit-final.log`: same six cases after shortcut-opener focus repair. Supersedes the earlier 5-pass/1-failure run. |
| Public documentation final run | 4/4 desktop and 4/4 mobile passed | Inspected `/tmp/design-studio-public-docs-final.log`: real HTML/agent discovery, no-JavaScript readability, search/copy/history and guide disclosure. |
| Final broader Chromium desktop/mobile E2E | Desktop 30/30 passed; mobile 29 passed, one pre-existing appearance skip; exit 0 | Inspected final `/tmp/design-studio-observability-e2e-final.log`; editor, keyboard, navigation, structured-layout, activity and related UI checks. The skipped case is not counted as passed. |
| Skill package | Eight Markdown files verified in current ZIP | `unzip -l dist/design-studio-ai-skill.zip`: entrypoint plus seven references (six kinds and shared layout). Two directory entries are not content files. Repackaged after app build. |
| [Guidance/assets report](../../reports/docs-manager-260909-0959-guidance-assets.md) | Four images inspected before and after optimization; no missing local links | Original dimensions preserved, 3,697,007 → 542,124 bytes. Supplied Vietnamese brief preserved with user authorization; no visible credentials. |
| [Independent review](../../reports/reviewer-260909-observability-editor.md) | No unresolved correctness finding in inspected source | Media late-usage loss, empty-font-search crash, stale trace navigation and previous-filter data/cursor bugs repaired. Browser/release gates are not implied by review. |

Temporary browser logs above were inspected for actual terminal results. They are local execution evidence, not permanent release artifacts or a claim that every supported browser/version/device was tested. Screenshots under this directory show activity and inline text for desktop/mobile/Firefox/WebKit; screenshots alone do not establish test completion.

## Explicit acceptance limits

- **Retry attribution (plan-proposed diagnostic, not an explicit user-requested ratio):** the event contract contains observations, not a reliable attempt/retry relationship. Repeated calls may be distinct user actions. Coverage says retries cannot be inferred; no measured retry count or ratio exists. The corresponding phase 2 item remains open as a measurement limitation, not silently removed or relabeled complete.
- **Physical IME:** source ignores composing key events and uses a native textarea. The test enters `Xin chào\nNew line` with `.fill()`, which verifies Unicode/multiline persistence but does not emulate an OS input method, candidate selection or real composition events.
- **Font outage:** bounded twenty-family previews, debounce, ten-second timeout, `onerror` status and catalog fallback exist. Keyboard/system/custom font paths pass. No live Google Fonts outage was induced, so external outage recovery is not claimed tested.
- **Input/focus matrix:** actual tested Ctrl shortcuts, font keyboard selection, dialog closure, nested rotation and saved text are listed above. Exhaustive Meta/IME/contenteditable/modal/busy/preview combinations, physical touch and live conflicting remote drafts remain open validation; source protections are not substituted for those experiments.
- **Analytics:** strict schema, owner checks, safe metadata, explicit HTTPS host, no capture SDK/autocapture/replay, identity epoch reset and caught delivery failures are source/API verified. This record does not claim a full outgoing browser/sink payload audit, identity-switch experiment or live accepted PostHog delivery. The controller owns external configuration/delivery evidence in phase 5.
- **Deep links:** clean view routes `/templates`, `/design-systems`, `/activity` and activity filter reload are verified. Selected template/system ID links were optional and were not added; view navigation does not create/apply content. Full logout/login/forward/keyboard combinations and remote GitHub README rendering remain separate checks.

## Source anchors

Contracts and measurement: `src/shared/observability.ts`, `server/observability*.ts`, `migrations/0008-observability.sql`, `server/providers.ts`, `server/mcp.ts`, `server/exports.ts`. UI and navigation: `src/app/observability-{dashboard,details}.tsx`, `analytics.ts`, `workspace-navigation.ts`, `app.tsx`. Editor: `editor-selection.ts`, `inline-text-editor.tsx`, `font-picker.tsx`, `editor.tsx`, `document-view.tsx`, `layer-tree.tsx`. Guidance/distribution: `skills/design-studio-ai/**`, `scripts/package-skill.mjs`, `docs/assets/**`, `src/shared/api-reference.ts`, `scripts/build-public-docs.mjs` and owning docs.

Phase 5 was not edited: merge, exact-SHA CI, release artifacts and deployed runtime remain parent-owned. Unresolved user questions: none introduced by this reconciliation.
