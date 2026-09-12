# Design Studio AI CLI

`dsa` manages structured designs through the same authenticated API as the web workspace. Node.js 24 or newer is required. The package bundles its runtime dependencies and document schema into a standalone executable.

From the source repository:

```sh
npm ci
npm ci --prefix packages/cli
npm run build --prefix packages/cli
node packages/cli/dist/dsa.js --help
cd packages/cli
npm pack
cd ../..
```

Install the generated tarball with `npm install -g ./packages/cli/bestagentkits-design-studio-ai-0.4.2.tgz`, or install the published release directly:

```sh
npm install -g https://github.com/bestagentkits/design-studio-ai/releases/download/v0.4.2/bestagentkits-design-studio-ai-0.4.2.tgz
```

The [v0.4.2 GitHub release](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.4.2) includes CLI and skill archives. The package is not published to the npm registry.

The reference below follows this checkout. A released archive may lack newer commands or formats; inspect its `--help` and build from source when the needed capability is absent.

Use an API token created in workspace Settings. The client writes no credential files:

```sh
export DESIGN_STUDIO_URL=https://studio.agentkit.best
export DESIGN_STUDIO_API_KEY=your-api-token
dsa health
dsa templates list
dsa projects create --name "Product story" --template product-deck
dsa projects get PROJECT_ID
dsa projects document patch PROJECT_ID --revision 1 --file operations.json
dsa projects export PROJECT_ID --format html --output story.html
```

Replace the example token using your shell's secret injection mechanism. `--api-key` and `--url` also work on each invocation; environment variables avoid placing secrets in command history. Provider configuration reads `${PROVIDER}_API_KEY`, a named `--key-env`, or `--key-stdin`. Google Slides reads `GOOGLE_ACCESS_TOKEN` or the same secret options. Local development permits HTTP only on loopback hosts.

Commands print JSON except `--help`, `--version`, and export/document/template content sent to stdout. Use `--output` to write artifacts and receive JSON file metadata. Errors are JSON on stderr. Exit codes: 0 success, 1 invalid input/API rejection/conflict, 2 authentication/authorization, 3 network or invalid server response, 4 local runtime/file error.

Run `dsa --help` to discover command families and `dsa <command> --help` for their options. [Command registration](src/dsa.ts) and [design-system/discovery commands](src/design-system-commands.ts) own the current inventory.

Use `design-systems schema` to inspect reusable library definitions before creating or updating them. Library updates use the observed `--system-version`; apply/insert use the target project's observed `--revision` and optionally a pinned library version. Read and reconcile either conflict before retrying. Use `fonts --query` and `providers models PROVIDER --query` for discovery; live/cache/fallback provenance is not proof of model access or successful generation.

`brief get/put/interview/approve` manages saved interactive questions, answers, and design scope. A first `brief put PROJECT_ID --revision 0 --file brief.json` requires a `request`; subsequent writes use the brief revision from `brief get`, independently of the document revision. Agents may supply their own `interview` questions and scope without a server provider key, or use `brief interview --provider NAME --revision N` with BYOK. Every change invalidates approval. `brief approve` requires explicit human approval of the current scope and complete required answers. An unapproved brief blocks provider design generation.

`projects check PROJECT_ID` returns deterministic preflight findings with page/node IDs and suggestions for text fitting, estimated contrast, missing media, bounds and export limitations. It reads the saved revision, makes no changes, and does not certify accessibility or visual quality.

Use `projects inspect PROJECT_ID --output pages.png` for a saved-project contact sheet, or add `--mode page --page 0 --revision N` for a revision-bound page PNG. `projects overview --output-dir review` renders your projects' first-page covers. Both print revision, page identity, image bounds, pagination, and local file paths as JSON without raw base64. Follow `nextOffset` using `--offset` until it is null. Workspace files are named `workspace-OFFSET-IMAGE_INDEX.png`; repeating that output replaces the file. No images are written on an API error; an empty workspace writes no files.

Read each command's `--help` for limits and selection options. Open the resulting PNGs with an image viewer before claiming visual review. Images reflect saved content, require the configured browser renderer, and do not publish or invoke a provider. Save and verify browser changes first. The [visual inspection guide](../../docs/agents.md#visual-inspection) explains equivalent REST, MCP and WebMCP calls and frame/coverage limitations.

Use `dsa observability summary`, `dsa observability events`, or `dsa observability trace TRACE_ID` for activity and provider usage. Read `dsa observability --help` and each subcommand's help for filters; use the returned `nextCursor` with `events --cursor` for pagination. The default scope is the authenticated owner. `--scope all` requires an explicitly configured operator using a session/API key on the server; OAuth cannot obtain global access, and `--actor-id` requires operator scope.

Usage `null` means unavailable, not zero. Measured-call counts and coverage describe partial data; `running` and `interrupted` do not prove provider completion. Recent activity is not online presence. See [activity, usage, and traces](../../docs/agents.md#activity-usage-and-traces) for interpretation and [the shared contract](../../src/shared/observability.ts) for result fields. Observing a trace never authorizes retrying a paid or mutating operation.

`preview PROJECT_ID` and `share PROJECT_ID` create a public immutable snapshot and return its URL. `unpreview` and `unshare` remove all public snapshots for the project. These commands are aliases for the same publication storage and ownership checks as `publish`/`unpublish`; they do not expose unsaved private editor state.

`projects export` requests actual files from the authenticated server; its help owns the format list. React ZIP supplies a runnable frontend prototype without a business backend. GLB/glTF supply supported scene geometry and animation. Binary formats require `--output FILE` (or `--out FILE`). PNG/PDF/PPTX, video and 3D exports need a configured cloud/self-host browser renderer; JSON/HTML/SVG and React ZIP do not. Unsupported encoders and missing bindings return explicit errors. `--revision` binds export to the inspected revision. Video recording is capped at 60 seconds; cloud rendering mixes imported audio/video. PowerPoint preserves editable text/primitives and rasterizes complex nodes.

`render --file design.json --format svg` performs offline static rendering with optional `--page` and `--time`, preserves references, and does not fetch private media. Offline 3D representations are static; server HTML can include the trusted interactive 3D/timeline viewer, and binary outputs render real WebGL. Remote media must be imported before cloud binary export. JSON imports preserve the editable format; arbitrary HTML/SVG import belongs to the browser parser. Google Slides requires real authorization and supported text/shapes/HTTPS images; complex unsupported nodes fail explicitly.

`media generate PROJECT_ID` supports OpenAI image generation/editing and speech, plus fal image, video, music/effects, and source-media transformation. Pass `--source-asset ID` to use media owned by this project. `--duration SECONDS` applies to supported video/music modes; `--strength NUMBER` applies to fal image/audio source transformations. Source type selects a compatible default model; unsupported combinations fail explicitly. For example:

```sh
dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt
dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt
dsa media status PROJECT_ID JOB_ID
```

All fal modes return queued jobs. Poll to a completed asset before reporting success; then explicitly add that asset to the document and save. No provider success is simulated when credentials or model access are missing.

`generate` returns a proposal and does not save it. Inspect it, then use `projects document put` with the original revision. On a conflict, read the newest project and reconcile edits. Never increment the revision blindly. `projects clone` copies owned asset bytes so deleting its source does not remove the clone's media.

For concurrent editing, retain the exact document and revision you read. `projects document changes` observes saved updates; `projects document merge` accepts your edited document with that original base. Resolve reported overlapping changes explicitly; never change the base or invent its revision to force a write. See the [revision workflow](../../docs/agents.md#revision-workflow).

`api METHOD /api/path --file request.json` provides an explicit REST escape hatch constrained to the configured server. It neither bypasses server auth nor evaluates local code. Requests reject redirects to keep tokens bound to the configured origin.

## Community designs

`dsa community schema` discovers the current source build's shared commands and inputs. Search with `dsa community search --q TEXT --kind web --sort newest`; download an available artifact with `dsa community download LISTING_ID VERSION FILE_ID --out design.zip`. Import that portable archive using `dsa community import --file design.zip --operation-id UNIQUE_ID`, then poll `dsa community job UNIQUE_ID`. Imports and remixes own independent media.

Publishing requires preflight, the exact reviewed digest and project revision, a stable operation ID, and explicit CC BY 4.0/public consent. Pass canonical JSON using `--file request.json`; retry an uncertain operation with the identical payload and ID. Existing project share/publish commands retain their original behavior. See the [Community guide](../../docs/community.md) for privacy, licenses, profiles and operator authorization. Community commands require the current source build until included in a tagged CLI release.

## Creative documents

The bundled schema reads v1/v2 and exposes board transforms, paste, semantic diagrams and painting layer/group operations through `schema --operations`. Preserve v2 roots when applying edits. `projects paint PROJECT_ID --file command.json` executes a real server-side stroke/fill using the live `paintingCommand` schema; include the observed revision, painting generation and a unique operation ID. An uncertain write can be retried with the identical command and ID. Direct painting replacement still requires owned PNG tiles and verified source hashes. Offline creative HTML/SVG requires locally embedded media; use authenticated `projects export` for owned assets. Static GIF export uses the saved poster; timed browser exports sample actual frames. See [creative tools](../../docs/creative-tools.md) for persistence, SVG flattening, public projections and acceptance limits.

Native diagram appearance uses `diagram-style` with a partial `style`, optional `elementIds`, `setDefault` and `savePreset`. An empty selection changes no existing objects; omitting it targets semantic nodes and connectors. `diagram-update` edits labels and text sizing; `diagram-edge` edits bindings-independent routing, bends, label position and color. Preserve user overrides and use the shared live schema for exact fields. Bundled Vietnamese fonts and SVG geometry are shared with the editor.

## Native character motion

`dsa motion PROJECT_ID --node NODE_ID --time 1` inspects an instance; omit the node to list reusable rigs/clips/skins. Use live `schema --operations` for named character, channel, key and bake edits. Character documents use schema v2; saving v1 over v2 is rejected.

`generate --mode motion` returns a bounded operation proposal and base document/brief revisions. Review it before applying with `projects document put --revision N --brief-revision B`. Native `motion` export is a ZIP; `png-sequence` and `spritesheet` use `--start`, `--end`, `--fps`, with an exclusive end boundary. These are Studio formats, not Spine/game-engine interchange. See [motion guide](https://studio.agentkit.best/docs/motion) for import, constraints and current export limits.

## 3D characters

`dsa scene schema` discovers commands. `dsa scene inspect PROJECT --page PAGE --time 0.5` reads diagnostics. `dsa scene command PROJECT --page PAGE --revision N --file command.json` previews; add `--apply` to save through the server revision guard. See the repository [3D guide](../../docs/3d-characters.md).

### Durable 3D workflow

`dsa scene schema` discovers authoring commands (shared rigs, clip edits, contacts, brushes, checkpoints, loop cuts and material layers). `dsa scene scan PROJECT --page PAGE --samples 25` returns complete-animation repair locations and contact errors. `projects export --format scene-angles --start 0.5 --output views.zip` captures four views.

Use `dsa operations start PROJECT --file job.json`, `operations status PROJECT ID`, and `operations result PROJECT ID --out result.glb` for durable saves/exports. Job JSON contains `kind`, a stable `operationId`, and `input` with normal save/export fields and `expectedRevision`. Reuse the identical ID/payload after a timeout. Download only after `succeeded`; a save result is its committed project receipt. Artifacts stay private and are retained until project deletion.
