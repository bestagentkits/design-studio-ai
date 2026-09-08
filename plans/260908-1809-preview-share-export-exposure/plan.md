# Preview/share exposure

Status: Completed

## Outcome

Expose the existing real public snapshot and export behavior through the missing
names so agents can preview by URL and share through REST, CLI, and network MCP.

## Constraints

- Preserve `publish`, `unpublish`, and export contracts.
- Reuse the existing publication storage, asset isolation, ownership checks, and
  revision behavior; add no second snapshot model.
- Preview/share links are public immutable snapshots, not private unsaved-editor
  previews.
- Update executable documentation and focused tests with the contract.

## Non-goals

- No new database migration or expiring/private preview system.
- No browser WebMCP delivery tools; it operates on the open unsaved editor.
- No changes to export formats or renderer behavior.

## Acceptance criteria

- REST supports `POST/DELETE /api/projects/:id/preview` and
  `POST/DELETE /api/projects/:id/share`, returning the same snapshot URL shape
  and ownership/security behavior as publish.
- CLI supports `preview`, `unpreview`, `share`, and `unshare`, while existing
  commands remain unchanged.
- Network MCP advertises and executes `preview_project`, `unpreview_project`,
  `share_project`, and `unshare_project`; existing publication tools remain.
- Focused server/CLI tests cover URL creation and removal; docs list the live
  names and boundaries.
- Typecheck, focused tests, and build pass.

## Verification

- `npm run typecheck` passed.
- `npx tsx --test tests/server.test.ts tests/cli.test.ts` passed (17 tests).
- `npm test` passed (70 tests).
- `npm run build` passed, including public documentation generation.

## Files likely touched

- `server/projects.ts`, `server/index.ts`, `server/mcp.ts`
- `packages/cli/src/dsa.ts`, CLI README
- `tests/server.test.ts`, `tests/cli.test.ts`
- `src/app/documentation.tsx`, `docs/agents.md`, `docs/architecture.md`
