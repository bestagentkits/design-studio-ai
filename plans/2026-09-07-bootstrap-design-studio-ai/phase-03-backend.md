# Persistence, security, providers, and MCP

Status: In progress. Owner: backend agent. Estimate: 14h.

Read [architecture](../../docs/architecture.md) and shared schema as soon as available. May create/modify `D:/www/oss/design-studio/server/**`, `D:/www/oss/design-studio/migrations/**`, and `D:/www/oss/design-studio/tests/server*`. Controller owns shared code, CLI, and infrastructure configuration.

1. Implement portable persistence contracts with D1/R2 bindings and SQLite/files for Node. Create migrations for users/sessions/projects/assets/providers/tokens/OAuth/publications.
2. Implement auth, rate controls, cookie Origin checks, per-owner resource scoping, encrypted BYOK keys, and hashed/revocable credentials.
3. Implement the exact project/API route contract, SQL atomic revision saves, authenticated uploads, and immutable public snapshots with snapshot-scoped assets.
4. Integrate real providers by modality with timeouts, bounded responses, fixed or operator-allowlisted HTTPS origins, safe redirects, and useful errors. Generated proposals do not overwrite current documents.
5. Implement MCP using the same services. Implement discovery, API-key auth, OAuth consent with PKCE, one-use codes, exact redirects, resource audience validation, and truthful protocol negotiation.

Acceptance starts with two-user resource isolation and revision CAS tests. Also test expired/revoked credentials, cross-origin writes, wrong OAuth verifier/redirect/audience and replay, provider error redaction, malicious uploads, and publication isolation. Broaden to adapter integration and MCP initialize/tools list/call with a real client. Test modern metadata validation only when advertising the modern protocol.

Risks: read-check-write races, OAuth replay, token disclosure, unsafe proxy fetches, and publication exposing private edits. Address with atomic conditional operations, hashed credentials, exact trust boundaries, safe renderers, and immutable snapshots. Rollback preserves tables/data and uses backward-compatible migrations; never drop user data to recover an application release.

## Reconciled progress — 2026-09-07

- [x] D1/R2 and SQLite/files adapters, atomic revisions, hashed credentials, encrypted provider keys, and publication snapshots implemented.
- [x] Real server/CLI regressions cover ownership, CAS, OAuth, token revocation, source-independent clones, and snapshot isolation.
- [x] Typed OpenAI/fal media generation/editing/music/effects requests, owned-source checks, and reusable completed jobs implemented; six capability tests passed.
- [x] Production smoke verified authenticated D1 persistence, stale revisions, MCP, publication, and browser PNG/PDF/PPTX exports.
- [ ] Re-run final checks/migrations after persisted conversation integration.
- [ ] Exercise provider and Google success with separately supplied live credentials; none were available for initial implementation.

MCP advertises implemented 2025 SDK transport compatibility, not the unimplemented 2026 transport. Native Google Slides limits and upstream dependency findings remain explicit in [architecture](../../docs/architecture.md) and [deployment](../../docs/deployment.md). External-credential checks cannot be replaced with fabricated provider outputs.
