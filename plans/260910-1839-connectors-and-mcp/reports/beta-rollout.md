# Isolated beta rollout — 2026-09-10

User authorized `beta.studio.agentkit.best` and a separate deploy workflow on pushes to `dev`. This is enabling infrastructure for the connector plan; it does not complete its nine product phases.

## Isolation and delivery

- Initial configuration commit: `6b9a0fc767aea1b008e8e00e03d0ce820f6ecb3c`; final workflow fixes: `2b5ddc446edcb000f5e42bcc5e0afdef6f4ff4d6` on remote `dev`.
- [Final workflow run](https://github.com/bestagentkits/design-studio-ai/actions/runs/34478008042).
- Worker `design-studio-ai-beta`, D1 `design-studio-ai-beta`, R2 `design-studio-ai-assets-beta`, and GitHub environment `beta` are separate from production.
- A new random 32-byte beta encryption key was provisioned once; secret values were not printed, committed, copied from production, or added to CI. An ignored local backup has owner-only file permissions.
- The workflow preserves Worker secrets, applies only beta migrations, deploys verified build assets, serializes beta deployments and skips superseded dev commits. Production workflow continues to own main releases.
- The beta build uses `PUBLIC_SITE_URL=https://beta.studio.agentkit.best`; runtime audience/callback discovery uses its own `APP_URL`.

## Local verification at deployment commit

- CLI build, typecheck, 166 tests, beta web/documentation build, skill packaging and CLI pack dry-run passed.
- Chromium: desktop 31 passed; mobile 30 passed and one existing desktop-only test skipped. Firefox/WebKit not run for this deployment change.
- Wrangler dry-run compiled successfully and showed only beta DB/R2/APP_URL plus Browser/Assets bindings.
- E2E used owned port 18843 because port 8791 belonged to another worktree; its servers exited normally. Generated screenshots were restored and excluded from the commit.
- Existing ineffective dynamic-import build warning remains; dependency audit findings from the earlier install are not claimed fixed.

## Cloudflare DNS experiment

See [recorded results](cloudflare-dns-evidence.json) and [runtime interpretation](runtime-probes.md). Seven temporary records were created in the project account, tested, and deleted. The binding-free remote preview process was stopped. These were separate hostnames; app domain records were not repointed for the test.

## Review and first deployment

Independent reviewer found that a failed remote-head lookup could be misreported as superseded. Fixed using a standalone `git ls-remote --exit-code` assignment and explicit `shell: bash` (pipefail); failure reproduction and narrow re-review passed. The first specialized review agent could not run because its configured model was unavailable; a default-model review agent performed the review instead.

The first workflow passed verify and applied/deployed beta successfully (version `ed5d2b50-d9fc-43b1-bb02-faebff13358c`), then failed public verification with ENOTFOUND immediately after custom-domain creation. Added bounded readiness retries with unchanged health/OAuth assertions and failure after twelve attempts. A superseded intermediate verification run was cancelled. Subsequent local public health/OAuth checks passed; home page, llms index and sitemap served beta URLs. Remote beta reports no unapplied migrations.

## Live status

Final CI passed verify and deploy for commit `2b5ddc446edcb000f5e42bcc5e0afdef6f4ff4d6`. Cloudflare deployment `dba4583b-9ae2-41a3-b55b-d6d880f84d5b` at 2026-09-10T12:44:31.525841Z records that exact SHA in its deployment message. Worker version `08c853e9-eac9-4778-af60-ee29f57211b7` receives 100% traffic. Public beta health and both OAuth discovery documents passed again after deployment. Product connector acceptance remains incomplete regardless of beta health.
