# Documentation and agent-context verification

## Summary

Documentation-only validation on 2026-09-08, Node v25.2.1. No runtime behavior or package version changed. Final corrected source compiled and passed all eight focused public-documentation browser checks. Additional generated-content assertions found omitted existing merge/change operations in public REST/CLI tables and MCP search keywords; these were corrected by the source owner and all relevant checks rerun successfully.

## Checks executed

| Check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm run typecheck` | Passed: application and CLI TypeScript |
| `npm run build` | Passed: renderer, Vite, generated public documentation |
| `npm run test:e2e -- tests/public-docs.spec.ts` | Passed: 8 tests, 0 failed, 0 skipped |
| Generated MCP HTML/Markdown and `llms-full.txt` | Both collaboration tool names and original-base conflict warning present |
| Generated API/CLI Markdown and `llms-full.txt` export references | React, GLB and glTF present; REST export endpoint and React no-Chromium note retained |
| Generated collaboration references | REST merge/change rows, CLI merge/change commands and MCP search keywords verified |
| `llms.txt` | Curated MCP Markdown link present |
| Added AGENTS documentation owner link | Resolves to `docs/web-documentation.md` |

Browser coverage: Chromium desktop 1440×1000 (4 tests, 5.7 seconds), Chromium mobile 390×844 (4 tests, 4.4 seconds). Checks exercise public HTML/metadata/MIME/discovery, navigation without JavaScript, responsive overflow, search/keyboard/copy/theme/history, guide controls and images. No Firefox, Safari or real-device claims.

Build generated 10 public HTML pages, 11 Markdown files, llms indexes, sitemap and robots. Existing Vite `INEFFECTIVE_DYNAMIC_IMPORT` warning: `document-view.tsx` has both static and dynamic consumers, so dynamic import does not split its chunk. Node SQLite and color-environment warnings did not fail E2E.

## Source checks

- CLI merge/changes: `packages/cli/src/dsa.ts:107-108`; exact-base payload and observed revision.
- MCP equivalents: `server/mcp.ts:85-93`.
- Export formats/output behavior: `packages/cli/src/dsa.ts:121-130`; glTF is textual, binary formats require a destination file.
- React ZIP precedes browser-binding guard in `server/exports.ts`; PNG/PDF/PPTX, motion and 3D exports use the browser.
- CLI tests actually build their distributable in `tests/cli.test.ts` before executing subprocesses.
- Public documentation is generated from `src/app/documentation.tsx`; typed playground/OpenAPI tools use `src/shared/api-reference.ts`.

Final compiled `src/app/documentation.tsx` SHA-256: `addfd899d4f571f09739fd0e2959d5c156fb4e03694e9ecdc9a930ed3cb6733b`.

## Findings and recommendations

Initial extra assertions exposed missing public REST merge/change endpoint rows, CLI merge/change command rows and MCP tool-name search keywords. Source owner added these entries. Final rebuild, typecheck, generated-content assertions and all eight focused browser tests passed. No unresolved validation finding. The tool-name search fix was checked against the explicit section keywords consumed by the search matcher; existing browser search behavior passed the focused E2E suite.

## Process cleanup and limits

E2E used isolated temporary databases sequentially on port 8791. Final-run owned server PIDs 27001 and 27426 exited (initial-run PIDs 10438 and 10763 also exited); port free after completion. Harness removed its temporary databases. No long-running process retained. Generated artifacts rebuilt through owners, no hand edits.

No unrelated full unit suite, provider calls, production smoke, live generation or export-fidelity run. Broad CI, deployment and live readiness remain separate delivery gates. No lint command exists in package scripts.

## Unresolved questions

None.
