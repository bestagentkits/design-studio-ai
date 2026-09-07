# Agent access and CLI

Design Studio AI exposes one shared document contract through REST, network MCP, browser WebMCP, and `dsa`. The CLI package is maintained under [packages/cli](../packages/cli/README.md). Its executable bundles the shared validators, theme/template/block catalog, targeted operations, and safe static renderers. It does not require a running local project checkout after installation.

## Install and connect

Install the [released CLI tarball](https://github.com/bestagentkits/design-studio-ai/releases/download/v0.2.0/bestagentkits-design-studio-ai-0.2.0.tgz) with `npm install -g https://github.com/bestagentkits/design-studio-ai/releases/download/v0.2.0/bestagentkits-design-studio-ai-0.2.0.tgz`. The package is not published to the npm registry.

To build from source, install dependencies with `npm ci` and `npm ci --prefix packages/cli`, then run `npm run build --prefix packages/cli`. From `packages/cli`, run `npm pack`; install the resulting tarball with `npm install -g <path-to-tarball>`. The build also generates `dist/document.schema.json` and `dist/operations.schema.json`.

Set `DESIGN_STUDIO_URL=https://studio.agentkit.best` and inject `DESIGN_STUDIO_API_KEY` from workspace Settings. `dsa` does not save a configuration file, keychain record, or login session. `--url` and `--api-key` override these values for one invocation; use environment injection to avoid shell history. HTTP is accepted for localhost development only.

Install the [companion skill](../skills/design-studio-ai/SKILL.md) by copying its directory into the installed skills directory of your agent runtime. The repository layout is also suitable for a skill installer that accepts a repository and skill path. The skill guides brief capture, catalog discovery, targeted edits, visual quality checks, and authorized exports/publishing.

## CLI command surface

| Commands | Behavior |
| --- | --- |
| `health`, `config` | Public health and configuration; no credential persistence |
| `schema [--operations]` | JSON Schema from the shared validators; semantic checks still run on writes |
| `catalog`, `themes list/get`, `templates list/get/instantiate`, `blocks list/get` | Bundled design resources; instantiated IDs are unique |
| `projects list/get/create/rename/delete/clone` | Persisted project management; clone copies owned asset bytes |
| `projects document get/put/patch` | Canonical document reads and atomic expected-revision writes |
| `brief get/put/interview/approve` | Persisted interactive questions, answers, scope and explicit version-bound approval |
| `projects check` | Read-only preflight hints with exact layer IDs; inspect the actual preview too |
| `projects import/export`, `render` | Canonical JSON import; authenticated cloud export; offline JSON/HTML/SVG rendering |
| `assets list/upload/download` | Authenticated asset storage; node placement is a separate document edit |
| `generate` | Real provider document proposal; no implicit save |
| `providers list/set/remove` | Masked configuration; provider secret from environment/stdin |
| `tokens list/create/revoke` | Token metadata and lifecycle; new token returned once |
| `publish`, `unpublish` | Public immutable snapshot creation and removal |
| `media generate/status` | OpenAI image/edit/speech; fal image, video/edit, music/effects, and source-audio jobs |
| `google-slides` | Server export using a short-lived Google OAuth token |
| `api METHOD /api/path` | Same-origin REST escape hatch; JSON input from file/stdin |

All option details are available through command `--help`. Document and operation files accept `--file -` for stdin. The default output is JSON; document/export/template content is raw when sent to stdout. `--output` writes the artifact and returns JSON metadata. Errors are JSON on stderr. Exit codes are 0 success, 1 input/API/conflict, 2 auth, 3 network/invalid response, and 4 local runtime/file errors.

## Revision workflow

Start prompt-driven projects with a saved brief. `update_design_brief` (CLI `brief put`) accepts a request and agent-authored contextual questions/scope; it needs no BYOK key when the agent uses its own model. `interview_design_brief` optionally uses a configured provider. Show questions in the host conversation or Studio, save answers, review the scope, and call `approve_design_brief` only after the human approves that version. Brief revisions and document revisions are independent. Any brief edit invalidates approval. Provider generation requires approval when a brief exists. Manual editing remains available.

Run `inspect_design` (CLI `projects check`) after saving: findings point to specific nodes and suggest corrections for fitting, bounds, media and contrast. These deterministic hints supplement visual inspection; overlapping backgrounds, font metrics, rotation and animated extremes require preview.

1. Read `projects get PROJECT_ID` and record `project.revision` with the document.
2. Inspect `schema --operations`, page/node IDs, and the relevant catalog entry.
3. Apply a short operation array with `projects document patch PROJECT_ID --revision N --file edits.json`.
4. If a conflict occurs, read the current project and reconcile the requested change. Do not blindly retry with a higher revision.
5. Inspect output at the intended viewport, then export or publish within the user's requested scope.

`generate` follows the same rule: its response is a proposal that can be read by document PUT, and the original revision is required to save it. CLI renames also use revision-checked document writes. Clone is a distinct new project and copies referenced owned assets so source deletion does not break the clone.

## Capability boundaries

The CLI's `projects export` requests real file bytes for JSON, HTML, SVG, PNG, PDF, PPTX, WebM, and MP4 from `/api/projects/:id/export`. Binary formats require `--output` (or `--out`) and a configured Cloudflare/self-host browser renderer; missing configuration and unavailable encoders return errors. Optional `--revision` ensures the server exports the inspected revision, and `--page` selects a zero-based page where supported. Cloud rendering embeds owned assets; remote media must be imported first. Motion exports are capped at 60 seconds and MP4 requires encoder support. PowerPoint preserves editable text/primitives and rasterizes complex nodes.

Offline `render` supports JSON/HTML/SVG and preserves asset references without fetching private media. Its 3D representation is static; server HTML export can include the trusted interactive 3D/timeline viewer, while cloud raster export uses real WebGL rendering. Google Slides requires real authorization and supports native text/shapes/HTTPS images, rejecting unsupported complex nodes and private image URLs.

Media generation accepts `--source-asset ID`, `--duration SECONDS`, and `--strength NUMBER` for the modes described in [providers](providers.md). For example, `dsa media generate PROJECT_ID --kind image --provider openai --source-asset ASSET_ID --prompt-file edit.txt` edits an owned source image. `dsa media generate PROJECT_ID --kind audio --provider fal --duration 30 --prompt-file music.txt` queues music/effects generation. Poll a returned job with `dsa media status PROJECT_ID JOB_ID`; placing the resulting asset in the document remains a separate revision-safe edit. Provider secrets should come from `--key-env` or `--key-stdin`, and Google access tokens use the same secret-input pattern.

Network MCP lives at `/mcp` with the server's advertised protocol versions, API-token or OAuth authentication, and the same ownership/revision protections. Clients should discover actual schemas and tools rather than guess names. WebMCP registers through the available browser model-context API and uses the current authenticated user. Unsupported browsers continue to use the ordinary application and network MCP.

## Implementation decisions and verification

The CLI is the scoped agentization deliverable in [release phase](../plans/2026-09-07-bootstrap-design-studio-ai/phase-04-integration-release.md). Curated command families cover common workflows; the explicit API escape hatch covers new REST endpoints. Structured operation arrays provide bounded batch edits without arbitrary code execution. Tokens remain stateless, requests reject redirects, and error output redacts the application token.

CLI tests live in [tests/cli.test.ts](../tests/cli.test.ts); run `node --import tsx --test tests/cli.test.ts`. They build and execute the distributable in real subprocesses, inspect schema/template output, and exercise authenticated project editing against the SQLite-backed handler. Renderer/server tests cover actual binary export. External provider and Google success require separate credential-dependent checks. Release evidence belongs in the [finalization report](../plans/2026-09-07-bootstrap-design-studio-ai/reports/finalization.md).

The [v0.2.0 release](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.2.0) provides the CLI tarball and agent-skill ZIP. GitHub release distribution is separate from npm registry publication.
