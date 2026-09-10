# Plan review and validation

Status: authored and reviewed for planning; implementation remains pending. Controller performed the review locally. No independent subagent review is claimed: the session restricts delegation unless the current user request authorizes it.

## Outcome review

- Requested deliverable: implementation plan for native GitHub/Google Drive connectors plus third-party MCP integration.
- Confirmed priority: user answered “MCP Connector và AI gọi tool trước (đề xuất)” during planning on 2026-09-10.
- Full connector scope retained. MCP-first human milestone ends at phase 5; native connectors follow in phases 6/7, with final parity and integrated acceptance in phases 8/9.
- No deployment, code implementation, real connection setup or paid provider use was authorized by this planning request.

## Four review lenses

| Lens | Finding grounded in baseline | Disposition in final plan |
| --- | --- | --- |
| Assumptions | providers.ts:195 only normalizes text, and mcp.ts:1 imports server classes | Accepted: implement actual provider tool messages/run loop and probe outgoing SDK profiles |
| Security | oauth.ts:103 accepts only studio; security.ts:83 does not expose credential identity | Accepted: explicit principal-scoped delegation and authentication context extension; legacy tokens inherit no access |
| Security | browser-design-tools.ts:21 creates tools from API inventory using a denylist | Accepted: positive exposure policy excludes credentials/grants/approval endpoints immediately in phase 2 |
| Failure | google-slides.ts:47 creates presentation before subsequent updates | Accepted: persist remote identity, expose partial/unknown outcomes and reconcile instead of blind duplicate creation |
| Failure | wrangler.jsonc declares CPU limit and no job queue/runner | Accepted: bounded request-driven checkpoints, no promise of detached background work |
| Assumptions | providers.ts:35 allowlists known origins; it does not secure arbitrary connector endpoints | Accepted: connection-time DNS/egress probe across both runtimes; no regex-only SSRF claim |
| Scope | existing GitHub OAuth at github-login.ts:42 is sign-in-only | Accepted: independent App/installation lifecycle; no silent login permission expansion |
| Scope | google-slides.ts:27 rejects unsupported content; exports.ts owns real binary output | Accepted: retain export fidelity limits, inspect actual bytes, no automatic publication of private media |
| Assumptions | editor.tsx:2601 integrates browser Google OAuth today | Accepted: narrow Picker access-token exception; no impossible blanket promise that every access token stays server-only |
| Failure | projects.ts:71 uses revision-checked save; providers.ts:288 checks current brief | Accepted: approvals/runs pin and recheck relevant revisions before external dispatch and proposal save |
| Scope | playwright.config.ts already declares optional firefox/webkit | Accepted: use existing cross-browser mechanism rather than new harness/config duplication |

These are implementation details completing the requested design, not reversals of explicit user decisions. No security annotations, successful OAuth response, local test or green CI alone is accepted as proof of end-to-end connector success.

## Decision status

| Topic | Status |
| --- | --- |
| MCP + AI before native adapters | User confirmed |
| Personal ownership, multiple accounts, remote HTTPS first | Proposed default consistent with inspected owner-scoped app |
| Explicit project/principal grants, confirmed custom/write actions | Proposed security design; verify usability and enforcement |
| Native GitHub source/React PR and Drive source/export workflows | Included from the preceding advisory scope |
| Local stdio, full indexing, shared team credentials, autonomous sync | Outside current proposed plan; no claim the user rejected them permanently |
| MCP 2026 and 2025 protocol support | Target matrix; blocked on phase 1 probes, not confirmed compatible |
| Cloudflare custom endpoint egress mechanism | Phase 1 engineering gate; if a gateway is required, present concrete operating implications before adoption |
| App registrations/test credentials | External prerequisites for live acceptance; names/config only in docs |

## Validation method

Check all existing-file ownership references against the checkout, local Markdown targets, phase index/dependencies, unchecked implementation tasks and CLI plan format. New-file targets are intentionally absent; no unit/browser/provider suite is run for plan-only changes. Validate current command names against package.json and the E2E harness, not by starting servers.

Planning is complete when the files and local checks pass. Phase 1 can start after implementation is requested; phases 2/3 cannot bypass failed transport/protocol prerequisites. Whole-feature production readiness remains dependent on all phase acceptance checks and real credentialed evidence.

## Whole-plan consistency sweep

- One architecture document owns entity/permission/run state definitions; phases reference it.
- No unattended background loop, implicit token delegation, automatic approval, whole-Drive read, unrestricted stdio or universal MCP compatibility claim.
- Restore/reconnect/retry is distinct from starting a new external write. Revocation blocks future dispatch but cannot undo remote acceptance.
- Full native scope retained after MCP-first prioritization. Existing sign-in, incoming MCP, generation and Google Slides contracts retain compatibility gates.
- Sequential file ownership is intentional; overlapping integration files are not authorized for parallel mutation.

## Observed planning checks

- `ak plan validate`: valid=true, no errors.
- `ak plan status`: 9 phases, 47 phase tasks, 0 done; plan pending, progress 0%.
- Filesystem sweep: 13 Markdown files, 68 local links, 130 existing or explicitly declared prior-phase owner references; no missing target.
- 54 unchecked boxes including 7 top-level acceptance items. No implementation checkbox marked complete.
- Plan index: 67 lines. Phase dependencies are acyclic and follow MCP-first priority.
- No template placeholders remain. `git diff --check` returned success; untracked plan files were also inspected directly for links/structure.
- No application tests/builds, server startup, real credential connections, publication or deployment ran. Dependency installation is deferred to implementation.
- Current-plan pointer set to this worktree-local plan directory. No new Codex task or external project work item created.

## Remaining questions

No unanswered product preference blocks plan delivery. Phase 1 must resolve SDK/egress/runtime evidence; if it requires added deployment infrastructure or cannot meet the target profile, return a concrete decision before dependent implementation. Live acceptance requires designated test accounts and valid app registrations, never token values pasted into the plan.
