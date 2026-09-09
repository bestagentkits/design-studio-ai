# 2026-09-09 — Make activity diagnosable across clients

The feature work joined persisted server observations with the browser dashboard, CLI, MCP and WebMCP. The core boundary stayed explicit: an account sees its own records; all-account reads require a configured operator authenticated by session or API key. OAuth remains owner-scoped. The data contract records safe operation metadata and provider-reported measurements, with missing usage and cost left unknown.

The first useful failure came from exercising the actual HTTP MCP stack through the CLI: the SDK's native response replaced the response prepared by Hono and dropped `X-Request-ID`. Restoring the header after downstream response finalization fixed cross-client trace lookup. The regression now checks a failed MCP tool's root, tool span and internal HTTP child using real SQLite, an ephemeral server and browser tool registration.

A separate review found that font keyboard navigation selected index zero even when the search had no results. Enter then dereferenced an absent option instead of accepting the custom family. The editor now keeps the empty-list index unset and falls back to the typed family; its browser regression saves and reads back that custom choice.

Dashboard review concentrated on asynchronous ownership. A response from an older trace lookup could overwrite a newer selection, and an unmounted dashboard could write a stale trace into another page's URL. Request generations now invalidate both stale requests and unmounted instances. Changing filters also clears results and pagination before loading, so metrics cannot retain the old query's labels or mix event pages across queries.

The media polling review exposed another timing boundary: publishing a cached asset before recording usage lets another poll finalize the span without measurements. Atomic completion now preserves the first terminal status/time and enriches only missing measurements. The real SQLite regression passed for both poll orders, repeated completion, preserved zero values and late measurements on a failed result; summary counts do not inflate. Post-result errors and duplicate poll branches also retain available usage.

Documentation and design-agent guidance were updated against the schema, layout and render owners. The bundled skill now has common layout checks plus six kind references. The four supplied screenshots were inspected, optimized to WebP without resizing, and inspected again; their aggregate size fell from 3,697,007 to 542,124 bytes. Skill ZIP packaging includes every reference recursively.

Local delivery evidence is distinct from shipping. The release unit report records CLI build, typecheck and 147 passing tests on the working tree. Browser runs, final reviewed source checks, exact-SHA CI, main merge, release publication and deployed runtime are controller gates. Local tests do not prove live provider generation, PostHog acceptance or a production rollout.

The `ak` CLI is unavailable in this shell (`command -v ak` returned no executable), so this requested journal was saved directly under the active plan. AgentWiki publish skipped.

Next: finish controller browser/release gates; retain deployment evidence under this plan instead of converting execution history into evergreen product claims.
