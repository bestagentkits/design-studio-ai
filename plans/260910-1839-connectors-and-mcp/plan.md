---
title: "Native connectors and third-party MCP integration"
description: "Deliver MCP tools in design chat first, then GitHub and Google Drive workflows on shared connection and permission services."
status: in-progress
priority: P2
effort: "38-56 engineering days; excludes external app approval waits"
branch: null
tags: [feature, backend, frontend, api, auth]
blockedBy: []
blocks: []
created: 2026-09-10
---

# Connector implementation plan

## Outcome and scope

People connect external services, choose project sources and tools, use them in design conversations, and export reviewed results. Deliver remote MCP plus native GitHub and Google Drive on one shared service. **User confirmed MCP Connector and AI tool calling first on 2026-09-10.**

Constraints: preserve owner isolation, stable encryption key, independent brief/document revisions, explicit scope approval, existing generation/export behavior, and Node/Cloudflare support. Web, REST, CLI, network MCP, WebMCP and generated documentation share contracts and permission enforcement.

Non-goals for this plan: local stdio/command execution, MCP Apps UI, marketplace, autonomous background sync, whole-Drive indexing, bidirectional document synchronization, shared team credentials, automatic publication/merge. These are proposed product boundaries from the advisory discussion, not claims that the user explicitly rejected them.

Implementation authorized by the user on 2026-09-10 after this plan was written. Work started on `codex/connectors-and-mcp`; original planning-only restriction is superseded. Real account writes, paid provider calls and production release are not inferred from implementation approval. User subsequently authorized the project domain and a separate `beta.studio.agentkit.best` deployment on pushes to `dev`; beta uses isolated storage and credentials. See [runtime probes and current gate](reports/runtime-probes.md).

## Baseline and design

- Inspected clean detached checkout at `3545d18d06215c6c4e5e188761818bba98a2e688`. Recheck before implementation and create an appropriate `codex/` branch then.
- [Architecture and contracts](architecture.md) owns proposed data, permissions, operation lifecycle and API shapes.
- [Evidence and external references](reports/research-and-source-evidence.md) separates observed behavior from proposed changes.
- [Review and validation](reports/plan-validation.md) records assumptions, review dispositions and remaining engineering probes.

## Execution order

| Phase | Deliverable | Dependencies | Estimate |
| --- | --- | --- | --- |
| [1](phase-01-contracts-and-runtime-probes.md) | Shared contracts; prove MCP compatibility, safe egress and execution model | None | 3-5 days |
| [2](phase-02-connection-lifecycle-and-policy.md) | Connections, credentials, project grants, snapshots, approval/operation store | 1 | 5-7 days |
| [3](phase-03-remote-mcp-client.md) | Remote MCP auth, discovery, tools and resources | 1, 2 | 5-7 days |
| [4](phase-04-ai-tool-execution.md) | Provider tool loop, bounded resumable runs, proposals | 2, 3 | 5-8 days |
| [5](phase-05-connections-and-project-ux.md) | Settings, project sources, chat activity and approval UI | 2, 3, 4 | 4-6 days |
| [6](phase-06-github-connector.md) | Selected repository sources and reviewed React-export PR | 2, 4, 5 | 4-6 days |
| [7](phase-07-google-drive-connector.md) | Picker, source ingestion, Drive uploads and connected Slides export | 2, 4, 5 | 5-7 days |
| [8](phase-08-agent-surfaces-and-documentation.md) | Complete client/agent parity, reference and discovery build | 3-7 | 3-4 days |
| [9](phase-09-verification-and-rollout.md) | Integrated/browser/security checks; isolated live evidence and rollout readiness | 1-8 | 4-6 days |

Estimates are planning ranges, not commitments; protocol/egress probes can change them. Nine phases reflect separate trust/runtime/provider contracts, not nine separate releases. Surface schemas and tests move with each phase; phase 8 completes the parity sweep.

## Acceptance

- [ ] MCP-first milestone: connect a real remote server, discover/enable tools, call from chat, inspect results, approve a write, reconnect and revoke. Pass focused REST/UI/agent boundaries before treating this milestone as usable.
- [x] GitHub: pin source files to a commit; export actual React files into a new branch and PR; retries do not duplicate PRs and never merge or force-push. Live source/PR and controlled retry evidence: [acceptance](reports/live-acceptance.md).
- [ ] Drive: select real files, ingest supported source content/assets, upload inspected PDF/PPTX, and create supported Google Slides using a stored connection.
- [ ] Denied/revoked/stale grants and changed tool schemas fail on the server; legacy Studio tokens gain no implicit connector authority.
- [ ] Tool runs survive browser refresh and approval pauses, report uncertain external writes, and preserve brief/document concurrency.
- [ ] Shared REST/CLI/MCP/WebMCP behavior, mobile/desktop UX, Node/Cloudflare paths and generated docs pass the gates in phase 9.
- [ ] Live credential-dependent evidence is recorded separately from deterministic tests, CI, merge and deployment.

Current code: `e020dee` on `dev`; modal polish and Picker dialog recovery are deployed to isolated beta, where connectors are enabled for authorized live acceptance. Exact-code CI and beta deploy passed; [full plan verification](reports/verification-260911-1539-plan-completion.md) records remaining acceptance gaps. Evidence: [progress](reports/implementation-progress-2026-09-11.md), [verification](reports/verification.md), [surface parity](reports/surface-parity.md), [live acceptance and remaining gaps](reports/live-acceptance.md).

## Ownership and tracking

Default to sequential execution. If delegation is explicitly authorized later, provider adapters may overlap only after shared contracts stabilize; one integrator owns shared auth, routes, editor, schema, config, migration numbering and docs. Every delegate receives its exact files and this scope. Never edit another owner's changes away.

Unchecked phase tasks are the durable execution queue; no new Codex task or external issue is created. Use the plan's current pointer and parser for local tracking.

## Decisions and remaining input

Confirmed: MCP + AI first. Proposed defaults: personal connections, remote HTTPS, explicit per-project and per-agent grants, on-demand snapshots, confirmed writes, native connectors retained. No product answer blocks starting phase 1. Engineering gates: MCP SDK/version compatibility, safe Cloudflare egress, and Google Picker credential behavior must be proven before dependent code is enabled. Test credentials/app registrations are needed only for live acceptance; never put their values in this plan.
