# Proposed connector architecture

Status: implementation design, not current product behavior. See [plan](plan.md) and [source evidence](reports/research-and-source-evidence.md).

## One service, two adapter families

Web/REST/CLI/Studio MCP/WebMCP call first-party connector routes and services. A provider-neutral registry describes capabilities; native GitHub/Google adapters and a remote MCP client implement them. AI providers call this service through an internal tool executor. Incoming Studio MCP and outgoing third-party MCP remain separate security principals and transports.

Reuse Hono, Zod, D1/SQLite, R2/FileBucket, encrypted credentials and request spans. Do not add a second design-document format, a generic workflow engine, or a background queue without a proven requirement.

## Data model

All new records use owner-scoped queries and bound SQL. Allocate the next free migration number at implementation time; `0008-observability.sql` is currently last. Add migrations; never rewrite applied files.

| Proposed entity | Essential fields and invariant |
| --- | --- |
| connections | id, user_id, adapter, display_name, stable remote identity/installation, endpoint, auth mode, lifecycle status, revision, granted scopes, capability fingerprint; multiple accounts per provider allowed |
| connection_credentials | connection_id, encrypted payload, expiry, credential_version, refresh lease; tokens never serialized by metadata APIs |
| connection_auth_states | hashed single-use state, session binding, PKCE verifier encrypted, expected issuer/resource, callback, bounded return intent, expiry |
| project_connection_bindings | project_id, connection_id, owner, role, selected remote IDs/path/ref constraints, policy_revision; owner and connection must match |
| connection_agent_grants | connection/project + principal type/id + capabilities + parameter/resource limits + policy revision; created/revoked by human management flow |
| project_source_snapshots | binding, immutable source identity/version/hash, private content-object key, MIME, extraction version, fetched_at and size; sources are separate from document and brief |
| connector_operations | owner/project/principal, idempotency key, action/schema fingerprint, canonical arguments hash, source/design/brief versions, status, remote result IDs, execution lease and timestamps |
| connector_approvals | operation, approving user, expiry, one-use consumption; approval binds exact arguments, destination, policy and relevant revisions |
| agent_runs / run_steps | project, principal, provider/model, run revision, source IDs, bounded encrypted transcript/tool payloads, budgets, leased step, resulting proposal and operation references |

Reuse project conversation storage for user-visible summaries only when its ownership and size limits fit. Sensitive run state is private operational content, not telemetry. Keep response metadata bounded; binary content goes through validated private asset ingestion. Do not implement all entities as generic unvalidated JSON tables.

## Permission matrix

| Caller | Connection metadata/discovery | Execute tool/import/export | Manage secrets, grants or approve |
| --- | --- | --- | --- |
| Signed-in person using UI | Own connections | Own bound project; allowed read policy or exact approved operation | Own connection, session + CSRF + interactive management flow |
| API key used by CLI/external agent | Only explicitly granted connection/project | Explicit grant tied to api_tokens.id; writes require operation approval | Return human setup/approval link; no direct secret/grant/approval tool |
| Incoming Studio OAuth client | Explicit grant tied to owner + client_id + active token family | Same bounded grants; existing `studio` scope alone is insufficient | Human flow only; never mint grants from an OAuth call |
| Browser WebMCP | Only agent-safe subset for the current project | Same policy with a WebMCP/project grant; no approval bypass | Exclude management/consent routes from generated tools |
| Internal AI run | Only project-enabled catalog for that run | Recheck binding/credential/policy before every dispatch | Cannot approve its own tool call |

Expose authenticated principal information from `authenticate`; do not key permissions only by user_id or a caller-supplied header. Expired/revoked authentication must still fail even if a grant exists. OAuth family refresh preserves its grant; a new login family must not inherit automatically. Read scopes in the remote provider do not imply permission to send all project content to that provider.

Browser automation with full access to a user's browser is a broader trust boundary than WebMCP. Do not claim the WebMCP tool allowlist can prevent a fully controlling browser agent from clicking UI. Agent-facing contracts must never expose a self-approval endpoint or approval challenge.

## Credential and egress boundaries

- OAuth state is short-lived, single use and bound to browser/session, connection, expected issuer/resource and exact callback. Denial, stale state, changed account/session and malformed discovery fail safely. Refresh uses lease + CAS to prevent lost rotated tokens; disconnect increments revision and invalidates leases.
- GitHub sign-in, outgoing connector OAuth and incoming Studio OAuth have separate registrations/state namespaces and credential audiences. Preserve existing ENCRYPTION_KEY. New app settings are named placeholders in docs/config.
- Remote endpoints use HTTPS without userinfo, fragment or credentials in query strings. Validate tool endpoints, OAuth metadata/token/registration URLs, discovered resources and asset download URLs. Fetch with `redirect: 'manual'`; reject redirects before credential forwarding.
- URL string checks are insufficient against DNS rebinding. Phase 1 must prove connection-time public-address enforcement on Node and Cloudflare, including IPv4/IPv6 and mapped addresses. Native destinations remain provider-fixed. Do not ship arbitrary custom endpoints on an unproven transport.
- If Cloudflare needs an outbound gateway to enforce this, record a concrete deployment/ownership/cost decision before adopting it; do not silently restrict the promised custom-server feature to fixed origins or silently expand infrastructure. Other adapter work can continue independently.
- Google Picker is an intentional browser-token exception: only a short-lived access token required by Picker, in memory, from the appropriate narrow credential, with no refresh token or generic credential retrieval endpoint. Clear on close/disconnect; document actual scope. Never expose permanent/native/MCP credentials to chat, tools, exports or logs.

## Remote MCP contract

Target remote HTTP profiles `2026-07-28` and `2025-11-25`; freeze the verified support matrix during phase 1. Their lifecycle differs, so select tested SDK/protocol adapters rather than mixing handshakes. Existing inbound `/mcp` behavior remains compatible; any necessary SDK upgrade must preserve its old protocol tests.

Support anonymous, encrypted bearer token and OAuth connection modes. OAuth must handle supported discovery/registration strategies (CIMD, pre-registered client and legacy DCR as needed), issuer validation, resource audience, expiry/revocation and step-up consent. No automatic credential forwarding to resource links or unrelated issuers.

Discover tools with paginated bounded schemas; discover/read resources and templates where advertised. Namespace tools by connection ID, preserve original remote name, enforce local schema validation and safe JSON Schema reference handling. Cache per owner/credential/policy; changes in tool schema/description invalidate relevant trust and approval. Do not fetch remote `$ref` URLs.

Treat annotations, prompts, resource text, tool errors and links as untrusted data. Prompts are optional user-selected templates, never elevated system instructions. Unsupported MCP extensions/input requests return explicit capability errors; version-appropriate human input can pause/resume a run but cannot authorize Studio writes indirectly. No stdio commands, arbitrary server HTML or MCP Apps iframe execution in this plan.

## Execution and approval lifecycle

1. Request creates a private operation/run referencing current project, brief, sources and policy; unique owner/project/idempotency key reserves it atomically.
2. Validate selected tool, arguments, caller grants and allowed data destinations. Locally assessed permitted reads may run; unknown/custom or write actions require exact approval unless a narrow explicit grant already covers them.
3. Approval UI displays server/account/action/destination and payload or native diff. Bind approval to canonical arguments, tool fingerprint, policy revisions and relevant source/design versions. Never accept `approved: true` from agent arguments.
4. Atomic lease/CAS permits one dispatcher. Recheck authorization and revocation immediately before the external request. Completion CAS cannot revive a revoked connection or overwrite a newer result.
5. Persist outcome and actual remote IDs. An external write timeout/crash becomes `outcome_unknown`; do not retry unless adapter-specific reconciliation or idempotency proves safety. Internal idempotency alone cannot guarantee exactly-once remote effects.
6. Cancellation/revocation blocks further dispatch. It cannot undo a request already accepted remotely; surface that uncertainty. Retrieval GETs never advance work.

Suggested operation states: pending, awaiting_approval, running, succeeded, failed, cancelled, outcome_unknown. Run states additionally include ready_to_continue and needs_reauthorization. Stale approval or project/brief change returns a conflict requiring reread and a fresh proposal/approval, not a higher revision retry.

Use bounded request-driven run steps with persisted continuations: start/advance POST performs at most one bounded model/tool step and checkpoints; clients drive subsequent steps. GET only polls. Closing the client pauses at a checkpoint; reload resumes explicitly. Do not claim autonomous background execution or rely on an untracked Promise/Worker lifetime. Lease expiry after an interrupted write yields unknown outcome.

Initial tunable limits to validate in phase 1: 8 model turns, 12 tool calls, 30 seconds/tool, 300 seconds cumulative active run time, 1 MiB/tool response, 64 KiB/tool schema and 20 advertised tools/model request. Approval waiting time is separate. Native asset/export paths retain their own size bounds. Budgets halt honestly; users may start a new run. Report actual usage and unknown cost.

## Source semantics

Sources have explicit provenance (remote identity, version/hash, fetched time) and immutable private snapshots. Refresh produces a new snapshot; it never silently changes an approved brief or saved document. A run pins exact snapshots and records which content was sent to the selected model. Cross-connector forwarding requires an allowed destination/data-transfer decision.

MCP sources support bounded text/structured content and validated supported assets. Native GitHub supports selected UTF-8 text/Markdown/JSON and project-supported image assets at a commit SHA. Native Drive supports Google Docs text export, UTF-8 text/Markdown/JSON, text-based PDFs with a bounded compatible extractor, and supported image assets; unsupported/scanned/encrypted formats get explicit errors or manual upload guidance. Do not claim general Office import, OCR, editable Slides import or arbitrary repository execution.

Disconnect stops fetching and invalidates approvals; imported project copies remain visible as disconnected sources until the owner explicitly removes them. Source removal removes its snapshots/run-retained private content according to documented retention, without silently destroying separately imported design assets. Project/account deletion cascades new relational/object state. Clones copy chosen owned snapshots/assets but never credentials, bindings, grants, approvals or live execution authority.

## Proposed first-party routes

These are additions to implement, not existing endpoints. All use shared schemas and owner/project validation. Exact schema ownership moves to source during implementation.

| Route family | Purpose |
| --- | --- |
| `/api/connections` and `/:id` | Metadata, creation/configuration and disconnect; mutation privileges differ from read |
| `/api/connections/:id/authorize`, `/api/connectors/:adapter/callback` | Human OAuth/setup and callbacks |
| `/api/connections/:id/capabilities` | Explicitly permitted discovery/refresh |
| `/api/projects/:id/connections` | Project bindings and human grant management |
| `/api/projects/:id/sources`, `/sources/:sourceId/refresh` | Import/list/refresh/remove provenance snapshots |
| `/api/projects/:id/connector-operations` and `/:operationId` | Prepare/execute/read/cancel; exact state and idempotency checks |
| `/api/projects/:id/connector-operations/:operationId/decision` | Human approval/denial only |
| `/api/projects/:id/agent-runs`, `/:runId`, `/:runId/advance`, `/:runId/cancel` | Start, inspect, continue and cancel bounded runs |

Native GitHub/Drive resource pickers and exports use typed adapter actions under this service; do not provide arbitrary URL fetch or raw provider HTTP proxy endpoints. Keep `/generate` without connectors unchanged; connector-enabled runs use the new contract and return a normal validated design proposal. Keep existing Google Slides accessToken route compatible while adding a connection-backed operation.
