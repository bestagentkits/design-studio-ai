# Architecture and shared contract

Design Studio AI uses a validated document as the boundary between people, agents, providers, and renderers. The [product brief](product-brief.md) records the requested outcome; executable schemas/routes own the current implementation.

## Runtime boundaries

The [React application](../src/app/app.tsx) provides the library. Its [editor](../src/app/editor.tsx) coordinates direct editing, proposals, local undo/redo, assets, timeline playback, exports, and feature-detected WebMCP. The [Hono handler](../server/index.ts) owns authentication, persistence, provider requests, publishing, OAuth, and network MCP.

When a page thumbnail has keyboard focus, Left/Right selects and focuses the adjacent page, keeping its thumbnail visible and stopping at the first/last page. Canvas-object arrow nudging and text-field caret controls retain their own behavior.

The same bounded navigation applies to editor/inspector panel choices, mobile panels, and appearance choices. Layers and provider choices use Up/Down; Settings follows its vertical desktop or horizontal mobile layout. Home/End selects the first/last choice. The shared [keyboard navigation helper](../src/app/keyboard-navigation.ts) keeps focus with selection and scrolls only to reveal that choice.

Canvas editing shortcuts respect focused controls, text input, IME composition, dialogs, popovers, preview, and pending operations. Layer-list arrows navigate instead of nudging; canvas object focus supports nudging and layer/canvas focus supports duplicate/delete. Dialogs restore focus to their opener when closed; Escape honors an owner's busy guard. Escape in the appearance menu closes that menu without changing underlying selection or documentation search.

Cloudflare runs that handler with D1, R2, static assets, and Browser Rendering. The [Node adapter](../server/node.ts) supplies SQLite, filesystem assets, static serving, and Chromium for the same routes. Headless export runs the application's bundled renderer against validated data; it is not a general remote browser or user-code execution service.

## Document and edit contracts

| Contract | Machine-owned authority |
| --- | --- |
| Document v1, projects, themes, nodes, pages, assets, timelines, semantic validation | [schema.ts](../src/shared/schema.ts); `dsa schema` |
| Targeted edits and timeline interpolation | [operations.ts](../src/shared/operations.ts); `dsa schema --operations` |
| Explicitly selected starter templates, themes, and blocks | [catalog.ts](../src/shared/catalog.ts) |
| Safe HTML/SVG and presentation interpretation | [render.ts](../src/shared/render.ts) |

One document covers web interfaces, slides, reports, wireframes, 3D, and video. Pages contain ordered flat node arrays with optional parent references; coordinates use pixels, rotation degrees, and timeline time seconds. Validation rejects invalid IDs/references, cycles, non-finite geometry, unsupported versions, and invalid timeline targets. Style/data fields do not authorize arbitrary CSS, DOM properties, or code. Renderers interpret supported values and escape text.

The persisted project revision is distinct from the document schema version. Document PUT accepts `{document,expectedRevision}` and uses an atomic SQL update conditioned on project ID, owner, and revision. Stale writes return 409; clients re-read and reconcile. Provider generation returns a proposal and preserves the saved document until an explicit revision-checked write. Generated media is placed into nodes separately.

## API owners

JSON errors use `{error:{code,message,details?}}` without secrets. Routes validate inputs and scope resources to the authenticated owner; other-user resources return 404. Exports return bytes with content type/disposition.

| Surface | Implementation |
| --- | --- |
| Health/config, sessions, provider settings, API tokens | [index.ts](../server/index.ts), [security.ts](../server/security.ts) |
| Projects, saves, uploads, clones, publication | [projects.ts](../server/projects.ts) |
| Project conversations | [conversations.ts](../server/conversations.ts) |
| Structured generation and typed media jobs/edits | [providers.ts](../server/providers.ts), [capability guide](providers.md) |
| Authenticated file export | [exports.ts](../server/exports.ts) |
| Native Google Slides | [google-slides.ts](../server/google-slides.ts) |
| OAuth discovery, consent, PKCE, tokens | [oauth.ts](../server/oauth.ts) |
| Streamable HTTP tools/resources | [mcp.ts](../server/mcp.ts) |

Export POST `/api/projects/:id/export` accepts `{format,pageIndex?,expectedRevision?}`. Media POST `/api/projects/:id/media` accepts the [typed provider payload](providers.md); fal jobs are polled through the project media-job route. Clients should discover tool schemas/CLI help instead of maintaining separate document adapters.

## Ownership, secrets, and publication

[Migrations](../migrations) maintain relational state and ownership. SQL uses bound parameters. Source media must belong to the authenticated user and target project. Cloned owned asset bytes survive source-project deletion.

Passwords use salted PBKDF2. Opaque sessions are hashed, expire, and use HttpOnly/SameSite cookies with Secure on HTTPS. Cookie writes require a trusted Origin. API/OAuth tokens are hashed, revocable Bearer credentials. Provider keys use AES-GCM with a stable operator-held secret and return only masked metadata. Credentials do not belong in documents, exports, publication, or browser localStorage.

[GitHub login](../server/github-login.ts) issues the same application sessions after a server-side authorization-code exchange. Stable GitHub IDs live in a separate identity table; email equality never automatically links an existing account. Encrypted PKCE verifiers, browser-bound hashed state, atomic state consumption, and session-bound explicit linking protect the callback. GitHub provider tokens are not persisted. This human sign-in flow is separate from the MCP OAuth authorization server.

Publishing freezes a snapshot with snapshot-scoped assets; later private edits do not alter it. Unpublish removes the project's snapshots. Escaped published markup receives CSP/response headers. Uploaded media is bounded and type/signature checked. Imported markup becomes allowed document data rather than trusted application HTML.

Provider origins are fixed or explicitly HTTPS-allowlisted by the operator. Requests reject redirects, bound time/bytes, and redact upstream diagnostics. Private media edits send bytes or a supported data URI directly to the chosen provider without automatically publishing the source.

## Agent surfaces

Prompt-driven projects use a separate, owner-scoped design brief. [Brief routes](../server/briefs.ts) persist questions, answers, proposed scope and explicit approval with an independent revision. Server providers and external agents share this contract. Any change invalidates approval; late interview responses cannot overwrite newer answers. Provider generation reads approved scope and checks it again after the response. Manual document editing remains available.

[Design checks](../src/shared/design-checks.ts) provide bounded, deterministic preflight findings. The editor checks current local geometry; REST/MCP/CLI check the saved revision. Findings identify exact layers and explain limits; they neither block publication nor certify visual or accessibility quality.

Network MCP uses stateless Streamable HTTP POST at `/mcp`, with API-token/OAuth authentication and independent Origin validation. The server supports `2025-11-25` and declared SDK legacy compatibility, not the newer 2026 transport. Tools reuse ownership/revision services.

OAuth implements discovery, dynamic registration, authenticated consent, exact registered redirects, S256 PKCE, canonical MCP audience checks, one-use atomic authorization codes, and refresh tokens. Clients receive MCP credentials, never application sessions or provider keys.

The consent page permits form submissions to the studio and the validated callback origin: Chromium applies `form-action` to the subsequent cross-origin redirect too. Keep the exact redirect-URI check on the server; never interpolate wildcard hosts or CSP directives from client registration into the policy. [Browser OAuth tests](../tests/oauth-browser.spec.ts) exercise Allow/Deny callbacks, PKCE exchange, and authenticated MCP initialization against isolated local servers.

Browser WebMCP detects `document.modelContext`, with the legacy navigator surface as a fallback, and cleans up registrations. This capability is experimental; ordinary UI and network MCP work without it. [Agent access](agents.md) covers the stateless CLI and installable skill.

## Rendering and export

Interactive 3D uses [scene-view.tsx](../src/app/scene-view.tsx); export browsers use the trusted [renderer build](../scripts/build-renderer.mjs). Preview/export parity requires inspection of actual artifacts because editable structure and pixels have different capabilities.

JSON preserves the document. SVG preserves supported static structure; HTML can include the trusted 3D/timeline viewer. PNG renders the selected page; PDF/PowerPoint process all pages. PowerPoint retains editable text/primitives and rasterizes complex nodes. Google Slides creates native text/shapes/HTTPS images and rejects unsupported complex nodes and private image references.

Cloud binary rendering embeds owned assets and blocks external requests: remote media must be imported first. Bounds include 16,777,216 pixels per checked object/page and 67,108,864 pixels across the selected render workload, plus embedded-byte limits. Motion records actual timeline content for up to 60 seconds; unavailable encoders fail explicitly. MP4 depends on runtime support. [exports.ts](../server/exports.ts) owns current enforced limits.

SVG cannot preserve an interactive WebGL scene as editable geometry. Raster/PDF/video render real WebGL content. Format support does not imply every node remains natively editable in every output.

Cloud motion composition preserves layer order and mixes imported audio/video tracks. The browser fallback records silent motion. Editor camera orbit changes are temporary preview state; serialized geometry, material, and object rotation persist.

## Operations and verification

[Deployment](deployment.md) covers secrets, migrations, storage, browsers, backups, and rollback. [Tests](../tests) cover schema/operations, content safety, tenant isolation, revisions, OAuth, publication, CLI subprocesses, provider requests, and exports. Browser checks exercise desktop/touch workflows. External credential-dependent success is separate from local contract validation.

Release evidence and pending checks live in the [finalization report](../plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md). A build, filename, or configured key does not establish deployment, format validity, or provider success.
