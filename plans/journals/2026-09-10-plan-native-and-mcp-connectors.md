---
title: Plan native and MCP connectors
date: 2026-09-10
summary: "Planned MCP-first tool execution with native GitHub and Drive, shared authorization, verified file ownership and acceptance gates."
---

# Plan native and MCP connectors

## What happened

Created plans/260910-1839-connectors-and-mcp/plan.md, architecture contract, nine execution phases and source/review reports. User confirmed MCP Connector and AI tool calling should work first; native GitHub and Google Drive remain in scope.

## Decisions

Reuse shared Hono services, ownership, encryption and revision contracts. Add explicit per-principal connector grants and safe WebMCP exposure. Plan an actual provider tool loop with persisted bounded steps, exact approval and uncertain-write recovery. Require SDK and Cloudflare egress probes before custom endpoints are enabled.

## Verification and next step

CLI plan validation passed. Local sweep verified 68 links and 130 existing/prior-phase owner references. Nine phases and 47 phase tasks remain pending; no application code or runtime was changed. Execute phase 1 only when implementation is requested. Technical probes and real-account acceptance remain future work.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
