---
title: Observability, editor ergonomics, and design guidance
description: Deliver private operational visibility, real usage analytics, fluent editing, discoverable design guidance, and verified production rollout.
status: in-progress
priority: P1
effort: 3-5 days
branch: codex/observability-editor
issue: 9
tags: [feature, frontend, backend, api, auth]
blockedBy: []
blocks: []
created: 2026-09-09
---

# Outcome contract

Deliver all requested scope: logs/traces and dashboards explaining who is doing what, errors and tracing gaps, real usage and efficiency; Shift multiselection and useful shortcuts; natural inline text editing; font previews; compact accessible icon buttons; design-kind skill references for layout, best practices and taste; template/design-system deep links; PostHog product tracking; optimized supplied README screenshots; merge to main and verify deployment.

Constraints: keep shared validators/services, owner isolation, explicit brief approval and independent revisions. No private prompts/content, credentials, raw URLs/query strings or indiscriminate DOM capture in telemetry. Operator-wide access requires explicit server configuration and is separate from an owner's own activity. Never invent cost, token usage, presence, quality or tracing coverage. Preserve existing encryption key and applied migrations. Use real artifacts and existing CI/deploy gates.

Non-goals: changing document format, realtime collaborative presence, automatic aesthetic scoring, automatic public publication, replacing BYOK, collecting prompt/response content, session replay, unrelated redesign. These do not remove any requested feature.

## Phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| [1](phase-01-observability-contract.md) | Persisted requests/spans/events, safe errors, measured provider usage, owner/operator API | Existing routes/auth/persistence |
| [2](phase-02-dashboard-analytics.md) | Operational dashboard, PostHog allowlisted events, correlated browser errors | Phase 1 contract |
| [3](phase-03-editor-interactions.md) | Unified selection, shortcuts, inline text, previewed fonts, compact controls | Existing editor/layout behavior |
| [4](phase-04-guidance-deeplinks-docs.md) | Six design references, deep links, agent/docs parity, optimized README imagery | Stable Phase 1/2 public contract |
| [5](phase-05-verification-shipping.md) | Reviewed full checks, main merge, deployed revision/runtime evidence | All implementation |

## Parallel ownership

- Backend owner: `server/observability*.ts`, new observability migration, `server/index.ts`, `server/types.ts`, `server/security.ts`, `server/providers.ts`, `server/node.ts`, instrumentation in server route modules, backend telemetry tests. Coordinate `server/mcp.ts` with integration owner; only one writer at a time.
- Parent dashboard/integration owner: dashboard/analytics UI modules, focused CSS/tests, `src/app/app.tsx`, `src/main.tsx`, `src/app/api.ts`, deep links, environment/build config. Run backend and editor workers alongside parent; dispatch guidance/docs worker after a slot frees.
- Editor owner: `src/app/editor.tsx`, `document-view.tsx`, `layer-tree.tsx`, `font-picker.tsx`, editor helpers and targeted editor browser tests. Parent owns shared `src/styles.css`; owner supplies scoped CSS for integration or uses new feature stylesheet.
- Guidance/docs owner: `skills/design-studio-ai/**`, README and supplied optimized image assets, owning docs/guide/reference prose. Parent owns `src/shared/api-reference.ts`, network MCP/CLI/WebMCP integration and deep-link app shell changes.
- Integration owner controls shared app/config/schema surfaces, acceptance reconciliation, review findings, git and deployment. No delegate reverts another owner's work.

## Acceptance gates

- Real request → operation/provider span → final outcome can be queried by trace ID; invalid input/auth/provider/MCP errors remain diagnosable without private payloads.
- Dashboard distinguishes recent activity from currently running operations; shows failure/retry/latency/token and known-cost evidence with explicit unknown states, filters, retention, and coverage limits.
- Tenant-crossing queries and unconfigured/non-operator global access fail on server, including CLI/MCP/WebMCP.
- Desktop/touch editor interaction tests prove requested behavior and existing keyboard/layout/sync contracts; name tested browsers.
- Deep links survive reload/history/auth; skill references cover every supported kind; new public routes/config/features appear in all owning references and regenerated discovery output.
- Main exact SHA passes CI and deployment; verify live public and authenticated read-only behavior and record remaining credential-dependent evidence honestly.

## Pending external input

- PostHog US verified by public project config HTTP200 and invalid-key negative control HTTP404; configure `https://us.i.posthog.com`.
- Operator account resolved by authenticated GitHub login/id matched to existing D1 github_accounts; global reads still require configured IDs plus session/API-key authentication, never MCP OAuth.

Planning tooling: `ak plan --help` returned `command not found`; no existing plan status was changed. New plan starts pending. Controller may use available runtime tracking; durable checklist remains here.
