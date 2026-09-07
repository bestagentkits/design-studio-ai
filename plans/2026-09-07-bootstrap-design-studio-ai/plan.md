---
title: Bootstrap Design Studio AI
description: Deliver the agent-first design workspace, portable hosting, and verified deployment.
status: in-progress
priority: P1
effort: 40h
tags: [feature, frontend, backend, api, auth, infra]
blockedBy: []
blocks: []
created: 2026-09-07
---

# Design Studio AI delivery

Build the full requested [product scope](../../docs/product-brief.md) against the [shared architecture contract](../../docs/architecture.md). Work began in an empty repository with screenshot references. Implementation estimates are planning estimates, not a promise about session duration.

| Phase | Status | Owner | Dependency |
| --- | --- | --- | --- |
| [Shared document, catalog, and rendering](phase-01-shared-foundation.md) | In progress | Controller: `src/shared/**` | Accepted contract |
| [Responsive design workspace](phase-02-workspace.md) | In progress | Frontend: `src/app/**` | Shared schema |
| [Persistence, security, providers, MCP](phase-03-backend.md) | In progress | Backend: `server/**`, `migrations/**`, `tests/server*` | Shared schema |
| [Agent clients, deployment, integration](phase-04-integration-release.md) | In progress | Controller: CLI, config, infrastructure | All prior phases |

## Constraints and acceptance

No arbitrary backend code execution; real behavior and real exports; preserve user data; no fake integration success. REST, MCP, WebMCP, and CLI share validation and authorization. Full scope includes all six document kinds, templates/themes, chat/manual editing, assets/imports, seven export families, BYOK modalities, publish snapshots, OAuth/API keys, MIT GitHub release, Cloudflare custom domain, and Docker.

Completion requires passing targeted and integrated tests, actual format inspection, responsive browser verification, two-user isolation, real production persistence, and a reachable custom domain. Provider/Google features must be exercised live when credentials are available and report configuration requirements otherwise. The supplied Cloudflare token permits deployment; missing unrelated credentials are configuration requirements, not reasons to invent success.

Implementers must import the shared schema and services, report required contract changes to the controller, and avoid competing adapters. Only the controller resolves cross-owner changes. See [review and validation](reports/design-review.md) for identified risks and gates.

## Verified delivery and pending gates

Shared contracts/catalogs, the workspace, portable storage/auth, providers, MCP/OAuth, CLI/skill, and export implementations are present. Production verification on 2026-09-07 passed 11 checks including persisted D1 revisions, MCP, immutable publishing, and cloud PNG/PDF/PPTX. This is implementation and scoped verification evidence, not whole-plan completion.

The controller reported 42/42 integrated tests, passing typecheck, 2/2 isolated desktop/mobile E2E, four additional passing viewer regressions, and a real Docker build with 16 passing self-host checks including WebM/interactive HTML. Final expanded production smoke, full build/test reconciliation, GitHub release, and remote CI remain pending. Provider and Google success require external credentials unavailable during initial implementation. The CLI tarball exists; npm registry publication is unavailable (authentication returned 401). Upstream audit findings remain disclosed. See the [finalization report](reports/finalization.md) for evidence and precise remaining gates.
