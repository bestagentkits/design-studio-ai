---
title: Deploy isolated beta and verify connector DNS boundaries
date: 2026-09-10
summary: Dev CI deploys isolated beta; controlled Cloudflare DNS changes and Node pinned TLS probes recorded without claiming connector completion.
---

# Deploy isolated beta and verify connector DNS boundaries

## What happened

User authorized beta.studio.agentkit.best and automatic deployment on dev pushes. Provisioned separate Cloudflare Worker, D1, R2 and stable encryption secret with correct project account. First deploy succeeded, but immediate public verification hit ENOTFOUND during DNS propagation. Added bounded readiness retries. Independent review found a remote-head lookup pipeline could hide git failure; fixed standalone lookup with explicit bash pipefail.

Final beta CI 34478008042 passed verify/deploy at 2b5ddc4, with matching Cloudflare deployment metadata and public health/OAuth discovery. Local 166 tests and Chromium desktop 31/mobile 30 passed; one existing mobile skip. No production secrets or databases changed.

Controlled hostname probes rejected private, loopback, link-local, mapped IPv6, CNAME and public-to-loopback DNS transition. Seven temporary records removed and preview stopped. Node HTTPS probe pinned one validated address and authenticated TLS. Native Cloudflare remains selected, paired with its documented public-fetch boundary and explicit probe limitations.

## Next work

Complete the connector transport/OAuth integration and measured execution budgets before enabling arbitrary remote endpoints. Continue the original MCP-first plan, then native GitHub/Drive and all client surfaces; beta deployment is enabling infrastructure, not completion of that product scope. Detailed evidence lives in the active plan reports.

AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
