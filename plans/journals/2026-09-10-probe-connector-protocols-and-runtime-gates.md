---
title: Probe connector protocols and runtime gates
date: 2026-09-10
summary: Verified schema foundation and local MCP profiles; native Cloudflare DNS-rebinding experiment awaits designated test domain.
---

# Probe connector protocols and runtime gates

Implemented initial connector/run/operation/principal schemas and nine validation tests. Pinned outgoing MCP client 2.0.0 separately from inbound SDK 1.30.0. Local Node and workerd probes passed legacy/modern JSON/SSE calls; SQLite/local D1 proved single lease and unknown-outcome recovery primitives.

Full local suite: 157 passed. CLI build, typecheck and application build passed. Remote binding-free Cloudflare preview returned public 200 and literal loopback 403, but lookup hooks are unsupported; this does not prove DNS rebinding protection. Harness stopped, no production resources changed.

User selected further native Cloudflare verification. Awaiting exact test domain/DNS access. Plan remains in progress; no dependent product phase, release or independent review is claimed. Evidence: plans/260910-1839-connectors-and-mcp/reports/runtime-probes.md.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
