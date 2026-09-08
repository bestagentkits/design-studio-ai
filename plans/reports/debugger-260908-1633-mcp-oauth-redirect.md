# MCP OAuth browser callback repair

## Outcome and scope

Restore browser navigation from explicit OAuth consent to the registered MCP client callback. Preserve session/Origin validation, exact redirect matching, state, canonical resource binding, PKCE, and single-use codes. No provider, persistence, or deployment configuration changes.

## Verified cause

`server/oauth.ts` emitted `form-action 'self'` on the consent document. Chromium applies this directive to the redirect after the form POST, blocking a callback on another origin. The pre-fix browser regression failed with `form-action blocked navigation`; the local callback receiver was not reached. HTTP-only tests had checked the 302 Location without exercising browser CSP enforcement.

## Repair

- Permit the validated callback origin alongside self in the consent policy.
- Reject wildcard or directive-bearing URL hosts before emitting a CSP source; URL parsing alone accepts these characters.
- Keep server-side exact redirect matching and all existing authorization checks.
- Browser coverage uses actual isolated SQLite-backed Studio endpoints and a local HTTP callback receiver, with no external account, provider calls, or fabricated token responses. It verifies Allow, Deny, state preservation, token exchange, and MCP initialize.
- Unit coverage checks both ChatGPT callback URL forms and malicious CSP source input. Official callback reference: [OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth#redirect-url).

## Verification

- Installed root/CLI dependencies; built CLI.
- Installed matching Playwright Chromium after the initial launch reported the browser executable missing.
- Before repair: desktop browser regression fails on the observed CSP violation.
- After repair: browser regression passes on desktop and mobile Chromium configurations.
- Focused server/security tests: 14 passed.
- Typecheck: passed.
- Full `npm test`: 70 passed, zero failed/skipped.
- Final production build and `git diff --check`: passed. E2E servers exited; no listener remained on port 8791.
- Code review: callback origin is added only after exact client redirect validation; no wildcard policy, script allowance, CSRF bypass, or token binding change. No blocking findings.
- Docs impact: minor; updated the owning architecture paragraph and linked browser coverage.

## Delivery limits

Local repair only. No commit, push, merge, or deployment performed. Production discovery was reachable and advertised the expected endpoints, but the user's ChatGPT connection was not exercised. The separately observed logged-out page still asks the user to sign in in another tab and reload consent; this change addresses navigation after Allow/Deny.
