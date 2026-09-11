---
name: design-studio-ai
description: Create, inspect, refine, export, and publish structured web designs, slides, reports, wireframes, 3D scenes, and timeline projects in Design Studio AI through its CLI or authenticated MCP tools.
---

# Design Studio AI

Use Design Studio's existing document, templates, and node operations to produce editable designs. The hosted workspace is `https://studio.agentkit.best`. Use the user's configured server when self-hosting.

## Establish the brief

Reuse context for audience, purpose, deliverable format, dimensions, brand/theme, content, and success criteria. Ask only for missing choices that materially change the result. Respect supplied assets and exact copy. Distinguish a request to design from authorization to publish publicly or incur provider charges.

For a new prompt-driven project, use `get_design_brief` and `update_design_brief` (CLI `brief get` / `brief put`). Start with `{request:"the user's request"}` and brief revision 0. Use your own model to propose an `interview` containing a concise `message`, up to eight contextual `questions`, and a proposed `scope` or null. Questions have stable IDs, title, description, type (`text`, `single`, `multiple`), options, and required. Ask these in the host conversation or direct the user to the project's interactive Studio questions. This path requires no additional provider API key.

Persist answers rather than guessing them. Propose a scope with objective, audience, direction, deliverables, constraints, and acceptanceCriteria. Read it back to the human; invoke `approve_design_brief` only after explicit approval of this version. Brief revisions are separate from document revisions. Every update invalidates approval; a 409 requires rereading and reconciling the brief. BYOK `interview_design_brief` / `brief interview` is optional and incurs provider usage. An existing unapproved brief blocks provider design generation. A blank/manual project can still be edited directly.

## Connect and inspect

Use `dsa --help` and `dsa health`. Authentication comes from `DESIGN_STUDIO_API_KEY`; server selection comes from `DESIGN_STUDIO_URL`. The CLI persists neither secret. If unavailable, install the source package's generated tarball using the repository's package instructions; do not assume an unpublished npm version exists. An authenticated MCP connection at `/mcp` can perform the same project workflows; discover its actual tool schemas first.

Run `dsa catalog`, or narrower `themes list`, `templates list --kind slides`, and `blocks list`. Inspect relevant entries before choosing them. Use `dsa schema` for the document and `dsa schema --operations` for targeted edits. Schemas are generated from the actual shared validators; the server additionally checks IDs, parent relationships, timeline references, and ownership.

Create from a suitable template, or read an existing project:

```sh
dsa projects create --name "Quarterly narrative" --template product-deck
dsa projects get PROJECT_ID
```

The get result contains `{project:{id,revision,document,...}}`. Save the observed revision with the working document. Read actual page and node IDs; never invent IDs for existing elements.

For browser WebMCP, registered operation/document inputs are compact envelopes; fetch the full nested schemas through `studio_capabilities` before composing payloads. Execution still validates the complete shared contracts. Discover `studio_capabilities` and read `studio_get_design` before editing the open canvas. `studio_apply_operations` edits local state; Live mode autosaves, otherwise call `studio_save_design` explicitly. Tools named `studio_api_…` act on saved server state, so save and verify the revision before using them to export or publish local edits. WebMCP is experimental; use network MCP or CLI when the browser does not expose it. The [public reference](https://studio.agentkit.best/docs/webmcp) explains inputs and boundaries; use the configured server's reference when self-hosting.

## Choose the design-kind guidance

Before creating or substantially refining a design, read [shared layout and quality](references/layout-and-quality.md), then the reference matching the actual document `kind`. For mixed work, read each relevant reference; preserve the approved brief and user taste. These references guide composition and review, while live schemas remain authoritative for fields and limits.

| Kind | Guidance |
| --- | --- |
| `web` | [Web interfaces](references/web.md): Flex-first reading flow, components, responsive review |
| `slides` | [Presentations](references/slides.md): narrative, slide hierarchy, audience-scale review |
| `report` | [Reports](references/report.md): evidence, editorial flow, page and chart review |
| `wireframe` | [Wireframes](references/wireframe.md): task flows, states, interaction review |
| `3d` | [3D scenes](references/3d.md): staging, materials, camera, mesh and export review |
| `video` | [Timeline videos](references/video.md): readable beats, motion, sound and playback review |

Favor Flex for ordinary content relationships, Grid for real two-dimensional structure, and absolute placement for intentional overlays, fixed compositions, scene staging, or motion. Do not interpret a scaled fixed canvas as proof of responsive reflow. Recover overflow by fixing structure and available space before shrinking typography or changing approved copy.

## Refine through targeted operations

Prefer a small operation array for requested edits over replacing the entire design. For example, after reading the actual target IDs, write an operations file:

```json
[
  {"op":"update-node","nodeId":"ACTUAL_NODE_ID","changes":{"text":"The next chapter","style":{"fontSize":64}}},
  {"op":"apply-theme","themeId":"atelier"}
]
```

```sh
dsa projects document patch PROJECT_ID --revision OBSERVED_REVISION --file operations.json
```

`update-node` merges style properties. Supported operations also add/remove nodes/pages, insert catalog blocks, rename a document, set a full theme, and set timeline data. Removing a parent removes descendants; removal also cleans affected timeline tracks. The operation schema is the authority for payload shapes.

A 409 conflict means someone changed the project. Read the new revision, compare the intended edits, and reapply only what still makes sense. Do not blindly raise `--revision`, repeatedly overwrite the whole document, or hide the conflict.

For concurrent human/agent work, retain the exact document and revision you read as the merge base. Use `projects document changes` / MCP `get_design_changes` to observe saved updates. `projects document merge` / MCP `merge_design` reconciles your edited document with that original base; inspect live help/schema for its payload. Resolve reported overlapping changes explicitly. Never modify the base or invent its revision to force a merge.

For a broad creation request, `generate` can ask the user's configured provider for a proposal. It does not save automatically:

```sh
dsa generate PROJECT_ID --provider openai --revision OBSERVED_REVISION --prompt-file brief.txt --output proposal.json
dsa projects document put PROJECT_ID --revision OBSERVED_REVISION --file proposal.json
```

Inspect the proposal before the second command. Preserve useful work unless the user asked to replace it. Provider errors leave the project unchanged.

## Reuse libraries and discover resources

Inspect `design-systems list`, the selected library, and `design-systems schema` before applying or inserting reusable tokens, components, or page compositions. Read the immutable library version and target project revision; use those observed values for updates and project writes. Reconcile a stale library or project instead of substituting newer version numbers. Capture only portable media in a library; private project asset references cannot be reused across projects. Discover equivalent network tools through `tools/list`.

Use `fonts --query` and `providers models PROVIDER --query` to discover names and model IDs. Respect live/cache/fallback provenance: a suggestion does not prove model capability, credentials, quota, or successful generation. Model discovery needs account/API-key access rather than MCP OAuth. Choose actual schema-defined layout, component, mesh and timeline fields; do not invent a second design format.

## Observe activity without guessing outcomes

Use `dsa observability summary`, `dsa observability events`, or `dsa observability trace TRACE_ID` when diagnosing activity or provider usage. Discover the equivalent MCP tools `get_observability_summary`, `list_activity_events`, and `get_activity_trace` and their actual schemas. Read installed CLI help for filters and event pagination; use the returned cursor unchanged. Reads default to your authenticated owner's events. Global scope requires an explicitly configured operator with application-session/API-key authorization; OAuth never grants global access.

Preserve trace/parent IDs and coverage information when explaining a failure. `running` has no observed completion; `interrupted` is not proof an external provider failed. Browser events are reported interactions, not verified server outcomes. Missing tokens or USD cost remain unknown, not zero; measured-call counts show partial coverage. Recent activity is not online presence, repeated actions do not establish retry counts, and the 30-day window cannot reveal earlier history. Inspect the saved design and actual artifacts before claiming success. Reading a trace does not authorize another provider charge, retry, or publication.

## Assets and media

Use `assets upload PROJECT_ID --file image.png`, then add the returned asset to the document and use its URL in an image node. Upload alone does not place it on the canvas. Asset MIME types and size limits are enforced by the server. Use `assets list` and `assets download` to inspect stored results.

Provider keys use `providers set openai --key-env OPENAI_API_KEY`, or `--key-stdin`; never write secrets into prompts, design documents, or committed files. `generate` and `brief interview` also support the official `deepseek` provider and configured `custom-<slug>` connections. Use `list_provider_connections` with API-key MCP access (or `dsa providers list`) to discover saved custom IDs. Custom connections require a name, allowlisted HTTPS base URL, model, API format (OpenAI/Anthropic/Gemini compatible) and authentication method (bearer/api-key/basic/none); see `dsa providers set --help`. Never pass raw credentials through agent tool arguments; the human can configure Settings or supply CLI environment/stdin credentials. `media generate` supports prompt-only Gemini, Grok and Leonardo images, custom OpenAI/Gemini compatible images, and OpenAI image generation/editing and speech, plus fal images, video generation/editing, and music/sound effects with source-audio transformation. Use `--source-asset ID` for an asset owned by this project; the source is sent to the chosen provider without being automatically published. Select only compatible models and respect the user's provider-spend authorization.

```sh
dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt
dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt
dsa media status PROJECT_ID JOB_ID
```

`--duration` applies to supported video/music modes. `--strength` from 0 to 1 applies only to fal source-image/source-audio transformations; `--voice` is for OpenAI speech. Inspect command help and provider errors for incompatible options. All fal modes and Leonardo image generation return queued jobs: poll to the final status and inspect the asset before placing it in a document. Never report a queued job as completed media or replace a failed call with an invented result.

## Inspect quality and deliver

Run `dsa projects check PROJECT_ID` or MCP `inspect_design` on the saved revision before delivery. Findings contain page/node IDs for targeted corrections; inspect them, apply focused edits, save with the observed revision, then check again. In an open browser editor, `studio_inspect_design` includes unsaved canvas changes. The inspector flags likely overflow, missing media/content and estimated contrast; its bounded output and stated limitations do not replace visual review or certify accessibility.

For responsive web designs, inspect the narrow mobile viewport first, then the intended wider viewports. Check readable contrast, text fitting, hierarchy, alignment, consistent spacing, typography, asset sharpness, and intact page content. Check touch targets, keyboard access, and visible focus for interactive output. Validate the browsers required by the brief and name those actually checked; one Chromium result does not establish cross-browser support. For motion, inspect timing and interpolation; for 3D, inspect the real scene in the editor. A successful save alone does not establish visual quality.

Discover current `projects export --help` before choosing a format; older installed releases may have fewer formats than the current server. Server export includes React frontend ZIP and GLB/glTF scenes alongside document, image, presentation and video outputs. React is a runnable frontend prototype, without a business backend; GLB/glTF preserve supported scene geometry and animation, not web UI. Binary formats require `--output FILE`. PNG/PDF/PPTX, motion and 3D exports require a configured browser renderer; React ZIP does not. Use `--revision` to bind export to the inspected revision. Import remote media into the project before cloud binary export. Motion is limited to 60 seconds, and MP4 requires encoder support. Cloud motion mixes imported audio/video; browser fallback recordings are silent.

`render --file design.json --format svg --page 0 --time 1.5` renders an offline static frame without fetching private assets. Static 3D representations are not actual scene screenshots; server HTML can include the trusted interactive viewer and binary outputs use real WebGL. PowerPoint retains editable text/primitives with complex-node rasterization. `google-slides PROJECT_ID --key-env GOOGLE_ACCESS_TOKEN` requires valid Google authorization and supported native text/shapes/HTTPS images. Verify each output opens and contains the expected content; don't infer full editable parity across formats.

Publish when already authorized by the user's request, using `publish PROJECT_ID`. CLI `preview` and `share` (MCP `preview_project` and `share_project`) also create public frozen snapshots, including referenced assets; they are not private editor previews. Use local inspection when public exposure is outside the requested scope. `unpublish`, `unpreview`, and `unshare` each remove all public snapshots for that project. Public publishing permission does not imply permission to publish unrelated projects or reveal secrets.

Report the project/artifact URL or output path, what was changed, verification performed, and any actual remaining configuration or format limitation. Do not claim provider generation, deployment, export fidelity, or publication without observed success.

## Boards and paint

Read the live v1/v2 document and operation schemas. Preserve board/painting roots, semantic diagram metadata, emoji identity and immutable asset references. Use shared transforms, paste and diagram operations for board edits; generation-checked layer/group operations for paint structure. For real raster strokes/fills, use MCP `paint_document`, CLI `projects paint PROJECT_ID --file command.json`, or the generated WebMCP API action for `POST /api/projects/{id}/paint`. Discover `paintingCommand` through `/api/schema` before constructing requests.

Carry the observed project revision, painting generation and a unique operation ID. Repeat the identical command under that ID only when its outcome is uncertain; same-painting pixel/settings changes conflict. Never fabricate pixel hashes or derived composites. Direct source replacement needs uploaded real RGBA8 PNG tiles. Keep scope approval and its revision separate from document changes.

Elements artwork records provenance; imported SVG is safely flattened to PNG and loses vector editing. GIF sources retain original owned bytes plus an explicit poster and millisecond playback fields. Static output uses the saved poster; inspect timed exports for actual motion and z-order. Public projections omit private painting source and hidden board elements; JSON remains private editable source. Use authenticated export when media is not embedded locally. Physical iPad/Pencil performance remains unmeasured; report only devices and artifacts actually checked.

## Native 2D character motion

Discover live v2 document and operation schemas. Use `dsa motion PROJECT_ID` or MCP `inspect_motion` to inspect IDs, then named character operations for focused edits. Keep setup poses separate from clip keys. Attachments reference asset IDs; import remote artwork before portable export. Skins reuse rig/clips; placements and controls belong to each node instance.

`generate --mode motion` returns validated operations, a preview document and baseRevision/baseBriefRevision. Apply only after explicit review, preserving both revisions via document PUT expectedRevision/expectedBriefRevision. On conflict, re-read and reconcile; never retry with a guessed revision. `motion`, `png-sequence` and `spritesheet` exports are ZIPs; frame ranges use --start/--end/--fps and exclude the end frame. Native Studio packages do not imply Spine or game-engine format support. See the live /docs/motion guide.

For editable 3D character meshes and animation, discover scene commands and follow [3D scenes](references/3d.md); use compact authoring operations, inspect sampled deformation and reopen the export.
## Saved covers

Use `get_project_thumbnail` (MCP) or `dsa projects thumbnail ID --output cover.png` for a small persisted cover. Optional revision selects a retained saved revision. Project summaries expose `thumbnailUrl` and latest ready `thumbnailRevision`. A busy render returns 202/status rendering: retry after 2 seconds; do not claim an image exists yet. Covers are private, maximum 480px per side, generated lazily with the shared server renderer, and retain the latest two completed revisions. Import external media before cloud rendering. Use full exports for detailed visual review.
