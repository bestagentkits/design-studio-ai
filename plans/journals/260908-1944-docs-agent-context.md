# Documentation and agent context synchronization

Date: 2026-09-08 (Asia/Ho_Chi_Minh)
Status: Work in progress; validation and merge pending when recorded.

## What happened

The user requested a documentation and agent-context update. Repository guidance now explicitly requires synchronized webapp features, API endpoints, CLI commands, MCP tools, WebMCP, official documentation, API documentation, the product agent skill, and both llms indexes. UX and AX are the highest product priorities, with mobile-first responsive layouts, browser capability detection, usable fallbacks, and browser-specific verification evidence.

The observed diff at journal creation contained these additions to [AGENTS.md](../../AGENTS.md). Documentation and product-skill reconciliation was still running separately. This is documentation-only work; it does not itself implement new runtime capabilities or establish cross-browser support.

## Decisions

- Keep repository contributor policy in [AGENTS.md](../../AGENTS.md), with product-agent usage in [docs/agents.md](../../docs/agents.md) and [the design skill](../../skills/design-studio-ai/SKILL.md).
- Follow [documentation source and build ownership](../../docs/web-documentation.md): edit owning source content, then regenerate public HTML, Markdown, `llms.txt`, and `llms-full.txt` through the existing build. Do not hand-edit `dist/`.
- Preserve shared validation, server authorization, independent brief/document revisions, and explicit scope approval across human and agent workflows.
- Record what was actually tested. Chromium evidence alone cannot establish other-browser compatibility; local generation cannot establish deployment success.

## Validation and remaining work

This journal task read the root README, AGENTS.md, CLAUDE.md, documentation ownership guide, and current git diff. It did not run application tests, build generated documentation, inspect deployment, or merge changes. Those checks and the authorized merge into `main` remained pending with the controller at this snapshot.

`ak journal create --help` returned `command not found: ak`; the entry was therefore saved directly to the assigned local file. AgentWiki publish skipped. No social or external publication was performed.

Next steps: finish documentation/source reconciliation, validate changed links and claims, regenerate and inspect affected public references, then record actual review and merge evidence separately. This journal is session history, not current product authority.

Unresolved questions: none.
