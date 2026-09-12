# Design Studio AI

Design Studio AI is an MIT-licensed design workspace where agents can perform the same design operations as people through a structured API, MCP tools, WebMCP, and a command-line client. The intended workflow is roughly 90% agent work: describe an outcome, inspect the rendered result, make targeted edits, and export or publish it.

This brief records the requested product scope. It is not a claim that every feature is already implemented. Delivery evidence belongs in the [implementation plan](https://github.com/bestagentkits/design-studio-ai/blob/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/2026-09-07-bootstrap-design-studio-ai/plan.md).

## Outcomes and constraints

- Build a responsive cloud application with a project library, conversational creation, live preview, and direct manipulation editor.
- Use one versioned document format for web interfaces, slide decks, reports, wireframes, 3D scenes, and timeline videos.
- Make themes, design tokens, templates, assets, and reusable design systems inspectable and editable by agents.
- Support project search, type filters, ordering, creation, duplication, editing, deletion, persistence, and publishing.
- Import structured designs and supported media; export HTML, SVG, PNG, PDF, PowerPoint, Google Slides, and video through real format implementations.
- Support bring-your-own-key text, image, audio, and video providers. Missing credentials or provider capabilities must produce actionable configuration states.
- Provide authenticated Streamable HTTP MCP with API keys and OAuth, browser WebMCP tools, a complete CLI, and an installable agent skill.
- Publish the MIT repository at `bestagentkits/design-studio-ai`, deploy on Cloudflare at `studio.agentkit.best`, and provide Docker self-hosting.
- Follow screenshot references in `screenshots/`; preserve usable touch and keyboard workflows at narrow widths.
- Prioritize human user experience (UX) and agent experience (AX) together: mobile-first responsive flows, cross-browser usability, discoverable tools, and clear recovery from errors and conflicts. These are product requirements; report tested browsers separately from intended compatibility.

The application does not execute arbitrary user code, shell commands, or backend local runtimes. Rich output is represented as validated data. External provider charges and credentials remain controlled by the user. No simulated success, fixture projects presented as user data, or placeholder exports satisfy acceptance.

## Core journeys

1. A person registers, chooses a template or blank project, describes a design, previews the generated proposal, and saves it. A failed provider call preserves the current design.
2. A person selects objects, edits content and appearance, moves or resizes objects, switches pages, previews responsive sizes, and can undo or redo local changes.
3. An agent authenticates, lists and reads a project, produces a validated document, and saves against an expected revision. A concurrent human edit produces a conflict the agent must resolve.
4. A person uploads assets, manages provider keys, renders a 3D scene or timeline, exports supported formats, and publishes a deliberate snapshot.
5. A self-hosting operator starts Docker with persistent data and a stable encryption secret; the same application contracts work without Cloudflare bindings.

## Completion criteria

Every advertised operation must work through its owning UI or agent surface, return useful errors, and preserve user data across reloads. Export files must open in format-appropriate readers. Authentication and two-account isolation must be tested. Deployment requires a reachable production URL, working persisted project writes, and verified DNS/TLS; a build alone is not deployment. Configured integrations require live verification when credentials exist, with unconfigured paths tested and reported otherwise.

The [architecture contract](architecture.md) defines the common data and API boundaries.
