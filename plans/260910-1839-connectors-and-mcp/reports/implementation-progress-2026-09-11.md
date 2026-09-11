# Connector implementation progress — 2026-09-11

Status: implementation and acceptance in progress. This report supersedes earlier foundation-only checkpoints. Code extends baseline `f114988` through `e1c57dd`; verified CI and disabled beta deployment are recorded in [release readiness](release-readiness.md). Full scope remains nine phases; external acceptance is not waived.

## Implemented

- Encrypted operation results and durable human continuations, exactly one dispatch claim, explicit uncertainty, cancellation and retention. Forward-only migrations 0014–0017 add results, continuations, staged export artifacts and signed webhook receipts.
- OpenAI-compatible, Anthropic and Gemini native tool messages. Durable request-driven runs pin principal, grants, document/brief revisions, provider and sources. Proposals remain unsaved and are revalidated before application.
- Settings connection setup/reconnect/revoke; project tools/sources; explicit API-key, OAuth-family and WebMCP grants; source provenance; run activity; exact approval and recovery. Binding edits use revision CAS, revoke old grants, stop dependent work and retain disconnected snapshots. OAuth return preserves an optional project pointer without granting access.
- Remote MCP OAuth/bearer/anonymous setup, bounded discovery, short-lived partitioned discovery cache, fresh schema checks before dispatch, resource snapshots and separately approved input-required continuations.
- Independent GitHub App authorization verifies user/installation/app and selected repository intersection. Installation tokens are repository-scoped. Source reads verify commit/tree/blob hashes and reject secret paths, symlinks, submodules and unsupported binary content.
- GitHub export renders actual React ZIP bytes, stages immutable review files and path/hash differences, checks the pinned base, writes blobs/tree/commit/new branch/PR, records partial remote IDs and supports read-only reconciliation. It never merges, force-pushes, updates workflows or deletes unrelated files. Signed webhook delivery receipts revoke affected access and safely recognize duplicates.
- Independent Google OAuth lifecycle with refresh CAS and session-only Picker bridge. Selected-file ingestion supports bounded text/PDF and raster images. Source images import through the existing project asset signature validator and atomic authorization guard.
- Drive PDF/PPTX actions stage actual renderer output, reserve remote IDs, upload the reviewed bytes once and reconcile unknown responses by reading remote identity, metadata and exact byte hashes. Native Slides uses the shared converter and records created IDs before subsequent calls; partial presentations require inspection and are not recreated blindly.
- REST, CLI, network MCP, WebMCP, public references, owning docs and the existing design skill share connector contracts. Agent interfaces cannot approve actions or manage credentials.

## Current verification

- `npm run typecheck`, `npm run build:cli`, `npm test`, `npm run build`, `npm run pack:skill`: passed; full unit/integration suite **367/367**. Later browser-form fixes received another typecheck/build and browser verification.
- Local workerd + D1 applied migrations 0001–0017, preserved an existing project revision, passed refresh/disconnect/lease races and reported no foreign-key violations.
- Local workerd extracted an actual Chromium-generated PDF (18,251 bytes) and verified GitHub RSA signing. Combined observed wall time 376 ms; CPU budget was not measured. Probe closes browser and runtime in finally blocks.
- Current Workers dry-run passed. Public MCP discovery/search also passed actual Cloudflare remote preview through the application transport. Native account workflows and PDF CPU remain separate.
- Real public endpoint `https://docs.mcp.cloudflare.com/mcp`: application Node DNS-pinned transport negotiated `2026-07-28`, discovered two tools and successfully called `search_cloudflare_documentation`. No credentials or private content were sent.
- Opt-in browser acceptance uses that actual endpoint and real isolated application persistence. Covers capability selection, multiline binding edits, refresh-surviving pending action, human approval and successful dispatch; final browser matrix is recorded in verification.md.
- Prior DNS/Cloudflare, OAuth profile and persistence probes remain linked from runtime-probes.md. They are distinct from real native-provider account acceptance.

## Review findings resolved

- Central source authorization applies the intersected native selection, including agent-narrowed Drive IDs and GitHub paths.
- Project asset insertion rechecks authorization atomically after bucket upload; revocation cannot attach an unauthorized asset.
- Picker account generation prevents stale account callbacks. Its button explicitly avoids form submission.
- Multiline selection inputs retain raw text until save rather than stripping a newly entered newline.
- GitHub content SHA is verified against the pinned tree; installation access is rechecked before repository requests. Policy changes after token mint prevent contents reads.
- Export approval requires staged immutable bytes. Remote identities are persisted after trusted responses even if cancellation races; later writes still require a live lease and authority.
- Unknown operations cannot be dispatched again. Reconciliation checks actual remote evidence and never creates another artifact.

## Remaining acceptance and release boundaries

- Beta secret-name inspection returned only ENCRYPTION_KEY; GitHub App and Google connector registration/secrets are not configured. Test repository, Drive destination and paid model authorization have been requested; no answer received at this checkpoint. Never put their secrets in reports.
- Public MCP read success does not establish a real write, outgoing OAuth against an external authorization server, or a paid-model chat tool loop. GitHub source-to-PR, live Picker/multi-account, Drive PDF/PPTX and native Slides acceptance remain pending designated accounts.
- Current CI 34572237146 passed on e1c57dd and deployed isolated beta with connectors disabled. Earlier baseline CI 34557747033 is historical only.
- Connector feature flag stays disabled until required acceptance gates pass. Production/main release is not authorized by this beta request.
- GitHub exports have a bounded operation lease; timeout after partial writes is reported as unknown with recorded IDs, not silently retried. Native Slides partial creation has manual inspection guidance.
- Installation reported eight high dependency findings; no audit-clean claim. Worker PDF CPU envelope is not yet measured on the remote deployment.

## Primary references consulted

- [Cloudflare public MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview)
- [Drive generated IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- [Slides batch updates](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/batchUpdate)
- [unpdf source](https://github.com/unjs/unpdf)
