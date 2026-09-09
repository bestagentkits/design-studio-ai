# Dashboard and PostHog

Priority P1. Owner parent dashboard/integration; backend API required. Read `src/app/app.tsx`, `api.ts`, `ui.tsx`, `settings.tsx`, `server/index.ts` config and phase 1 contract.

## Implementation

- [x] Build owner Activity/Usage dashboard and separately gated operator view: recent actors and actions, running/stale operations, failure breakdown, latency, provider/model usage and available spend, filters and trace drilldown. Mobile-first; keyboard-accessible filters/table/detail navigation, loading/empty/error states, pagination and bounded refresh.
- [x] Trace detail shows parent/child steps, status and safe diagnostic codes plus copyable request ID. Explain coverage, retention, stale activity and missing measurements. Display measured success/failure ratios; explicitly state that retries cannot be inferred from repeated actions. Do not present a fabricated retry/efficiency/quality score.
- [x] Server sends operator eligibility; direct protected routes still require server authorization. Owner dashboard cannot request arbitrary owner IDs; operator filtering is explicitly distinct.
- [x] Send explicit sanitized browser page/action/error events to a first-party endpoint; optionally forward approved events with PostHog capture from verified current official guidance once parent resolves host/project config. Explicit business events (project/template/system open, create/save/export, provider attempt/result, editor action, navigation/error) use an allowlist and opaque actor identifiers. Do not forward names, emails, prompts, node/document text, asset URLs or query parameters.
- [x] Disable autocapture, session recording/replay, text capture, automatic URL/referrer properties and form capture unless a separately reviewed safe configuration proves exclusion. Clear/reset identity on logout/account changes; don't merge different authenticated users accidentally.
- [x] Correlate browser → API request IDs for errors and actions; count definitive server outcomes once, separate client intent from result. Observe WebMCP-originated requests and label source without treating an asserted source as authentication.
- [x] Optional/unconfigured PostHog is visible in operational configuration but doesn't break product. Bound timeout/queue/retry and delivery; failed export doesn't replay business operations. PostHog is a product analytics sink, persisted server data remains operational source.

- [ ] Reliable retry attribution and a measured retry ratio: no attempt/retry relationship is currently recorded. Repeated calls remain independent observed calls; this measurement is unavailable, not implemented or inferred. Retain this limitation explicitly rather than marking the requested signal delivered.

## Files / ownership

Create focused dashboard, client analytics and CSS modules plus browser tests. Parent integrates shell navigation/routes, `api.ts`, config/bindings, `package*.json` if needed and deployment wiring. Never overlap editor owner or shared CSS without explicit handoff.

## Validation

- [x] Dashboard shows real persisted activity, filters, trace errors and unavailable usage/cost in focused browser tests; server tests separately prove isolated owners and operator restrictions. Loading/empty/error rendering is source-reviewed.
- [x] Source and API tests validate strict event payloads, rejected arbitrary content, owned project/trace references, safe configured hosts and absence of private values in persisted telemetry. Source disables capture when configuration fails, invalidates queued identity epochs and catches delivery failures.
- [ ] Full browser egress/identity-switch/failure experiment: independently inspect actual outgoing sink requests and disabled/logout/send-failure cases. These are not established by schema tests; live PostHog acceptance belongs to phase 5.
- [x] Focused browser test verifies activity filters after reload, trace dialog use, workspace reload/back navigation and no link-triggered project creation. Firefox/WebKit runs pass.
- [ ] Exhaustive forward/history/account-switch and screen-reader announcement matrix; the focused cases do not cover every combination.
- [x] Final desktop/mobile rerun through `npm run test:e2e -- tests/observability-ui.spec.ts --project=desktop` and mobile after build. Report tested engine; additional engines require actual execution.

Risk/rollback: bad host/config must fail closed for analytics without disabling app. Deployment configuration is separate from bundled public project key; never expose private PostHog keys. Parent confirms external host before activating.

## Acceptance reconciliation — 2026-09-09

Status: dashboard/analytics implementation complete with retry measurement unavailable and explicit validation limits. [Acceptance evidence](reports/acceptance.md) distinguishes local behavior from external delivery.

`observability-dashboard.tsx` invalidates query/trace responses on changes and unmount, clears prior filter results/cursors, and remounts per user. `analytics.ts` sends only typed events; `observability-posthog.ts` uses explicit properties rather than an autocapture SDK. Review fixes are documented in [review report](../reports/reviewer-260909-observability-editor.md). Final focused Firefox and WebKit runs each passed six combined editor/activity/deep-link cases. Final broader Chromium E2E completed: desktop 30/30 passed; mobile 29 passed with one pre-existing appearance skip. Physical input and exhaustive matrix limits above remain explicit.
