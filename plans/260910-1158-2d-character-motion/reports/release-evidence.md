# Release evidence — native character motion

## Local validation (2026-09-10)

- Base main: `7c75557`; integrated in `9507f53` on `codex/2d-character-motion`.
- Typecheck and production build pass. No lint script exists; TypeScript and `git diff --check` are the available static checks.
- Rebuilt renderer, then full unit/integration suite: **179 passed, 0 failed**, 47.8 seconds. CLI suite after its final message update: **9 passed**.
- Full mobile Chromium: **37 passed, 1 existing desktop-only test skipped**. Desktop initial rerun: 37 passed, one outdated sitemap expectation; corrected expectation adds the new motion guide, preserving exact route comparison. Focused desktop docs rerun: **4 passed**, including public discovery/sitemap.
- Character acceptance additionally passed Firefox 155 and mobile-viewport WebKit 26.6. No claim of physical iPhone testing.
- CLI build and `npm pack` from `packages/cli` pass; root `npm run pack:skill` packages eight source files. A mistaken attempt to run pack:skill from the CLI directory failed because that script is root-owned; rerun from root succeeded.
- Local links in motion guide/plan/reports resolve. Build regenerates public HTML, Markdown and llms references from source.
- Reviewer regressions and measurement limits: [implementation review](implementation-review.md), [runtime spike](runtime-spike.md), [performance baseline](performance-baseline.md).

## Release gates

PR verification, merge commit and production deployment are external CI evidence, not implied by local tests. The PR and main workflow runs are the authoritative records; main automatically deploys only after verification, with a current-head guard and read-only health/OAuth checks. No production smoke or live BYOK generation was run.

## Rollback

Retain v2 readers and the existing encryption key. Do not reset project storage or downgrade persisted v2 documents. There is no new database migration. If disabling authoring, preserve playback/read/export support for already-saved characters.
