# Agent clients, deployment, and integration

Status: Completed. Owner: controller. Estimate: 8h.

Read [architecture](../../docs/architecture.md) and all prior phases. Controller coordinates `D:/www/oss/design-studio/packages/cli/**`, agent skill assets, root configuration, Docker, Cloudflare config, README, license, and integration tests. Review real changed files before assigning extra ownership.

1. Implement CLI commands for every agent workflow, JSON output, stdin/file document input, revision-safe writes, assets, providers, export, and publish. Provide actionable help and installable skill instructions with exact commands.
2. Reconcile imported shared interfaces and REST envelopes across implementations. Run focused tests first, then typecheck/build and application integration checks.
3. Verify all document kinds and export formats, auth/session/API-key/MCP paths, responsive UI, provider errors, and persistence. Inspect generated artifacts instead of accepting download filenames as evidence.
4. Supply Docker persistent volume configuration, migration startup, stable-secret configuration, health check, and a self-host smoke test.
5. Create the MIT GitHub repository `bestagentkits/design-studio-ai`, keep dotenv/secrets out of git, configure Cloudflare D1/R2/Worker/domain, deploy, and smoke-test `https://studio.agentkit.best` including an authenticated persisted project.
6. Update README and architecture claims to match actual code and publish a concise verification report. Record missing external integration configuration precisely and keep the corresponding real setup workflow available.

Acceptance: clean required checks, verifiable artifacts, reachable custom domain/TLS, live authenticated persistence, runnable Docker instructions, usable CLI/skill, and repository URL. No hidden failing check. Review high-risk changes against [design review](reports/design-review.md).

Risk: deployment configuration drift or worker limits. Use dry-run deployment, apply explicit migrations, verify bindings and secrets, then verify production behavior. Track all temporary dev servers and stop those started for this work after verification. Roll back to the known prior deployment while preserving storage.

## Reconciled progress — 2026-09-07

- [x] Bundled CLI, generated JSON schemas, installable skill, and real subprocess/SQLite tests completed.
- [x] CLI tarball built and extracted executable verified; stateless secrets and revision-safe workflows checked.
- [x] Cloudflare resources/custom domain deployed; final 16 production checks passed including PNG/PDF/PPTX, 3D, WebM, and interactive HTML.
- [x] Dockerfile/Compose persistence and stable-secret setup provided; README/deployment/architecture documentation reconciled.
- [x] Real Docker image build and 16-check self-host smoke passed: sessions, SQLite/CAS/messages, MCP, publish, PNG/PDF/PPTX, 3D PNG, WebM, and interactive HTML. Controller stopped/removed its test container.
- [x] Integrated tests passed 46/46, typecheck passed, and isolated desktop/mobile E2E passed 2/2.
- [x] Cloud recorder fix reverified: VP9 WebM decodes at 1280×720 with 11 frames; final Linux build/typecheck/test/pack CI passed.
- [x] Four viewer regressions and Docker motion/interactive HTML artifact checks passed.
- [x] Final production 16/16, Docker 16/16, tests 46/46, and E2E 2/2 reconciled.

- [x] GitHub v0.1.0 published; both archives downloaded, CLI SHA-256 matched the local pack, and the extracted standalone executable passed version/media-help checks. npm registry auth returned 401, so registry publication is not claimed.
- [x] Security fixes regression-tested, 95 staged files passed secret-value scanning, all phase status reconciled, owned Docker/API test processes cleaned up.

The repository is [bestagentkits/design-studio-ai](https://github.com/bestagentkits/design-studio-ai), with [v0.1.0](https://github.com/bestagentkits/design-studio-ai/releases/tag/v0.1.0) released and [Linux CI passing](https://github.com/bestagentkits/design-studio-ai/actions/runs/34144355459). [Finalization](reports/finalization.md) records implementation completion and external-credential, experimental-browser, encoder, and upstream-audit boundaries.
