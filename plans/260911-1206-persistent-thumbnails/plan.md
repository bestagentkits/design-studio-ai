# Persistent revision thumbnails
Status: verified locally; shipping

Outcome: authenticated project cards load stored images after reload; changes preserve the old cover until a new revision renders. No browser-side scene rendering for workspace covers.
Constraints: shared isolated export renderer, existing bucket/SQLite-D1 adapters, server ownership, bounded render leases and retries, no external renderer network or provider calls. No public sharing of private images.
Non-goals: user-selected covers, historical cover browser, eager rendering of every save.
Acceptance: real image bytes survive a server restart; repeated requests do not launch a browser; stale saves cannot overwrite current covers; concurrent requests deduplicate; unauthorized access denied; deletion cleans stored covers; web/slides/motion/3D pixel tests pass.

Design reviewed against existing owners: server/projects.ts owns saved revisions and project summaries; server/exports.ts embeds owned assets and isolates browsers; ASSETS_BUCKET stores binary data. Add revision-keyed thumbnail records with lease/retry state. Generate lazily on authenticated image GET; current requests return 202 while another worker owns generation. Keep latest two completed covers, serve exact revision bytes privately. Summaries expose latest ready revision and revisioned image URL. Browser loads existing cover immediately and fetches replacement in background. API catalog feeds WebMCP and docs; MCP/CLI receive summary metadata and expose thumbnail download through the same route.

- [x] Shared renderer, migration, revision cache and endpoint.
- [x] Workspace cover loading and cross-surface discovery/docs.
- [x] Real storage/renderer/concurrency/ownership/browser tests.
- [ ] Review, CI, merge and verified deploy.

## Verification and review

- Typecheck, all 181 tests, renderer/app/docs build and skill packaging passed. Eight thumbnail E2E cases passed on desktop/mobile Chromium, Firefox and WebKit; screenshots alongside this plan.
- Real SQLite/FileBucket plus isolated Chromium prove persistent bytes, process restart without renderer bindings, owner isolation, deduplication, expired lease recovery, failure cooldown, revision retention and deletion races. MCP and built CLI return identical cached PNG bytes.
- Local review found and fixed deletion publication race with a project deletion gate; late workers remove their output. No outstanding correctness findings.
- First uncached revision still needs rendering; external media follows cloud export restrictions. Rendering is demand-driven, not performed on every save.
- Patch release 0.3.3 packages the added CLI command and synchronized skill. CI and production evidence will be recorded after deployment.

Release verification: CI now runs `scripts/smoke-thumbnails.mjs` after production deploy. It checks actual D1/R2/Browser Rendering cache behavior using disposable data with project/account cleanup; local execution is intentionally skipped without cleanup credentials.

Full E2E rerun: 41 desktop and 40 mobile cases passed (three device-specific skips). Updated the older feedback assertion from client data URLs to revision URLs plus decoded PNG dimensions. Its initial failure restarted a Playwright worker and exhausted signup limits; the corrected full run passes without changing rate limits or test isolation.
