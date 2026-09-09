# Review, main merge, and production evidence

Priority P1. Owner integration. Depends on all implementation. Read `.github/workflows/ci.yml`, `docs/deployment.md`, `scripts/cloudflare.mjs`, `wrangler.jsonc`, existing release evidence, and updated phase checklists.

## Verify and review

- [x] Reconcile every opening requirement against source and runnable evidence; list gaps explicitly. Review telemetry threat model, operator privilege, provider accounting, nested MCP correlation, inline-text history and editor selection roots.
- [x] Run `npm run build:cli`, `npm run typecheck`, `npm test`, `npm run build`, then affected/full `npm run test:e2e` as shared contracts warrant. Repo has no lint script: don't invent a passing lint gate; use actual configured checks.
- [x] Use isolated E2E harness, coordinate port 8791, track/stop owned servers. Current projects are desktop/mobile Chromium; run Firefox/WebKit checks where feasible and name engines actually tested. Do not claim full cross-browser support from Chromium results.
- [x] Delegate code review of final tested changes; validate actionable findings against actual security/product behavior. Fix regressions and rerun relevant checks without weakening tests.
- [x] Inspect optimized README screenshots and actual packaged CLI/skill. `npm pack` must run inside `packages/cli`; preserve generated assets ownership and exclude private files.

## Ship

- [ ] Check current branch/status/main and remote HEAD; isolate unrelated edits. Review staged changes for secrets. Use focused conventional commits, push branch, create/reconcile PR and run exact-head checks.
- [ ] Merge requested scope to main only after required checks pass. Existing push-main CI verifies, uploads dist, checks current main head, applies D1 migrations and deploys with `--keep-vars --message SHA`.
- [x] Preserve ENCRYPTION_KEY. Set verified PostHog host/public key and explicit operator IDs through intended environment mechanism without printing secret values. Additive migration first; no applied migration rewrites or database reset.
- [ ] Verify main commit, terminal CI and deployment job, deployed revision and live health/schema/docs/asset routes separately. Read-only authenticated smoke must prove owner activity and configured operator dashboard restrictions; verify real PostHog delivery if configured. Do not use production smoke script routinely: it creates accounts, invokes renderers and deletes data.
- [ ] Record credential-dependent provider success, analytics delivery or operator identity gaps separately from local implementation. Configuration alone is not evidence of successful live generation/export.
- [ ] Write concise release evidence under this plan, update durable docs only for changed contracts, stop owned processes and return live URLs plus exact remaining limits.

## Rollback and acceptance

Rollback application revision through existing deployment controls if needed, retaining data and encryption key. Disable optional PostHog delivery if unhealthy. Never silently discard persisted operational evidence or user's projects. Finish only when all requested code/docs/assets are committed, merged and deployment/runtime evidence establishes requested delivery, or an exact external blocker is reported.

## Pre-merge verification snapshot — 2026-09-09

CLI build, typecheck and all 148 unit/integration tests passed. Production build, skill ZIP (8 Markdown files), CLI tarball and Worker dry-run passed. Firefox and WebKit each passed all six focused editor/activity workflows. Full Chromium rerun passed: desktop 30/30; mobile 29 passed with one pre-existing appearance-menu skip. Terminal CI, main merge and live verification will be recorded on the linked PR rather than predicted here. Three earlier browser failures were repaired: newly extended schema/sitemap expectations and WebKit shortcut opener focus. No assertions were weakened.

PostHog US project config verified with invalid-key negative control; existing GitHub-linked operator account resolved and three required configuration secrets applied without changing the encryption key. Configuration is not yet deployment or successful analytics delivery evidence.
