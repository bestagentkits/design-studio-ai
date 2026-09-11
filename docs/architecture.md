# Architecture and shared contract

Design Studio AI uses a validated document as the boundary between people, agents, providers, and renderers. The [product brief](product-brief.md) records the requested outcome; executable schemas/routes own the current implementation.

Desktop sidebar visibility is URL-backed through [screen-state.ts](../src/app/screen-state.ts). Preview starts with both sidebars closed and allows each to be expanded independently; `previewLeft`/`previewRight` preserve preview choices separately from Edit’s `left`/`right`. Reload and browser history restore those choices. Mobile Preview remains canvas-only; Edit uses the mobile panel navigation.

## Runtime boundaries

The [React application](../src/app/app.tsx) provides the library. Its [editor](../src/app/editor.tsx) coordinates direct editing, proposals, local undo/redo, assets, timeline playback, exports, and feature-detected WebMCP. The [Hono handler](../server/index.ts) owns authentication, persistence, provider requests, publishing, OAuth, and network MCP.

When a page thumbnail has keyboard focus, Left/Right selects and focuses the adjacent page, keeping its thumbnail visible and stopping at the first/last page. Canvas-object arrow nudging and text-field caret controls retain their own behavior.

The same bounded navigation applies to editor/inspector panel choices, mobile panels, and appearance choices. Layers and provider choices use Up/Down; Settings follows its vertical desktop or horizontal mobile layout. Home/End selects the first/last choice. The shared [keyboard navigation helper](../src/app/keyboard-navigation.ts) keeps focus with selection and scrolls only to reveal that choice.

Canvas editing shortcuts respect focused controls, text input, IME composition, dialogs, popovers, preview, and pending operations. Layer-list arrows navigate instead of nudging; canvas object focus supports nudging and layer/canvas focus supports duplicate/delete. Dialogs restore focus to their opener when closed; Escape honors an owner's busy guard. Escape in the appearance menu closes that menu without changing underlying selection or documentation search.

Cloudflare runs that handler with D1, R2, static assets, and Browser Rendering. The [Node adapter](../server/node.ts) supplies SQLite, filesystem assets, static serving, and Chromium for the same routes. Headless export runs the application's bundled renderer against validated data; it is not a general remote browser or user-code execution service.

## Document and edit contracts

| Contract | Machine-owned authority |
| --- | --- |
| Document v1/v2, projects, themes, nodes, pages, assets, timelines, semantic validation | [schema.ts](../src/shared/schema.ts); `dsa schema` |
| Targeted edits and timeline interpolation | [operations.ts](../src/shared/operations.ts); `dsa schema --operations` |
| Explicitly selected starter templates, themes, and blocks | [catalog.ts](../src/shared/catalog.ts) |
| Safe HTML/SVG and presentation interpretation | [render.ts](../src/shared/render.ts) |

One document covers web interfaces, slides, reports, wireframes, 3D, and video. Pages contain ordered flat node arrays with optional parent references; coordinates use pixels, rotation degrees, and timeline time seconds. Validation rejects invalid IDs/references, cycles, non-finite geometry, unsupported versions, and invalid timeline targets. Style/data fields do not authorize arbitrary CSS, DOM properties, or code. Renderers interpret supported values and escape text.

Optional structured capabilities live in [design-capabilities.ts](../src/shared/design-capabilities.ts). A page or container can use flex, grid, or explicit absolute layout, with sizing and transform pivots. Parent references form the editable layer tree; nodes without an explicit parent layout retain legacy page-space coordinates. Explicit absolute containers use local child coordinates. New Web/App templates use structured layout. [DocumentView](../src/app/document-view.tsx) renders real interactive components; [layout.ts](../src/shared/layout.ts) resolves geometry for structural operations and static SVG. Text/component intrinsic sizing requires browser measurement for pixel fidelity.

The [component inspector](../src/app/component-inspector.tsx), [scene inspector](../src/app/scene-inspector.tsx), and [layer tree](../src/app/layer-tree.tsx) stay on the shared document and operation contracts so manual and agent edits remain interchangeable.

The component renderer uses Ant Design and themeable Radix/native controls. Structured PowerPoint pages are rasterized to preserve browser layout; legacy text and primitive shapes remain native PowerPoint objects. [React source export](../src/shared/react-export.ts) packages the document, trusted component source, dependencies, and embedded assets into a runnable frontend project. Browser and authenticated GLB/glTF export use the [shared scene runtime](../src/shared/scene-runtime.ts), including sampled animation and skinning. REST, MCP and CLI export also return React ZIP and GLB/glTF bytes. Server exports embed owned assets; React includes portable source assets, while glTF embeds buffers/textures without external sidecars.

Reusable design systems use [shared definitions](../src/shared/design-systems.ts) and [owner-scoped routes](../server/design-systems.ts). Tokens, component presets and page compositions are stored as immutable numbered versions. Updating requires the observed version; applying/inserting requires the project revision. Projects embed their content and pin system identity/version, so library deletion does not break an existing design. Insertion remaps layer/interaction IDs and normalizes legacy coordinates. Library definitions reject private project asset references.

The [scene compositor](../src/shared/scene-composition.ts) is shared by the editor, thumbnail/export capture, and published viewer to keep 2D captions in document paint order relative to 3D objects. Depth testing applies within consecutive 3D segments; a 2D layer separates those segments. This layering contract does not make captions part of GLB/glTF geometry. Material import and overrides belong to the [scene runtime](../src/shared/scene-runtime.ts).

Project thumbnails capture the saved document through the same browser renderer. An inert offscreen stage isolates rendering without shifting the captured root. Successful previews are cached in memory by project ID and document revision (up to 48); saves invalidate the revision key. Motion covers use the timeline midpoint so opening fades do not produce empty thumbnails. Scene captures paint 3D canvases directly between their ordered 2D layers, avoiding WebKit dropping cloned canvas images inside SVG foreign objects. Pixel-level browser tests cover SVG, DOM, slides, motion and 3D output.

Browser mesh editing runs validated operations in a [geometry worker](../scripts/geometry-worker.ts); vertices, triangles, UVs, bones and weights remain structured document data. Mesh manipulation, UV projection and bone editing do not execute agent-supplied JavaScript. Imported GLB objects can be placed and exported, while direct vertex editing currently operates on document meshes or converted primitives.

Live editing uses [three-way merge](../src/shared/document-merge.ts) through [collaboration routes](../server/collaboration.ts). The editor checks for remote revisions on a 1.2-second interval and merges independent field changes. Overlapping edits return explicit conflicts; the UI preserves its local state and pauses automatic writes. This is polling synchronization, not a WebSocket presence service. Undo snapshots are rebased against remote edits; incompatible snapshots are removed with a notice. Document writes retain the existing atomic owner/revision check and never alter brief approval.

The persisted project revision is distinct from the document schema version. Document PUT accepts `{document,expectedRevision}` and uses an atomic SQL update conditioned on project ID, owner, and revision. Stale writes return 409; clients re-read and reconcile. Provider generation returns a proposal and preserves the saved document until an explicit revision-checked write. Generated media is placed into nodes separately.

## API owners

JSON errors use `{error:{code,message,details?}}` without secrets. Routes validate inputs and scope resources to the authenticated owner; other-user resources return 404. Exports return bytes with content type/disposition.

| Surface | Implementation |
| --- | --- |
| Health/config, sessions, provider settings, API tokens | [index.ts](../server/index.ts), [security.ts](../server/security.ts) |
| Projects, saves, uploads, clones, publication, preview/share aliases | [projects.ts](../server/projects.ts) |
| Project conversations | [conversations.ts](../server/conversations.ts) |
| Structured generation and typed media jobs/edits | [providers.ts](../server/providers.ts), [capability guide](providers.md) |
| Design-system versions and project application | [design-systems.ts](../server/design-systems.ts) |
| Google Fonts and provider model discovery | [discovery.ts](../server/discovery.ts) |
| Authenticated file export | [exports.ts](../server/exports.ts) |
| Activity summaries, events, traces, and sanitized client events | [observability.ts](../server/observability.ts), [queries](../server/observability-queries.ts), [shared contract](../src/shared/observability.ts) |
| Native Google Slides | [google-slides.ts](../server/google-slides.ts) |
| OAuth discovery, consent, PKCE, tokens | [oauth.ts](../server/oauth.ts) |
| Streamable HTTP tools/resources | [mcp.ts](../server/mcp.ts) |

Export POST `/api/projects/:id/export` accepts `{format,pageIndex?,expectedRevision?,start?,end?,fps?}`. POST/DELETE `/api/projects/:id/preview` and `/share` are naming-specific aliases for the immutable public snapshot workflow; they return `{url,revision}` on creation and `{ok:true}` on removal. Media POST `/api/projects/:id/media` accepts the [typed provider payload](providers.md); fal jobs are polled through the project media-job route. Clients should discover tool schemas/CLI help instead of maintaining separate document adapters.

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

Cloud binary rendering embeds owned assets and blocks external browser requests: remote media must be imported first. The server separately fetches Google Fonts CSS and font bytes from fixed Google origins with redirect, time and byte limits, then embeds them before isolated rendering. Browser previews load Google stylesheets directly. Catalog configuration and fallback behavior are described in [Providers](providers.md). Bounds include 16,777,216 pixels per checked object/page and 67,108,864 pixels across the selected render workload, plus embedded-byte limits. Motion records actual timeline content for up to 60 seconds; unavailable encoders fail explicitly. MP4 depends on runtime support. [exports.ts](../server/exports.ts) owns current enforced limits.

SVG cannot preserve an interactive WebGL scene as editable geometry. Raster/PDF/video render real WebGL content. Format support does not imply every node remains natively editable in every output.

Cloud motion composition preserves layer order and mixes imported audio/video tracks. The browser fallback records silent motion. Camera and light properties, object transforms, materials, mesh/UV data and skinning are serialized scene state; preview playback never writes animated poses into the stored bind pose.

## Activity and instrumentation boundaries

[Request/span instrumentation](../server/observability.ts) and the [event store](../server/observability-store.ts) record bounded metadata for correlation, duration, outcome, and provider-reported usage. A started record precedes completion; unfinished records remain distinguishable from successful work and can be marked interrupted during maintenance. Trace parentage ties supported nested work together without storing request bodies, prompts, response content, or credentials. Instrumentation failure is reported through coverage indicators and must not fail the underlying product request.

[Activity queries](../server/observability-queries.ts) enforce owner scope by default. Global reads require an explicitly configured operator using a session or API key; an OAuth token cannot inherit global operator authority. The [shared schema](../src/shared/observability.ts) owns filters and nullable usage fields. Summaries separate root HTTP requests from nested spans to avoid presenting every internal step as another request. Missing cost remains unknown, and measured-call counts describe partial coverage. Last activity does not establish live presence or automatic retries.

Sanitized client events use a strict allowlist and remain distinguishable from server-observed outcomes. Optional [PostHog forwarding](../server/observability-posthog.ts) sends those approved event fields server-side; it is not a session replay or arbitrary browser capture channel. The [deployment guide](deployment.md#activity-retention-and-optional-posthog) owns configuration and retention. These operational records do not replace project revisions, explicit brief approval, or artifact inspection.

## Operations and verification

[Deployment](deployment.md) covers secrets, migrations, storage, browsers, backups, and rollback. [Tests](../tests) cover schema/operations, content safety, tenant isolation, revisions, OAuth, publication, CLI subprocesses, provider requests, and exports. Browser checks exercise desktop/touch workflows. External credential-dependent success is separate from local contract validation.

Release evidence and pending checks live in the [finalization report](../plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md). A build, filename, or configured key does not establish deployment, format validity, or provider success.

Creative document versioning, immutable tiles, safe composites and current integration limits are described in [Creative tools](creative-tools.md).

## Native character motion

[Character motion](character-motion.md) documents the v2 schema, shared operations, GPU/Canvas/SVG evaluators, proposal guards and portable/frame exports. The existing project kind and document revision remain independent from schema version.
