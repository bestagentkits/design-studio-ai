# GitHub login security and test review

## Summary

Added `tests/github-login.test.ts`. All 11 tests pass against real SQLite, and `npm run typecheck` passes. No source changes or concrete exploitable authentication defects were identified in the reviewed paths.

The suite invokes real application HTTP routes through Hono requests and exported services through authenticated Hono test contexts. Synthetic GitHub profiles are explicitly identity-unit inputs. It does not intercept or stub successful GitHub HTTP calls, and it makes no claim that real provider consent or code exchange has completed.

## Verified boundaries

- Authorization uses the configured GitHub client ID and exact application callback. The client secret stays out of the authorization URL. The browser cookie is Secure, HttpOnly, SameSite=Lax, scoped to the callback family, and expires after ten minutes.
- SQLite stores state and browser hashes. The PKCE verifier is encrypted, and decrypting it yields the value whose SHA-256 challenge appears in the authorization URL.
- Missing, wrong-browser, malformed, expired, and previously consumed states fail. Concurrent consumption succeeds exactly once. Beginning again invalidates the prior attempt for that browser while another browser's attempt remains valid.
- Cancellation consumes state, clears the browser cookie, uses a safe error redirect, sets no session, and does not reflect the provider error description. Missing-code callbacks also consume state and reject replay.
- Missing provider settings and a mismatched callback fail before storing state. Public configuration and session-only status return the expected capability fields.
- Account linking requires a cookie-authenticated session and same-origin mutation. Anonymous, API-token, and API-token-plus-cookie requests fail. Another user, a new login session for the same user, or a missing session cannot complete a link begun in the original session.
- Numeric GitHub identity remains stable when the GitHub username or verified email changes. An existing GitHub identity can sign in without creating another account, including when new registration is disabled.
- A verified-email collision never automatically links to an existing password account. Missing verified email and disabled registration block creation.
- Explicit linking enforces uniqueness in both directions and leaves the password workspace usable. Concurrent first sign-ins for one GitHub identity create exactly one account and no orphan workspace.

## Review evidence

`consumeGitHubState` uses a conditional `DELETE ... RETURNING` with the state hash, browser hash, and expiration. Its link check also compares the authenticated user and actual session-cookie hash. Tests establish the intended one-use and exact-session properties rather than assuming them from the code.

`resolveGitHubUser` checks the persistent numeric identity before considering email and refuses email-based automatic linking. Migration constraints enforce unique GitHub IDs and one GitHub identity per workspace; the concurrent creation test verifies transaction rollback preserves those constraints.

The callback fetches only fixed GitHub endpoints, disallows redirects, bounds the request duration, parses profile and verified-email fields, and uses an allowlist of error codes for redirects. Provider HTTP success and real browser cookies across the GitHub redirect are outside this isolated suite and remain part of the controller's live verification.

## Validation

- `npx tsx --test tests/github-login.test.ts`: 11 passed, 0 failed, 0 skipped.
- `npm run typecheck`: passed for application and CLI.
- Temporary SQLite data is closed and removed in `finally`; generated credentials are kept in memory and are not logged.

## Unresolved questions

None for the assigned state and identity boundaries. Real GitHub authorization, consent, PKCE exchange, and provider configuration still require the separate live integration check.
