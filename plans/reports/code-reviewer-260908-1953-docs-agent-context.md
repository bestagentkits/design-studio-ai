# Documentation and agent-context review

Status: DONE
Verdict: Approve

## Scope and result

Reviewed the complete documentation diff against `origin/main` (`1f6fb4879c7152ffa96363a5842a23bc37b080a8`), including AGENTS.md, six documentation/skill/source files and the historical journal. No unresolved findings. Docs impact: minor; public reference corrections and agent guidance, with no runtime or package-version change.

The initial reference omitted existing REST/CLI merge and change-polling entries and MCP search keywords. Verified against the API, CLI and search implementation; source owner corrected these before this verdict. New payloads, response descriptions and search metadata match their executable owners.

## Verified contracts

- Merge/change names and exact-base reconciliation: `server/mcp.ts:85-93`, `server/collaboration.ts`, `packages/cli/src/dsa.ts:107-108`, `src/shared/collaboration-contract.ts`.
- Independent library versions/project revisions: `packages/cli/src/design-system-commands.ts`; portable media boundary: `src/shared/design-systems.ts`.
- Model discovery rejects MCP OAuth: `server/index.ts:239`, `server/design-system-tools.ts`.
- WebMCP local edits versus saved API state: `src/app/browser-design-tools.ts`, `src/app/editor.tsx:1045`.
- Public preview/share snapshot aliases: `server/mcp.ts`; renderer split: React ZIP precedes browser-binding requirement in `server/exports.ts:98-105`.
- Generated public documentation and llms ownership: `scripts/build-public-docs.mjs`; browser coverage: `playwright.config.ts`.
- UX/AX and mobile-first/cross-browser wording describes requirements and explicitly avoids unsupported coverage claims.

## Validation

Read [tester evidence](tester-260908-1944-docs-agent-context.md): final build, application/CLI typecheck, generated reference assertions and focused public-docs E2E all passed (8 tests; desktop/mobile Chromium). Independently inspected generated API/CLI/MCP Markdown for corrected merge/change entries and ran `git diff --check` successfully.

Final reviewed and tested `src/app/documentation.tsx` SHA-256: `addfd899d4f571f09739fd0e2959d5c156fb4e03694e9ecdc9a930ed3cb6733b`.

## Risks and limits

Existing nonfatal build warnings remain described in tester evidence. This review establishes documentation accuracy and focused local verification, not main-branch CI, deployment, live provider success, export fidelity or Firefox/Safari coverage. No additional runtime tests are needed for this prose/reference-only correction; shipping gates remain the controller's responsibility.

Unresolved questions: none.
