# MCP OAuth foundation review

Status: DONE. Canonicalization finding repaired and independently verified. Read-only implementation review; no production routes enabled by this review.

## Resolved: Equivalent endpoint spellings prevented credential refresh

`startMcpAuthorization` canonicalizes the connection endpoint with `publicUrl` before sealing the OAuth context. `createConnection` retains the supplied endpoint spelling. `refreshMcpAuthorization` compares `context.endpoint !== connection.endpoint` literally, rejecting otherwise identical URLs.

Reproduced using the real SDK and isolated OAuth contract peer:

1. Create OAuth connection with accepted endpoint `https://API.vendor.net:443/mcp/good`.
2. Start and complete PKCE authorization successfully; context records `https://api.vendor.net/mcp/good`.
3. Mark the authorized connection connected, as existing foundation tests do.
4. Refresh rejects `needs_reauthorization` / `OAuth credential context changed.` before remote token exchange; peer refresh count remains zero.

Verified repair: refresh now compares the sealed endpoint against `publicUrl(connection.endpoint ?? '')`, supporting existing noncanonical rows while preserving actual endpoint equality. Independently reran the OAuth suite: 12/12 passed, including `stored noncanonical endpoint completes authorization and refresh with canonical resource pins`.

## Verified behavior

- Independently ran `tests/mcp-connector.test.ts` plus `tests/mcp-connector-auth.test.ts`: 31/31 passed, including 11 OAuth tests.
- Missing refresh token preserves the prior token; subsequent rotation replaces it. Existing HTTP regression verifies both steps.
- Refresh uses an atomic version/revision/lease claim and rejects late completion after expiry/disconnect. Uncertain outcomes require reauthorization.
- Installed SDK `executeTokenRequest` performs a single POST; `refreshAuthorization` and `exchangeAuthorization` do not retry the rotating request.
- Setup state is session/user/connection/revision/adapter bound and consumed once. Encrypted OAuth context additionally binds state hash, user and connection; stored client context binds owner and connection.
- Credential and client-context writes share a guarded batch with live session and credential-version checks; disconnect/session revocation blocks late commit.
- Discovery uses protected-resource metadata and issuer equality validation. Exchange binds PKCE, callback, expected issuer and canonical resource; SDK requires `iss` when metadata advertises it.
- OAuth fetches use the guarded public-network transport, bounded response buffering, dispatch count and abort signal. Node/Workers SDK discovery propagates transport TypeError rather than applying browser CORS fallback.
- Server-returned scopes are metadata; this service does not mint local connector grants or grant capabilities from OAuth scopes.
- Migration 0013 keeps setup context tied to auth-state cleanup and deletes retained client context when credentials are deleted.
- All test/probe databases were isolated; the fixed-port HTTP fixture and isolated peer were closed. No external provider calls or real credentials used.

Unresolved questions: none. No remaining concrete findings in this bounded foundation review.
