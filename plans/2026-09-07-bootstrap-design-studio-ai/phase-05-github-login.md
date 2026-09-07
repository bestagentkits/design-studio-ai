# GitHub account login

Status: Implemented and verified on 2026-09-08. Owner: controller. Added by user after the verified v0.1.0 delivery on 2026-09-07.

## Context and scope

Add real GitHub OAuth login to the existing session/account system while preserving email/password access, project ownership, and network MCP authorization boundaries. Read [architecture](../../docs/architecture.md), [deployment](../../docs/deployment.md), [security.ts](../../server/security.ts), and the authentication routes in [index.ts](../../server/index.ts). The earlier [release verification](reports/finalization.md) remains evidence for v0.1.0 only.

The user supplied `GITHUB_CALLBACK_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` through local environment configuration. Never copy their values into source, documentation, commits, logs, browser storage, or published output. Use current official GitHub OAuth documentation for the external flow. Existing task authorization includes implementation and production deployment.

## Files and implementation

Controller owns authentication handlers, security helpers, necessary additive identity migrations, environment/type bindings, login UI, and focused tests. Update `.env.example` with variable names only, deployment setup, and architecture/account-linking decisions when implementation is verified. Preserve existing migrations and user data.

1. Define an OAuth identity mapping keyed by stable GitHub identity, with an explicit safe policy for accounts sharing an email address. Do not automatically grant access based on an unverified email or a provider-controlled display name.
2. Create a GitHub authorization redirect with unpredictable, expiring, browser-bound state. Validate/consume state on callback, exchange the code server-side, and fetch the authenticated identity using the returned token.
3. Resolve/create the correct local user and issue the existing secure session cookie. Reject replay, denied authorization, bad/missing state, and upstream errors without leaking tokens or changing unrelated accounts.
4. Expose login only when configured; keep existing login usable. Store the client secret only in server configuration and configure the exact canonical callback for each deployment.
5. Deploy the additive changes and run production verification through the actual configured GitHub flow when an authorized browser session is available.

## Acceptance and validation

- [x] GitHub login UI performs the real authorization redirect with correct client/callback/state parameters.
- [x] Callback validates browser-bound state, rejects expiry/replay/mismatch, and safely handles denial/upstream failures.
- [x] Successful callback issues an existing application session; logout/relogin resolves the same local account.
- [x] Account identity/ownership tests demonstrate no takeover or cross-account project/API access through email collisions or callback manipulation.
- [x] Existing email/password, API-token, MCP/OAuth, and revision behavior retain passing regressions.
- [x] Typecheck/build, focused tests, and affected E2E pass; configuration names and account-link policy are documented.
- [x] Exact deployed callback and real production redirect/callback/session behavior verified; any unavailable interactive approval is reported accurately rather than simulated.

## Risks and rollback

Principal risks are login CSRF, code/state replay, unsafe account linking, callback misconfiguration, and credential disclosure. Bind short-lived state to the initiating browser, use exact configured redirect handling, avoid unverified-email identity assumptions, and reuse existing session protections. Roll back application code or disable GitHub configuration while retaining additive identity records and existing email/password accounts; never delete user data to recover login.
