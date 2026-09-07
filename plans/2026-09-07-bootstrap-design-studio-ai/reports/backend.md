# Backend implementation report

Date: 2026-09-07
Status: DONE_WITH_CONCERNS

## Delivered

- Shared Hono handler with Cloudflare D1/R2 bindings (`DB`, `ASSETS_BUCKET`) and Node SQLite/filesystem adapters. Local migrations execute once, transactionally; SQLite uses foreign keys and WAL.
- Registration, login, hashed opaque sessions, logout, persistent IP throttling, owner checks, cookie CSRF checks, controlled local development origins, revocable hashed API keys, and structured API errors.
- Project search/filter/sort, creation, metadata update, deletion, document validation and SQL compare-and-swap revisions. Uploaded media has size, MIME, and signature checks. Private assets require ownership; publishing creates a frozen document and snapshot-specific asset authorization. Unpublish removes all snapshots.
- AES-GCM encrypted provider keys, masked configuration reads, explicit HTTPS provider origin allowlists, redirect rejection, request timeouts and response byte limits. Text providers: OpenAI-compatible/OpenRouter, Anthropic, Gemini. Image/audio: OpenAI. Video: fal queue submission and status/result retrieval with persistent result caching.
- OAuth authorization-server and protected-resource discovery, public client registration, exact redirect matching, browser consent, S256 PKCE, five-minute single-use codes, resource audience checks, one-hour access tokens, rotating refresh tokens, and family revocation. OAuth protocol errors use standard `error` / `error_description`; `/api` errors use the shared nested contract.
- Official MCP SDK web-standard stateless Streamable HTTP transport. Tools cover project CRUD, document mutation, themes, templates, components, assets, generation, export and publishing. Resources expose schema and private project documents. Protocol verified with `2025-11-25`; no claim of `2026-07-28` support.
- Google Slides native content export creates real presentations with text, shapes and publicly reachable HTTPS images. Browser access tokens are used in-memory for the request and never persisted.

## Verification

`npx tsx --test tests/server.test.ts`: **9 tests passed**, using actual on-disk SQLite and filesystem binary storage, no mocked persistence or SDK transport. Tests exercise cookie security, bad credentials, CSRF, two-owner isolation, concurrent CAS saves, invalid URLs, private assets, snapshot immutability/unpublish, failed generation preserving content, persisted second database connection, path traversal rejection, credential encryption, token revocation, MCP initialization/tools/call, and OAuth consent/redirect/PKCE/audience/code replay/refresh rotation/revocation.

Backend TypeScript passed during integration checks. At handoff, project-wide typecheck still reported files under the independently active frontend work; those are owned by the frontend/controller. Controller is integrating cloud/browser exports into the handler after this handoff and owns its verification.

## Integration details and remaining concerns

- Apply both `0001-initial.sql` and `0002-media-result.sql` on D1. Node tracks migration filenames in `studio_migrations`.
- `APP_URL` is the canonical OAuth/publishing origin; production target changed to `https://studio.agentkit.best`. Node accepts optional `TRUSTED_ORIGINS`; nonproduction defaults include localhost/127.0.0.1 port 5173 for Vite proxy usage. Production defaults to no extra origins.
- Supply a stable base64 32-byte `ENCRYPTION_KEY`; loss prevents decrypting BYOK credentials. Cloud registration requires `ALLOW_REGISTRATION=true`. Password minimum is 12 characters. PBKDF2 uses the recorded Workers-compatible 100,000 iteration work factor; operators should review this constraint against their password policy.
- Provider and Google integrations have real HTTP implementations and actionable failure paths, but **live generation/Google export was not verified without user provider/Google credentials**. Default model names are configurable and provider availability changes.
- Native Google Slides export explicitly rejects chart/3D/video/audio/icon nodes and private image URLs rather than silently omitting them. Those must first become images accessible to Google; the controller's separate cloud export work can provide rasterization paths. `GOOGLE_CLIENT_ID` enables the browser consent flow.
- Frozen publications retain their serialized document and immutable uploaded asset references. External HTTPS image URLs still depend on their third-party hosts; their remote bytes are not copied automatically.
- The controller now owns export integration edits to `index.ts`, `node.ts`, `types.ts`, and `mcp.ts`. Before declaring all formats available to agents, verify those new routes and tools against actual binary artifacts.

## Official references checked

- [MCP TypeScript SDK server documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) and installed `@modelcontextprotocol/sdk` web-standard transport declarations.
- [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
- [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue).
- [Google Slides writing requests](https://developers.google.com/workspace/slides/api/samples/writing) and [batch requests](https://developers.google.com/workspace/slides/api/guides/batch).

Unresolved questions: no implementation-blocking questions. Live provider credentials and Google OAuth consent configuration remain external verification requirements.
