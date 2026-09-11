# Creative v0.4.0 release verification

User explicitly authorized completion and deployment on 2026-09-11. This record supersedes earlier implementation snapshots for release status; it does not substitute browser emulation for physical Pencil acceptance.

## Candidate

- Creative source: `920dd61`; upstream thumbnail integration: `a934a16`, including main `3b3c45d`.
- Migration order: upstream `0010-project-thumbnails.sql`, additive `0011-creative-asset-lifecycle.sql`. Existing encryption secrets remain unchanged; deployment uses the repository's `--keep-vars` workflow.
- Local post-merge CLI build, typecheck, all 298 Node tests, application/public docs build, skill archive and CLI package passed.
- Post-merge Firefox: all seven Creative browser scenarios passed. WebKit mobile viewport: all seven passed. These cover Board draft recovery, owned GIF frames/posters, all diagram templates, Paint selections/masks/groups, upload recovery/account isolation, and concurrent remote edits.
- Post-merge Chromium desktop/mobile thumbnail + Creative integration: all 18 scenario/browser executions passed. The earlier complete Chromium run found three failures; all were fixed and its 24 targeted reruns passed. A fresh full CI suite remains required.
- Independent Creative review found no remaining verified blocker. Independent thumbnail-merge review also found no verified blocker; see `merged-release-review.md`.

## Delivery gates

- [x] User authorized release and production deployment.
- [x] Compile, unit/integration, build and package local candidate.
- [x] Focused Firefox and WebKit browser checks.
- [x] Post-merge Chromium desktop/mobile integration checks.
- [ ] Exact PR head CI and merge.
- [ ] Main-head CI deployment and production endpoint/thumbnail checks.
- [ ] Versioned release artifacts and downloaded checksums.

## Limits and rollback

Physical iPad/Apple Pencil is unavailable. The accepted demo and automated desktop/touch browser tests do not establish pressure/palm/input-to-visible performance on real hardware. The 500/2000-element Board frame measurements and 2048/4096 Paint worker measurements are documented in the linked execution reports, not Cloudflare peak-memory or end-to-end latency claims.

Immutable assets remain quota-bounded without automatic garbage collection. After v2 writes, rollback must retain v2-capable readers and generation/CAS validation; do not deploy a v1-only revision or reverse applied migrations. Follow the owning backup/rollback guidance in `docs/deployment.md` and retain the existing encryption key and R2 assets.

An attempted new production creative smoke script was blocked before creation by the privacy hook, which interpreted an environment-variable expression as a sensitive filename. It was not bypassed. Existing CI production health/OAuth and disposable-account thumbnail verification remain the production checks; local integration tests cover real Creative pixels, publication isolation and exports.
