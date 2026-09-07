# Working in this repository

Use [docs/README.md](docs/README.md) to find the owning guidance before changing a contract. Product-agent usage belongs in [docs/agents.md](docs/agents.md) and the [design skill](skills/design-studio-ai/SKILL.md); this file governs repository work.

## Preserve the requested behavior

- Deliver the requested scope. Do not substitute mock provider responses, fake exports, or fixture projects for real behavior.
- Keep browser, REST, MCP, WebMCP and CLI edits on the shared validators and services. When changing a public contract, inspect each affected client and its documentation rather than introducing a second document format.
- Preserve separate brief and document revisions. Keep scope approval explicit; do not interpret unanswered questions as approval or bypass conflicts by retrying with a higher revision.
- Keep authorization and validation on the server. A UI check must not replace project ownership, OAuth scope, asset isolation, or revision checks.

## Protect data and credentials

- Add migrations; do not rewrite applied migration files or reset a deployed database to make a change pass.
- Never commit real dotenv files, provider keys, OAuth secrets, session tokens, or private user content. Use placeholders in examples; keep browser traces and screenshots free of credentials before sharing them.
- Preserve the existing `ENCRYPTION_KEY` across restarts and deployments. Read [deployment and backups](docs/deployment.md#backups-and-rollback) before changing persistence or secret storage.
- Keep tests isolated from real accounts and projects. The [production smoke script](scripts/smoke-production.mjs) creates accounts, calls renderers, and deletes its test data; do not use it as a routine local test.
- In Cloudflare server fetches, use `redirect: 'manual'` and reject redirect responses before forwarding credentials. Do not restore `redirect: 'error'`: the Workers runtime used here rejects that value. Follow the existing [provider transport](server/providers.ts) and [GitHub transport](server/github-login.ts).

## Run the appropriate checks

Use npm with the Node version declared in [package.json](package.json). Install both dependency trees on a fresh checkout: `npm ci` and `npm ci --prefix packages/cli`.

| Change | Verification |
| --- | --- |
| Focused TypeScript behavior | `npx tsx --test tests/briefs.test.ts`, substituting the relevant existing `*.test.ts` file |
| Renderer or publication behavior | Run `node scripts/build-renderer.mjs` before the focused test; install Chromium with `npx playwright install chromium` if absent |
| CLI behavior | Run `npm run build:cli` before `npx tsx --test tests/cli.test.ts` |
| Browser workflow | Run `npm run build`, then `npm run test:e2e -- tests/onboarding-ui.spec.ts --project=mobile`, substituting the affected spec/project |
| Shared contracts or cross-module implementation | `npm run typecheck`, `npm test`, and `npm run build`; rebuild the CLI first when running its tests |
| Documentation only | Check changed links, commands, configuration names and claims against their owners; do not start servers or rerun unrelated suites |

The [CI workflow](.github/workflows/ci.yml) owns the full release gates. Fix observed failures instead of weakening assertions or claiming an unrun check passed. Distinguish provider configuration/error checks from successful live generation, and inspect actual exported files before claiming format fidelity.

## Avoid competing processes and generated edits

- Use [scripts/run-e2e.mjs](scripts/run-e2e.mjs) through `npm run test:e2e` for isolated browser tests. Keep its per-device databases and production rate limits intact.
- Coordinate the E2E port before starting a review server. Do not run another harness on port 8791 while E2E owns it, or attach tests to an unrelated process that happens to answer health checks.
- Track servers you start by PID, port and checkout; reuse an existing owned process when appropriate, and stop your processes when finished. Never kill an unrelated listener to free a port.
- Edit renderer/viewer sources and public-doc components, then rebuild. Do not hand-edit `dist/`, `public/studio-renderer.js`, or `public/studio-viewer.js`; [build scripts](package.json) own those outputs.
- Run `npm pack` from `packages/cli` when packaging the CLI. Do not rely on `npm pack --prefix packages/cli`; that invocation packaged the repository root in this environment.

## Finish without creating documentation drift

- Update the smallest owning document when behavior, setup, security or a public contract changes. Link to executable owners rather than copying schemas, command inventories, or test counts into more files.
- Keep plans and release evidence under `plans/`; do not treat a completed plan as the current product contract. Follow the existing timestamped plan-directory convention when a task needs a plan.
- Use focused conventional commits without AI attribution when committing is in scope. Review the staged content for secrets and unrelated changes before pushing; use `gh` for GitHub operations.
- Report what changed, which checks actually ran, and material remaining limits. Do not claim universal browser support, provider success, export parity, or an audit-clean dependency tree without evidence.
