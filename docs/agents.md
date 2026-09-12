# Agent access and CLI

Design Studio AI exposes one shared document contract through REST, network MCP, browser WebMCP, and `dsa`. The CLI package is maintained under [packages/cli](../packages/cli/README.md). Its executable bundles the shared validators, theme/template/block catalog, targeted operations, and safe static renderers. It does not require a running local project checkout after installation.

## Install and connect

Follow the [CLI installation instructions](../README.md#agent-access) for the released tarball. The package is not published to the npm registry.

To build from source, install dependencies with `npm ci` and `npm ci --prefix packages/cli`, then run `npm run build --prefix packages/cli`. From `packages/cli`, run `npm pack`; install the resulting tarball with `npm install -g <path-to-tarball>`. The build also generates `dist/document.schema.json` and `dist/operations.schema.json`.

Set `DESIGN_STUDIO_URL=https://studio.agentkit.best` and inject `DESIGN_STUDIO_API_KEY` from workspace Settings. `dsa` does not save a configuration file, keychain record, or login session. `--url` and `--api-key` override these values for one invocation; use environment injection to avoid shell history. HTTP is accepted for localhost development only.

Install the [companion skill](../skills/design-studio-ai/SKILL.md) by copying its directory into the installed skills directory of your agent runtime. The repository layout is also suitable for a skill installer that accepts a repository and skill path. Copy the complete directory, including `references/`. The skill routes each design kind to composition and review guidance, alongside brief capture, catalog discovery, targeted edits, and authorized exports/publishing. Start with its [shared layout and quality reference](../skills/design-studio-ai/references/layout-and-quality.md); the [skill index](../skills/design-studio-ai/SKILL.md#choose-the-design-kind-guidance) links the kind-specific references.

## CLI command surface

This reference follows the current [CLI source](../packages/cli/src/dsa.ts) and [library commands](../packages/cli/src/design-system-commands.ts). The linked release can lag these capabilities; inspect installed command help and build from source when a needed command is absent.

| Commands | Behavior |
| --- | --- |
| `health`, `config` | Public health and configuration; no credential persistence |
| `schema [--operations]` | JSON Schema from the shared validators; semantic checks still run on writes |
| `catalog`, `themes list/get`, `templates list/get/instantiate`, `blocks list/get` | Bundled design resources; instantiated IDs are unique |
| `projects list/get/create/rename/delete/clone` | Persisted project management; clone copies owned asset bytes |
| `projects paint ID --file command.json` | Server-rendered stroke/fill using observed revision, painting generation and exact retry ID |
| `projects document get/put/patch` | Canonical document reads and atomic expected-revision writes |
| `projects document merge/changes` | Three-way merge using the exact earlier base, and revision polling |
| `brief get/put/interview/approve` | Persisted interactive questions, answers, scope and explicit version-bound approval |
| `observability summary/events/trace` | Owner-scoped activity, provider usage, and correlated spans; global reads require configured operator authorization |
| `projects check` | Read-only preflight hints with exact layer IDs; inspect the actual preview too |
| `projects import/export`, `render` | Canonical JSON import; authenticated cloud export; offline JSON/HTML/SVG rendering |
| `assets list/upload/download` | Authenticated asset storage; node placement is a separate document edit |
| `generate` | Real provider document proposal; no implicit save |
| `fonts --query`, `providers models PROVIDER --query` | Search catalog metadata with explicit live/cache/fallback provenance |
| `design-systems schema/list/get/versions/create/update/apply/insert/remove` | Shared reusable libraries, immutable versions and conflict-checked project writes |
| `providers list/set/remove` | Masked configuration; provider secret from environment/stdin |
| `tokens list/create/revoke` | Token metadata and lifecycle; new token returned once |
| `publish`, `unpublish`, `preview`, `unpreview`, `share`, `unshare` | Public immutable snapshot creation and removal; preview/share are naming-specific aliases for the same public snapshot contract, and each removal alias removes all public snapshots |
| `media generate/status` | OpenAI image/edit/speech; fal image, video/edit, music/effects, and source-audio jobs |
| `google-slides` | Server export using a short-lived Google OAuth token |
| `api METHOD /api/path` | Same-origin REST escape hatch; JSON input from file/stdin |

All option details are available through command `--help`. Document and operation files accept `--file -` for stdin. The default output is JSON; document/export/template content is raw when sent to stdout. `--output` writes the artifact and returns JSON metadata. Errors are JSON on stderr. Exit codes are 0 success, 1 input/API/conflict, 2 auth, 3 network/invalid response, and 4 local runtime/file errors.

## Activity, usage, and traces

Use `dsa observability summary`, `dsa observability events`, and `dsa observability trace TRACE_ID` to inspect saved activity. Network MCP exposes `get_observability_summary`, `list_activity_events`, and `get_activity_trace`; discover their schemas before calling. The browser API tools use the same authenticated REST contracts, while the human Activity view lives at `/activity` on the configured server. Read the [query and result contract](../src/shared/observability.ts) and installed command help for current filters.

Reads default to the authenticated owner's events. A user ID in `OBSERVABILITY_ADMIN_IDS` may request `scope=all` with an application session or API key; OAuth credentials never grant this global operator view. Actor filtering requires operator scope. Shared filters include time window, project, channel, kind, status, and action. Use returned `nextCursor` for event pagination; do not invent cursor values. A trace can be filtered or truncated, so an incomplete result does not prove no other spans existed.

Events link `traceId` and `parentId` across supported request/tool/provider work. `running` means completion has not yet been observed; `interrupted` means the recorded operation outlived its completion lease, not proof the external provider failed. Recent activity is not online presence, and repeated actions are not a verified retry count. Browser events are reported interactions, not authoritative proof that a server write succeeded.

Token and USD cost values come from provider-reported fields. Missing values remain `null`; never treat them as zero or infer a price from an unverified model name. Summary totals may include only measured calls: retain `measuredTokenCalls`, `measuredCostCalls`, and coverage limitations when reporting usage. Inspect storage degradation and dropped-event indicators before interpreting an empty result. Queries exclude events outside the 30-day retention window; no pre-instrumentation history is reconstructed.

The [deployment guide](deployment.md#activity-retention-and-optional-posthog) owns operator configuration, retention cleanup, and optional PostHog forwarding. Use activity metadata to locate a failure, then inspect the real project/artifact before claiming recovery.

## Revision workflow

Start prompt-driven projects with a saved brief. `update_design_brief` (CLI `brief put`) accepts a request and agent-authored contextual questions/scope; it needs no BYOK key when the agent uses its own model. `interview_design_brief` optionally uses a configured provider. Show questions in the host conversation or Studio, save answers, review the scope, and call `approve_design_brief` only after the human approves that version. Brief revisions and document revisions are independent. Any brief edit invalidates approval. Provider generation requires approval when a brief exists. Manual editing remains available.

Run `inspect_design` (CLI `projects check`) after saving: findings point to specific nodes and suggest corrections for fitting, bounds, media and contrast. These deterministic hints supplement visual inspection; overlapping backgrounds, font metrics, rotation and animated extremes require preview.

1. Read `projects get PROJECT_ID` and record `project.revision` with the document.
2. Inspect `schema --operations`, page/node IDs, and the relevant catalog entry.
3. Apply a short operation array with `projects document patch PROJECT_ID --revision N --file edits.json`.
4. If a conflict occurs, read the current project and reconcile the requested change. Do not blindly retry with a higher revision.
5. Inspect output at the intended viewport, then export, preview, publish, or share within the user's requested scope. `preview` and `share` return a public immutable snapshot URL; `unpreview`, `unshare`, and `unpublish` all remove the project's public snapshots.

`generate` follows the same rule: its response is a proposal that can be read by document PUT, and the original revision is required to save it. CLI renames also use revision-checked document writes. Clone is a distinct new project and copies referenced owned assets so source deletion does not break the clone.

For simultaneous human/agent edits, retain the document and revision you actually read. `projects document merge PROJECT_ID --file merge.json` accepts `{base,document,baseRevision}`; network MCP exposes `merge_design` and `get_design_changes`. Independent properties merge, while overlapping edits return conflict paths. Never alter the base or retry with an invented revision to bypass a conflict. The editor's Live mode displays saved changes without a reload and autosaves local edits. Turning Live off leaves explicit Save available.

The shared operation schema includes grouping/reparenting, structured page/node layout, track replacement/removal and keyframe upsert/removal. Component props, mesh/UV data, material settings, bones and weights use the same document validator as the browser. Discover exact fields from `/api/schema` or `dsa schema`; do not invent a separate scene format.

Browser registration uses compact input envelopes for operation batches and full-document writes so expanded nested schemas do not exhaust host registration limits. Call `studio_capabilities` before composing those payloads; it returns the canonical schemas. Local operations and server writes still run the complete shared validators. Tool names, revision checks, and credential boundaries are unchanged.

WebMCP adds `studio_capabilities` and `studio_apply_operations` for the open document, plus documented project API operations registered by [browser-design-tools.ts](../src/app/browser-design-tools.ts). API tools accept query parameters; the asset-upload tool converts `{name,mimeType,base64}` into the same multipart file route used by the browser. Credential-management operations remain outside browser tools. Local operations appear immediately and autosave when Live is enabled. Server API tools operate on saved state. Browser support remains feature-detected. The REST documentation includes a real request playground and `/api/openapi`; keys are held only in page memory, and executing a mutation affects the actual selected project.

## Reusable design systems

Discover definitions with `dsa design-systems schema`. Create/update accepts `--file`; update requires `--system-version` with the version actually read. Pinned get/apply/insert also accept `--system-version`. Apply/insert require `--revision` for the target project; insert additionally needs `--page` and `--item`. A stale library or project returns a conflict. Do not replace the observed version with a later one without reconciling the user's changes.

Network MCP exposes the same library operations through [design-system-tools.ts](../server/design-system-tools.ts). Projects embed applied tokens/components and pin the saved version. Library definitions support reusable page compositions with remapped IDs. Private project assets must be embedded or replaced with portable references before library capture. Deleting a library leaves embedded project designs intact.

## Capability boundaries

The CLI's `projects export` requests real file bytes for JSON, HTML, SVG, PNG, PDF, PPTX, WebM, MP4, React ZIP, GLB, and glTF from `/api/projects/:id/export`. Binary downloads require `--output` (or `--out`). Raster, motion and 3D formats require a configured Cloudflare/self-host browser renderer; missing configuration and unavailable encoders return errors. Optional `--revision` ensures the server exports the inspected revision, and `--page` selects a zero-based page where supported. React packages a runnable frontend prototype without a business backend. GLB/glTF preserve supported geometry, textures, skinning and sampled animation. Cloud rendering embeds owned assets; remote media must be imported first. Motion exports are capped at 60 seconds and MP4 requires encoder support. PowerPoint preserves editable text/primitives and rasterizes complex nodes.

Offline `render` supports JSON/HTML/SVG and preserves asset references without fetching private media. Its 3D representation is static; server HTML export can include the trusted interactive 3D/timeline viewer, while cloud raster export uses real WebGL rendering. Google Slides requires real authorization and supports native text/shapes/HTTPS images, rejecting unsupported complex nodes and private image URLs.

Media generation accepts `--source-asset ID`, `--duration SECONDS`, and `--strength NUMBER` for the modes described in [providers](providers.md). For example, `dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt` edits an owned source image. `dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt` queues music/effects generation. Poll a returned job with `dsa media status PROJECT_ID JOB_ID`; placing the resulting asset in the document remains a separate revision-safe edit. Provider secrets should come from `--key-env` or `--key-stdin`, and Google access tokens use the same secret-input pattern.

Network MCP lives at `/mcp` with the server's advertised protocol versions, API-token or OAuth authentication, and the same ownership/revision protections. Delivery tools include `publish_project`/`unpublish_project`, `preview_project`/`unpreview_project`, `share_project`/`unshare_project`, and `export_project`. Preview/share tools return public immutable snapshot URLs; clients should discover actual schemas and tools rather than guess names. WebMCP registers through the available browser model-context API and uses the current authenticated user. Unsupported browsers continue to use the ordinary application and network MCP.

## Implementation decisions and verification

The CLI is the scoped agentization deliverable in [release phase](https://github.com/bestagentkits/design-studio-ai/blob/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/2026-09-07-bootstrap-design-studio-ai/phase-04-integration-release.md). Curated command families cover common workflows; the explicit API escape hatch covers new REST endpoints. Structured operation arrays provide bounded batch edits without arbitrary code execution. Tokens remain stateless, requests reject redirects, and error output redacts the application token.

CLI tests live in [tests/cli.test.ts](../tests/cli.test.ts); follow the build prerequisites in [repository verification guidance](../AGENTS.md#run-the-appropriate-checks). They build and execute the distributable in real subprocesses, inspect schema/template output, and exercise authenticated project editing against the SQLite-backed handler. Renderer/server tests cover actual binary export. External provider and Google success require separate credential-dependent checks. Release evidence belongs in the [finalization report](https://github.com/bestagentkits/design-studio-ai/blob/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md).

Build the complete installable skill archive with `npm run pack:skill`. The [packaging script](../scripts/package-skill.mjs) includes the entrypoint and all design-kind references in `dist/design-studio-ai-skill.zip`.

## Creative documents

Clients must read both v1 and v2 and preserve typed boards, paintings, semantic diagram metadata and immutable assets. Discover shared board transforms, paste, diagram and generation-checked layer/group operations through the live operation schema. Use `POST /api/projects/{id}/paint`, MCP `paint_document`, or `dsa projects paint PROJECT_ID --file command.json` for server-rendered strokes/fills; `paintingCommand` in `/api/schema` owns the request shape, and generated WebMCP exposes the same endpoint. Carry the observed document revision, painting generation and operation ID. Retry the identical command under that ID after uncertain delivery; never fabricate pixel hashes or retry with a guessed revision. See [creative tools](creative-tools.md) for recovery, Elements/GIF timing, publication privacy and device limits. A v1-only client cannot save an upgraded v2 project.

Native diagram appearance uses `diagram-style` with a partial `style`, optional `elementIds`, `setDefault` and `savePreset`. An empty selection changes no existing objects; omitting it targets semantic nodes and connectors. `diagram-update` edits labels and text sizing; `diagram-edge` edits bindings-independent routing, bends, label position and color. Preserve user overrides and use the shared live schema for exact fields. Bundled Vietnamese fonts and SVG geometry are shared with the editor.

## Catalog and editor parity

Discover built-in templates and themes through REST `/api/catalog`, `dsa templates list`, `dsa themes list`, or the available MCP/WebMCP catalog tools. The shared [catalog](../src/shared/catalog.ts) owns discovery; [presets](../src/shared/catalog-presets.ts) supply starting points that still need the user's content and review. A visual theme does not add a component library or a working business backend.

For edits corresponding to the component and scene inspectors, discover the [operation schema](../src/shared/operations.ts) with `dsa schema --operations`. Use `update-node` for component properties or scene materials, `update-page` for camera/light settings, and `reparent-node` for layer order or nesting. Preserve the other fields from the object you read when sending a nested `component` or `scene` change: these objects are replaced, not recursively merged. Keep texture assets in the target project and use its owned asset ID. The [3D skill reference](../skills/design-studio-ai/references/3d.md) covers composition and export review.

Visual presets reference [Ant Design](https://ant.design/docs/react/customize-theme), [shadcn/ui](https://ui.shadcn.com/docs/theming), [Material 3](https://m3.material.io/styles/color/roles), [IBM Carbon](https://carbondesignsystem.com/elements/color/overview/), and [Atlassian](https://atlassian.design/foundations/color). They are adaptations to the studio’s supported renderers, not official distributions of those systems.

## Provider connections

Use the shared [provider guide](providers.md#official-and-custom-connections) for official DeepSeek, Gemini/OpenAI/Leonardo/Grok image generation and custom API connections. API-key MCP clients can call `list_provider_connections` to find saved custom IDs without receiving credentials. REST `/api/schema` exposes provider IDs and configuration/generation schemas; MCP and WebMCP use the same IDs. Saved custom IDs start with `custom-`. Credential management remains account/API-key only; MCP OAuth and WebMCP can generate with configured providers but cannot change credentials. CLI `providers set --help` describes base URL, API format and auth options; inject credentials through environment variables or stdin. Model catalog fallback is not proof of provider capability.

## Character motion

See [character motion](character-motion.md) and discover current operation schemas. `dsa motion PROJECT_ID --node NODE_ID --time 1` / MCP `inspect_motion` reads poses. Motion generation returns baseRevision/baseBriefRevision; carry both into the explicit document write (`expectedRevision`, `expectedBriefRevision`). Frame exports accept `--start`, `--end`, `--fps`; `motion`, `png-sequence`, and `spritesheet` return ZIPs. Native motion is not a Spine interchange format.

## 3D authoring

Use `dsa scene schema`, `scene inspect`, and revision-checked `scene command` (preview by default, `--apply` to save). WebMCP provides `studio_scene_command` and `studio_inspect_scene`; network MCP provides `author_scene` and `inspect_scene`. See [3D characters](3d-characters.md) for coordinates, operation boundaries, rigging and export review.
## Persistent project covers

Project summaries include `thumbnailUrl` (current saved revision) and `thumbnailRevision` (latest completed cover or null). GET `/api/projects/{id}/thumbnail?revision=N` returns a private PNG, or 202 with `Retry-After: 2` while rendering is busy. MCP `get_project_thumbnail`, WebMCP `studio_api_get_projects_id_thumbnail`, and `dsa projects thumbnail ID --revision N --output cover.png` use the same cache. A 202 is pending, not a completed download; retry after the indicated delay. Only the two latest completed covers are retained. Cloud render asset/import limits apply; no provider call occurs.

See [durable operation jobs](operation-jobs.md) for save/export recovery, result retention and Cloudflare queue provisioning.

## Community sharing

Discover `community_capabilities` through network MCP or `studio_community_capabilities` on Community pages. The [shared operation inventory](../src/shared/community-endpoints.ts) owns REST, MCP, WebMCP and `dsa community` command parity. Use `dsa community schema` and installed command help before composing requests. See [Community](community.md) for preflight/consent, pinned versions, portable files, exact retries and moderation boundaries. Browser Community tools are registered separately from editor tools to keep host schemas bounded.

`community_generate_profile` / `studio_community_generate_profile` / `dsa community generate-profile --file request.json` uses the owner's configured text provider to suggest display name, handle and bio. Omitting `provider` uses the first configured text connection. Only supplied draft fields and optional `prompt` are sent; this incurs provider usage and never saves the profile. Show the returned `suggestion` to the person before the separate revision-checked `set-profile` operation. Availability is checked again at save time.

For listing Title, Description and Tags, use `community_generate_metadata` / `studio_community_generate_metadata` / `dsa community generate-metadata --file request.json`. Supply the owned `projectId` and observed `expectedProjectRevision`; optional fields are `provider`, `title`, `description`, `tags` and `prompt`. The server sends a bounded summary of visible saved text/structure plus these fields, checks the revision before and after generation, and returns `{suggestion, provider, projectRevision}` without persistence. Review the suggestion with the person before preflight using the approved metadata. Generation does not grant publication consent; a revision conflict requires rereading and reviewing the saved project.
