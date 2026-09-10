# Implementation progress — 2026-09-10

Partial foundation implemented and verified on `codex/connectors-and-mcp`; the nine-phase connector product is **not complete**.

| Phase | Evidence and remaining work |
| --- | --- |
| 1 | Shared schema foundation, pinned client, local MCP JSON/SSE/profile probes, SQLite/local D1 lease probes and binding-free Cloudflare edge smoke completed. Controlled Cloudflare hostname/DNS mutation probes now pass for recorded cases; bounded OAuth feasibility passes on Node/local workerd; transport and application OAuth lifecycle, complete contracts and measured budgets remain pending. See [runtime probes](runtime-probes.md). |
| 2 | Pending phase 1 gate; no persistent product migrations, lifecycle, grants or operation routes implemented. |
| 3 | Pending; no outgoing connector exposed. SDK probe is not the adapter. |
| 4 | Pending; no provider tool loop or persisted product runs. |
| 5 | Pending; no settings/project/chat UI changed. |
| 6 | Pending; GitHub integration and remote artifacts absent. |
| 7 | Pending; Drive/Picker/Slides connection integration and remote artifacts absent. |
| 8 | Pending; no connector REST/CLI/MCP/WebMCP surface published. |
| 9 | Existing local release checks pass; integrated connector/browser/live acceptance cannot pass before implementation. |

All 47 phase tasks remain unchecked because each current phase-1 checkbox combines completed and uncompleted requirements; bulk `ak plan check` would overstate progress. Runtime notes record partial evidence. All seven top-level acceptance boxes remain unchecked. Current-plan pointer and overall `in-progress` status updated with the installed CLI.

Docs impact: beta deployment instructions updated in the owning deployment guide; schema/probe progress remains plan evidence, without advertising unavailable connector product APIs. User implementation authorization supersedes the original planning-only sentence. Foundation and beta configuration committed; current main merged into this work branch. `dev` pushed for authorized beta CI. No production release or connector product completion claimed.

User supplied the domain and authorized isolated beta deployment from dev. DNS experiment completed and temporary records cleaned up. Finish remaining phase 1 requirements, then sequential phases 2–9 without removing native connector scope.
