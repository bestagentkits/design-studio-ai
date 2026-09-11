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
- [x] Exact PR head CI and merge.
- [x] Main-head CI deployment and production endpoint/thumbnail checks.
- [x] Versioned release artifacts and downloaded checksums.

## Limits and rollback

Physical iPad/Apple Pencil is unavailable. The accepted demo and automated desktop/touch browser tests do not establish pressure/palm/input-to-visible performance on real hardware. The 500/2000-element Board frame measurements and 2048/4096 Paint worker measurements are documented in the linked execution reports, not Cloudflare peak-memory or end-to-end latency claims.

Immutable assets remain quota-bounded without automatic garbage collection. After v2 writes, rollback must retain v2-capable readers and generation/CAS validation; do not deploy a v1-only revision or reverse applied migrations. Follow the owning backup/rollback guidance in `docs/deployment.md` and retain the existing encryption key and R2 assets.

An attempted new production creative smoke script was blocked before creation by the privacy hook, which interpreted an environment-variable expression as a sensitive filename. It was not bypassed. Existing CI production health/OAuth and disposable-account thumbnail verification remain the production checks; local integration tests cover real Creative pixels, publication isolation and exports.


## Published result — 2026-09-11

- [PR #29](https://github.com/bestagentkits/design-studio-ai/pull/29) merged as `012c4e30a699b999caa0ebc2cafbcbad38f62cc3`.
- Exact PR head `87ee7a5` passed [CI 34569371862](https://github.com/bestagentkits/design-studio-ai/actions/runs/34569371862): 298 Node tests and 107 Chromium desktop/mobile E2E executions.
- The merge commit passed the same complete suite and deployed in [main workflow 34569985757](https://github.com/bestagentkits/design-studio-ai/actions/runs/34569985757). Cloudflare version `2ca1c2ca-0808-40f3-a6ce-40041762925a`; migration 0011 applied successfully. Health/OAuth and real thumbnail revision/cache/ownership smoke passed; disposable production account/project cleanup passed.
- Independent uncached live checks at 06:37 UTC: OpenAPI 0.4.0, schema supports [1,2], semantic Paint route present, anonymous Paint request returns 401, generated agent documentation contains paint_document.
- [v0.4.0](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.4.0) published against that merge commit. Downloaded CLI and skill SHA-256 match uploaded local artifacts. Downloaded CLI independently prints 0.4.0 and exposes projects paint.
- CLI SHA-256: `a72b86cc6b51ba003c6f2d012023fbeda3d73b8809b61c15824d674be721612a`.
- Skill SHA-256: `b1a7e4086b0f5915cf7c039bbfca4666e2dcd2fab130100077b497249ef330b0`.
- Owned local E2E processes stopped; no listener remains on port 19203. Physical Pencil, full export/font acceptance and Cloudflare peak-memory limits remain as documented; deployment is complete, not a claim that all aspirational acceptance rows were measured.
