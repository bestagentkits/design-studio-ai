---
title: "Phase 9: Verify integrated behavior and prepare controlled rollout"
status: todo
---

# Verify integrated behavior and prepare controlled rollout

Priority: P2. Status: pending. Depends on: 1-8. Estimate: 4-6 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/AGENTS.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/.github/workflows/ci.yml`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/scripts/run-e2e.mjs`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/playwright.config.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/package.json`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connectors-ui.spec.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/security-boundaries.test.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/cli.test.ts`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connector-workflows.test.ts`

## Outcome and requirements

Produce evidence for the actual requested workflows, runtime/security boundaries and browser behavior. Planning completion does not authorize deployment. This phase specifies later implementation acceptance and rollout; execute remote writes/deploy only within the authorization of that future delivery task.

## Verification sequence

1. Run the narrow phase suites after each implementation. Install both dependency trees and build CLI/renderer before suites that require their artifacts. Recheck current scripts before execution; package.json has no lint script, so do not invent `npm run lint` or claim lint passed.
2. Run full shared-contract gates: `npm run build:cli`, `npm run typecheck`, `npm test`, `npm run build`, `npm run pack:skill` and `npm run test:e2e`. Package with `npm pack` from packages/cli, not the repository root or --prefix shorthand.
3. Run connector browser spec with STUDIO_CROSS_BROWSER=1 for Firefox and WebKit, plus default desktop/mobile Chromium. Use only scripts/run-e2e.mjs through npm; reserve port 8791, track owned process PIDs/ports/checkouts, and stop only owned processes. No production smoke script.
4. Test integrated negative cases: different owner/connection, expired/revoked caller, stale tool schema, reconnect to another account, changed brief/design during approval, duplicate tabs/requests, invalid resource pointers, oversized content, SSRF/OAuth mix-up, remote redirects, private output and approval self-grant.
5. Test partial effects: write accepted but response lost, app crash during upload/PR, lease expiry, disconnect while executing, cancel after remote acceptance, and project deletion during run. Confirm known IDs reconcile safely; ambiguous outcomes remain unknown and cannot be blindly replayed.
6. Run isolated Cloudflare and Node scenarios with real persistence and verified egress. A local Node pass does not prove Workers DNS/transport/auth or D1 lease behavior. Record exact build/runtime versions and provider protocol profiles.
7. In separately authorized test accounts, complete real MCP read/write, one actual supported model tool loop, GitHub source-to-PR, Drive import-to-PDF/PPTX and supported native Slides export. Inspect remote artifacts and exported bytes. Credential/setup failures are blocked evidence, not successful generation.
8. Review the final code for shared contracts/security, resolve actionable findings against real source/tests and document material limits. Do not reverse confirmed user priority or silently remove a connector because a review recommends reduced scope.
9. Prepare disabled-by-default connector rollout/config and backup procedure. Preserve ENCRYPTION_KEY and existing secrets; apply forward migrations once. Enable internal test accounts, then intended audience only after explicit release authorization and live checks. Record source SHA, CI, merge, deployment and runtime acceptance as distinct states.

## Todo

- [ ] Pass focused suites and full current release gates.
- [ ] Verify Chromium desktop/mobile, Firefox and WebKit.
- [ ] Verify Cloudflare + Node auth, transport, persistence and cleanup.
- [ ] Complete isolated real MCP/model/GitHub/Google acceptance evidence.
- [ ] Review final code and reconcile known risks.
- [ ] Prepare rollback and hand over evidence with honest release state.

## Evidence deliverables

Save reports under this plan: verification.md (commands/results), interoperability.md (SDK/protocol/provider/runtime matrix), browser-validation.md (actual browsers), live-acceptance.md (redacted artifact IDs/results), release-readiness.md (remaining setup, backup/rollback and whether release is authorized). Do not claim tests ran from their presence in this plan.

Acceptance matches every checkbox in plan.md. A feature is usable only when its real workflow has evidence; missing test credentials can leave live acceptance pending while local implementation/test results are still reported accurately.

## Rollback

Disable new execution and connection creation server-side, preserve pending/unknown operations for investigation, revoke connector credentials when appropriate, and redeploy the last compatible code only if rollback is authorized. Keep additive migrations and stable encryption key. Reverting code does not undo remote PRs/files or revoke a token automatically. Do not delete user artifacts as rollback.
