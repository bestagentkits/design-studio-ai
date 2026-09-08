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

Install the generated tarball with `npm install -g ./packages/cli/bestagentkits-design-studio-ai-0.2.2.tgz`, or install the published release directly:

```sh
npm install -g https://github.com/bestagentkits/design-studio-ai/releases/download/v0.2.0/bestagentkits-design-studio-ai-0.2.0.tgz
```

The [v0.2.0 GitHub release](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.2.0) includes CLI and skill archives. The package is not published to the npm registry.

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

Run `dsa <command> --help` for every option. Available families are `health`, `config`, `schema`, `catalog`, `themes`, `templates`, `blocks`, `projects`, `brief`, `render`, `assets`, `generate`, `providers`, `tokens`, `publish`, `unpublish`, `preview`, `unpreview`, `share`, `unshare`, `media`, `google-slides`, and `api`.

`brief get/put/interview/approve` manages saved interactive questions, answers, and design scope. A first `brief put PROJECT_ID --revision 0 --file brief.json` requires a `request`; subsequent writes use the brief revision from `brief get`, independently of the document revision. Agents may supply their own `interview` questions and scope without a server provider key, or use `brief interview --provider NAME --revision N` with BYOK. Every change invalidates approval. `brief approve` requires explicit human approval of the current scope and complete required answers. An unapproved brief blocks provider design generation.

`projects check PROJECT_ID` returns deterministic preflight findings with page/node IDs and suggestions for text fitting, estimated contrast, missing media, bounds and export limitations. It reads the saved revision, makes no changes, and does not certify accessibility or visual quality.

`preview PROJECT_ID` and `share PROJECT_ID` create a public immutable snapshot and return its URL. `unpreview` and `unshare` remove all public snapshots for the project. These commands are aliases for the same publication storage and ownership checks as `publish`/`unpublish`; they do not expose unsaved private editor state.

`projects export` requests actual JSON, HTML, SVG, PNG, PDF, PPTX, WebM, or MP4 bytes from the authenticated server. Binary formats require `--output FILE` (or `--out FILE`) and a configured cloud/self-host browser renderer. Unsupported encoders and missing bindings return explicit errors. `--revision` binds export to the inspected revision. Motion is capped at 60 seconds; cloud rendering mixes imported audio/video. PowerPoint preserves editable text/primitives and rasterizes complex nodes.

`render --file design.json --format svg` performs offline static rendering with optional `--page` and `--time`, preserves references, and does not fetch private media. Offline 3D representations are static; server HTML can include the trusted interactive 3D/timeline viewer, and binary outputs render real WebGL. Remote media must be imported before cloud binary export. JSON imports preserve the editable format; arbitrary HTML/SVG import belongs to the browser parser. Google Slides requires real authorization and supported text/shapes/HTTPS images; complex unsupported nodes fail explicitly.

`media generate PROJECT_ID` supports OpenAI image generation/editing and speech, plus fal image, video, music/effects, and source-media transformation. Pass `--source-asset ID` to use media owned by this project. `--duration SECONDS` applies to supported video/music modes; `--strength NUMBER` applies to fal image/audio source transformations. Source type selects a compatible default model; unsupported combinations fail explicitly. For example:

```sh
dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt
dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt
dsa media status PROJECT_ID JOB_ID
```

All fal modes return queued jobs. Poll to a completed asset before reporting success; then explicitly add that asset to the document and save. No provider success is simulated when credentials or model access are missing.

`generate` returns a proposal and does not save it. Inspect it, then use `projects document put` with the original revision. On a conflict, read the newest project and reconcile edits. Never increment the revision blindly. `projects clone` copies owned asset bytes so deleting its source does not remove the clone's media.

`api METHOD /api/path --file request.json` provides an explicit REST escape hatch constrained to the configured server. It neither bypasses server auth nor evaluates local code. Requests reject redirects to keep tokens bound to the configured origin.
