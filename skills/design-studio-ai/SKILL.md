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

For a broad creation request, `generate` can ask the user's configured provider for a proposal. It does not save automatically:

```sh
dsa generate PROJECT_ID --provider openai --revision OBSERVED_REVISION --prompt-file brief.txt --output proposal.json
dsa projects document put PROJECT_ID --revision OBSERVED_REVISION --file proposal.json
```

Inspect the proposal before the second command. Preserve useful work unless the user asked to replace it. Provider errors leave the project unchanged.

## Assets and media

Use `assets upload PROJECT_ID --file image.png`, then add the returned asset to the document and use its URL in an image node. Upload alone does not place it on the canvas. Asset MIME types and size limits are enforced by the server. Use `assets list` and `assets download` to inspect stored results.

Provider keys use `providers set openai --key-env OPENAI_API_KEY`, or `--key-stdin`; never write secrets into prompts, design documents, or committed files. `media generate` supports OpenAI image generation/editing and speech, plus fal images, video generation/editing, and music/sound effects with source-audio transformation. Use `--source-asset ID` for an asset owned by this project; the source is sent to the chosen provider without being automatically published. Select only compatible models and respect the user's provider-spend authorization.

```sh
dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt
dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt
dsa media status PROJECT_ID JOB_ID
```

`--duration` applies to supported video/music modes. `--strength` from 0 to 1 applies only to fal source-image/source-audio transformations; `--voice` is for OpenAI speech. Inspect command help and provider errors for incompatible options. All fal modes return queued jobs: poll to the final status and inspect the asset before placing it in a document. Never report a queued job as completed media or replace a failed call with an invented result.

## Inspect quality and deliver

Preview at the intended size and at a relevant smaller viewport. Check readable contrast, text fitting, hierarchy, alignment, consistent spacing, typography, asset sharpness, and intact page content. For motion, inspect timing and interpolation; for 3D, inspect the real scene in the editor. A successful save alone does not establish visual quality.

CLI `projects export` requests actual JSON/HTML/SVG/PNG/PDF/PPTX/WebM/MP4 from the authenticated server. Binary formats require `--output FILE` and a configured renderer; unavailable encoders return errors. Use `--revision` to bind export to the inspected revision. Import remote media into the project before cloud binary export. Motion is limited to 60 seconds, and MP4 requires encoder support. Cloud motion mixes imported audio/video; browser fallback recordings are silent.

`render --file design.json --format svg --page 0 --time 1.5` renders an offline static frame without fetching private assets. Static 3D representations are not actual scene screenshots; server HTML can include the trusted interactive viewer and binary outputs use real WebGL. PowerPoint retains editable text/primitives with complex-node rasterization. `google-slides PROJECT_ID --key-env GOOGLE_ACCESS_TOKEN` requires valid Google authorization and supported native text/shapes/HTTPS images. Verify each output opens and contains the expected content; don't infer full editable parity across formats.

Publish when already authorized by the user's request, using `publish PROJECT_ID`. This exposes a frozen snapshot, including its referenced assets. `unpublish PROJECT_ID` removes that project's public snapshots. Public publishing permission does not imply permission to publish unrelated projects or reveal secrets.

Report the project/artifact URL or output path, what was changed, verification performed, and any actual remaining configuration or format limitation. Do not claim provider generation, deployment, export fidelity, or publication without observed success.
