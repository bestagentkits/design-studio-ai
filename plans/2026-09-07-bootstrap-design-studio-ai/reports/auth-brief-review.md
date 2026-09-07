# GitHub authentication and persisted brief review

## Outcome

The review found two reproducible backend defects. Both are fixed in the current source: unsupported Workers redirect mode in the provider transport, and inherited answer properties causing valid interviews to fail. The combined GitHub and brief tests pass 21/21, and application/CLI typechecks pass. No remaining verified backend authorization or approval defect was found in the reviewed paths.

Reviewed authentication, security middleware, brief routes/schema, provider generation, MCP brief tools, focused tests, and the GitHub/interview phase requirements. Live GitHub success is controller-reported evidence; this review independently verified the runtime redirect behavior without sending any external request or credential.

## Findings and resolution

### P1 — Workers rejects `redirect: "error"` before issuing provider requests

Location: [server/providers.ts:111](../../../server/providers.ts#L111); corresponding GitHub fetch is [server/github-login.ts:91](../../../server/github-login.ts#L91).

The shared provider transport used `redirect: "error"`. An isolated Miniflare probe running installed workerd `1.20260907.1`, compatibility date `2026-09-07`, constructed synthetic Requests with each redirect mode. `error` threw a TypeError stating that only `follow` or `manual` is supported and instructing callers to use manual status checks. Both `manual` and `follow` constructed successfully. The probe made no network requests and disposed its runtime in `finally`.

This prevented Cloudflare provider requests from reaching their upstream endpoint, including design generation, interviews, and media operations. The controller changed the transport to `manual`; its existing non-2xx check and response-body cancellation still reject redirects. GitHub also now uses `manual` and rejects non-2xx responses, and the controller reports successful live OAuth afterward. No credential-bearing redirect was followed or recommended.

Status: resolved in current source. This runtime-specific incompatibility was not detectable by the Node-only request tests or broad `redirect?: string` Workers typings.

### P2 — Valid `constructor` question IDs read an inherited function as an answer

Locations: [server/briefs.ts:37](../../../server/briefs.ts#L37), [server/briefs.ts:39](../../../server/briefs.ts#L39), [server/briefs.ts:64](../../../server/briefs.ts#L64). Regression: [tests/briefs.test.ts:176](../../../tests/briefs.test.ts#L176).

The question schema permits `constructor`. For an unanswered question, ordinary `answers[question.id]` lookup returned the inherited Object constructor. Readiness called `.trim()` on that function, producing HTTP 500. A real app request with in-memory SQLite, a valid request/scope, and an unanswered required `constructor` question reproduced the failure. The same lookup in question replacement could preserve an inherited value.

With the controller's explicit narrow authorization, this review added own-property answer reads and a string type check before trimming. The regression covers initial unanswered state, incomplete approval, replacing an unanswered question, explicitly answering and approving it, and clearing an answer after the question meaning changes. All pass.

Status: resolved. The analogous frontend answer-presence helper was reported separately, and its owner added string guards and own-property lookup in the current source; frontend implementation was outside this review's edit scope.

## Contract and security checks

- Brief reads and writes resolve owner-scoped projects, and the table query includes the authenticated owner. Atomic revision predicates protect initial creation, edits, approval, and late interview writes.
- Every successful brief mutation clears approval; approval requires the current revision, complete scope, and required answers. Strict write schemas do not accept injected `status` or `approvedAt` fields.
- Design generation refuses existing unapproved briefs, includes the approved scope, and checks the brief revision again after the provider response. Existing manual design editing and projects without briefs keep their accepted behavior.
- Choice answer strings are intentionally allowed as explicit custom answers. Unknown IDs, incompatible arrays, duplicate selections, and unavailable options are rejected. Replaced questions preserve answers only when their meaning and selections remain compatible.
- MCP uses the same authenticated REST routes. Its approval tool explicitly requires human approval and warns against inferring it from silence. Token access to design approval is part of the accepted external-agent contract, not an authentication bypass.
- GitHub state is unpredictable, hashed, browser-bound, expiring, and atomically consumed. PKCE verifiers are encrypted; the challenge is derived from the decrypted verifier. Linking is bound to the actual session-cookie hash and authenticated user.
- Stable numeric GitHub identity controls relogin. Email collisions never automatically grant access to an existing password workspace; linking uniqueness and concurrent creation rollback are tested.
- GitHub token exchange uses fixed provider endpoints, a configured exact callback, server-only client credentials, and non-following redirects. Callback error redirects are allowlisted and do not include provider messages or tokens.

## Verification and limits

- `npx tsx --test tests/github-login.test.ts tests/briefs.test.ts`: 21 passed, 0 failed, 0 skipped.
- `npm run typecheck`: passed.
- `git diff --check -- server/briefs.ts tests/briefs.test.ts`: passed.
- A real Workers Request-construction probe confirmed the redirect incompatibility; no successful provider response was mocked.

The focused tests establish state, identity, persistence, approval, and failure behavior. They do not independently prove successful live provider interviewing or model output quality. The controller owns final live verification and deployment.
