# Community

Community is the public design-sharing surface at `/community`. Free CC-BY-4.0 designs can be discovered by category, tags, format, period, creator and collection, downloaded as ready files, and remixed into independent private projects. Home `Cmd+K`/`Ctrl+K` searches owned projects; the same shortcut on Community searches live community metadata. URL filters support direct links and browser history.

## Publication and privacy

The [shared contracts](../src/shared/community.ts) and [operation inventory](../src/shared/community-endpoints.ts) own request fields and client discovery. Preflight reads an owned saved revision, projects the public design and returns a digest. The author reviews the projection and source disclosures, then explicitly confirms public publication and the license. The server recomputes the digest and checks project/listing revisions. Exact retries reuse the same operation ID and payload; changed payloads conflict.

[Projection](../src/shared/community-projection.ts) removes notes, hidden descendants, unrelated opaque data and unused media, retains required character dependencies, and flattens painting to its visible composite. External media must be imported before publication. Do not equate canonical document validation with public-source approval. Existing `/api/projects/:id/publish`, preview and share aliases keep their separate lifecycle and do not automatically list work in Community.

[Publication jobs](../server/community-publication.ts) pin immutable versions and copy assets before rendering a selected cover/download formats and the portable package. Only a guarded activation makes a version live. Later private edits do not change it. Owner unlisting, moderator suppression and source deletion remain separate state. Restore cannot override owner unlisting or deletion. An active source-copy lease makes source deletion return `409 publication_busy`; otherwise deletion claims against new work, revokes public serving and schedules cleanup. Completed private remixes survive.

## Files, jobs and storage

[Portable packages](../src/shared/community-package.ts) wrap the canonical document with checked asset bytes, hashes, license and attribution. Limits are 20 MiB compressed, 64 MiB expanded and 1,000 entries. The builder uses STORE; imports also support bounded streaming DEFLATE. Package-local asset URLs resolve exclusively through the manifest, without fetching source URLs. GLB media must contain its dependencies. Import validates paths, sizes, checksums and references before creating an independent project; archive attribution remains unverified.

[Workers](../server/community-worker.ts) use durable receipts, conditional leases and storage intents so retries can resume or clean up deterministically. [Storage admission](../server/community-assets.ts) counts private assets, Community files and outstanding reservations against one owner budget; private upload admission uses the same totals. Live download routes verify visibility before serving bytes and never start an anonymous renderer. Current/previous successful versions are retained; purged report content is unavailable rather than retained secretly.

## Discovery, recognition and moderation

[Search queries](../server/community-queries.ts) use a live-only FTS5 projection and bounded cursor pagination. Vietnamese normalization preserves display text while supporting accent-insensitive search. Changed ranking generations require a cursor reset. Most used/downloaded reflect unique eligible authenticated recipients; self-actions and repeats do not inflate them. Guest served-download aggregates are separate. Creator milestones count distinct recipients across listings, and private remix identity is not published.

Profiles opt in; bookmarks and impact management remain owner-scoped. Operators review version-pinned reports, record hide/restore/dismiss reasons, and curate reviewed listing versions. [Deployment](deployment.md#community-rollout) owns feature and admin configuration. ID grants and verified GitHub email pregrants are separate from observability administration; ordinary password registration does not prove an email grant. Moderation excludes OAuth credentials.

## People and agents

The public [Community guide](../src/app/community-documentation.tsx) is generated at `/docs/community`. REST, MCP `community_*`, WebMCP `studio_community_*`, and CLI `dsa community` share the operation inventory and validators. Use `community_capabilities`, `studio_community_capabilities`, `dsa community schema`, or `/api/schema` before composing writes. MCP byte results and MCP/WebMCP base64 imports cap at 12 MiB; larger files use CLI or the browser file picker. Download tools return actual bytes, while preview tools identify sandboxed preview resources.

Release evidence and remaining verification work belong in the [implementation plan](../plans/2026-09-12-community-design-sharing/plan.md), not this behavior guide.
