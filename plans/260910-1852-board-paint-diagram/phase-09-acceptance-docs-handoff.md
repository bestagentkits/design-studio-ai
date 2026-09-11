# Phase 09 — Acceptance, documentation and release handoff

Status: pending. Priority: P1. Provisional effort: 5–7 engineering days.
Dependencies: Phases 07 and 08 complete; every feature slice has parity/docs and focused evidence.
Context: [architecture](architecture.md), [acceptance](acceptance-matrix.md), [source map](reports/intake-and-source-map.md), [plan](plan.md). Architecture and acceptance override research alternatives.

## Requirements and design

Audit the delivered result against every accepted capability, workload, device and output row. Complete human/agent discoverability and generated docs from owning sources, then provide a reviewable release handoff. The user has authorized implementation and its verification; release and deployment remain separate delivery states.

Report actual browsers/devices and provider/export limits. Local acceptance, exact-head CI, merge, package/release, deployment and live rollout are distinct states; a future authorized shipping task owns remote delivery.

## File ownership

Read/modify existing owners during implementation (not changed by this plan):

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/architecture.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/providers.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/deployment.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/web-documentation.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/build-public-docs.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/package-skill.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/package.json`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/playwright.config.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/scripts/run-e2e.mjs`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/.github/workflows/ci.yml`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/public-docs.spec.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

PROPOSED new files; create only when their real boundary is confirmed. If an earlier phase created one, extend it rather than duplicate it:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/creative-workflow-ui.spec.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/plans/260910-1852-board-paint-diagram/reports/acceptance-evidence.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/plans/260910-1852-board-paint-diagram/reports/device-performance.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/plans/260910-1852-board-paint-diagram/reports/export-inspection.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/plans/260910-1852-board-paint-diagram/reports/release-handoff.md`

No deletions planned. Shared owners are serial integration points; another phase/agent must not edit them concurrently without explicit ownership assignment. Generated renderer/viewer/dist files are build outputs, not edit targets.

## Implementation TODO

- [ ] Trace every acceptance row to implementation/test/artifact evidence; identify missing capability or measured failures without rewriting them as passed or deferring requested scope.
- [ ] Exercise full human/agent workflows: create Board, draw vector path/ink, build all diagrams, insert stickers/emoji/GIF, layer/mix Paint, embed/reopen, save/reload, interleave agent edits/undo, clone and publish/export.
- [ ] Record physical iPad/Pencil pressure/tilt/palm/two-finger behavior and exact hardware/browser/OS, plus desktop reference-task/workload metrics. Run phone basic actions at 390x844. WebKit emulation does not close hardware evidence.
- [ ] Review server authorization/version/coupled merge/asset lifecycle and viewer isolation independently, including idempotent receipts, observed-row version CAS, monotonic undo, quota reservations and public snapshot source-layer redaction. Fix evidenced correctness issues; do not silently reverse confirmed scope based on abstract audit preference.
- [ ] Verify documented routes, commands, schema, examples and source links against executable owners; update smallest owning docs and guide screenshots without credentials/private content. Rebuild docs/llms discovery rather than hand-editing generated output.
- [ ] Run full existing scripts below and package skill/CLI from their correct owners. Record exit/result/HEAD and inspect actual package content; do not claim any earlier source-only check proves a current build.
- [ ] Reconcile owned background processes and stop the ones started for validation. Reserve port 8791 for one isolated harness; never kill an unrelated listener or use production smoke as routine local testing.
- [ ] Write a handoff with ready/blocked criteria, reader-first/write-second rollout, stable ENCRYPTION_KEY/backups, retained-v2 rollback baseline, known limits and evidence links. Execute publication/deploy only under a separate authorized shipping scope.

## Slice parity and documentation

Before this slice is complete, expose its validated operations and capability/errors through the common server service, REST, MCP, CLI and feature-detected WebMCP. Preserve local-draft versus persisted-state semantics, expected revision and separate explicit brief approval. Update these existing owning surfaces with only this slice's changes:

- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/server/mcp.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/browser-design-tools.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/src/dsa.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/src/app/documentation.tsx`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/docs/agents.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/packages/cli/README.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/skills/design-studio-ai/SKILL.md`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/agent-capability-parity.test.ts`
- `/Volumes/GOON/codex/worktrees/db8b/design-studio-ai/tests/cli.test.ts`

Update public content sources, then run `npm run build` to regenerate documentation/llms output. Never hand-edit generated `dist/` or renderer/viewer bundles. Unsupported actions must report a precise capability/version error rather than silently flatten or ignore content.

## Future validation — not run

Future full gates, using Node >=24 and both dependency trees:

```sh
npm ci
npm ci --prefix packages/cli
npm run build:cli
npm run typecheck
npm test
npm run build
npm run pack:skill
npx playwright install chromium firefox webkit
npm run test:e2e
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- --project=firefox
STUDIO_CROSS_BROWSER=1 npm run test:e2e -- --project=webkit
```

Run projects sequentially; default E2E explicitly runs desktop/mobile only. Run `npm pack` with working directory `packages/cli` (never `npm pack --prefix packages/cli`). No lint script currently exists; do not invent `npm run lint`. Proposed tests must exist before invocation. Physical-device, artifact and credential-dependent provider evidence remain separate from these commands.

## Success criteria

Every requested scope item and matrix row has an honest final status and supporting evidence. Public API/CLI/MCP/WebMCP/skill/guide/llms references agree with behavior. All required local gates pass, independent review issues are resolved, packages inspected and release handoff is concrete; shipping remains accurately reported as unperformed until separately executed.

## Risks, security and rollback

Unavailable hardware/provider credentials or failed artifacts block only their corresponding claims, but incomplete required acceptance blocks calling the whole feature complete. Preserve remaining work in the report; do not bypass tests or weaken targets. Rollback retains v2 readers, immutable assets/history pins, snapshots and stable secrets.

## Unresolved evidence / next step

Refresh the source baseline and predecessor evidence before implementation. Record any failed or unavailable check; do not infer approval from silence, rerun stale writes with a guessed revision, or remove requested scope. Advance only when the stated dependencies and acceptance are met.
