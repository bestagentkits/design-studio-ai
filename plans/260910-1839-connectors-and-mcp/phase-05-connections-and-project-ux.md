---
title: "Phase 5: Complete the MCP-first human workflow"
status: in-progress
---

# Complete the MCP-first human workflow

Priority: P2. Status: in progress. Depends on: 2, 3, 4. Estimate: 4-6 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/settings.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/app.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/api.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/keyboard-navigation.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/authenticated-browser.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/playwright.config.ts`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/settings.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/app.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/api.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/guide.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/documentation.tsx`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connections-settings.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/project-connections.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connector-source-picker.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connector-operation-dialog.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/agent-run-activity.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connectors.css`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/connectors-ui.spec.ts`

## Outcome and requirements

Deliver the first usable milestone: add remote MCP, authenticate, choose tools for a project, use in chat, inspect an action, approve/deny, reload/resume and disconnect. Native provider tiles show configuration availability and do not pretend their adapters already exist.

## Implementation steps

1. Add Settings Connections separately from Account sign-in, BYOK Providers and incoming Agent Access. Show multiple named connections, remote account/host, status, last verified time, granted capability summary, reconnect and disconnect. Avoid a single ambiguous green Connected badge.
2. Add URL/auth setup, safe token entry, OAuth redirect and return intent. Store only bounded non-secret continuation state; restore the originating project/action after callback. Show app-not-configured, denied, expired, unsupported version and organization-approval states with concrete recovery.
3. Add project binding/tool selector with local trust/permission labels and explicit controls. Default custom tools off until selected. Server annotations may be shown as server claims, never as Studio safety certification. Allow source/resource selection with preview, MIME/size, origin and update time.
4. Add source snapshot list and refresh/remove actions. Explain disconnected snapshots, copy-versus-reference behavior, unsupported/scanned file limits and whether data will be sent to the selected AI provider. Refresh does not silently replace approved brief content.
5. Integrate run activity into existing conversations: model step, server/tool name, approval required, result/error, source links, cancellation and resume. Never expose raw secrets/private payloads in telemetry or unsolicited UI debugging output.
6. Implement exact approval dialog: account, server, project, action, destination, structured arguments/native diff and relevant revision. Support allow once/deny and separately managed narrow read grants. Unknown custom operations require review. Pending approvals expire; changed arguments/tool policy require a new prompt.
7. Preserve unsaved document edits when a run completes. Show proposal compare/apply through existing revision behavior; do not replace current canvas on tool result. Restore focus to invoking control; maintain mobile panel/keyboard behavior and accessible progress announcements.
8. Add a user-facing connection/operation detail view reachable through human setup/approval links generated for CLI/MCP. The link navigates to a session-protected action; it is not a bearer approval credential.

## Todo

- [x] Implement accessible Settings connection lifecycle and OAuth return state.
- [x] Implement per-project tools/sources and provenance views.
- [x] Implement run activity, resume/cancel and exact action approval.
- [ ] Preserve unsaved edits and proposal/save behavior.
- [x] Verify desktop, mobile, Firefox and WebKit interactions. See [current verification](reports/verification-260911-1539-plan-completion.md) for tested scenarios and limits.

## Validation and success

Build first with `npm run build`, then `npm run test:e2e -- tests/connectors-ui.spec.ts --project=desktop` and repeat with `--project=mobile`. Install Firefox/WebKit when needed; run `STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/connectors-ui.spec.ts --project=firefox` and repeat with `--project=webkit`.

Use isolated accounts, real local persistence and a controlled MCP peer, never production smoke. Cover OAuth popup-blocked/cancelled/full-page fallback, missing provider configuration, long capability lists, keyboard/focus, 390px layout, disconnect during approval, refresh during a run, denied action and same-named tools on two accounts. Report browsers actually run; emulation is not physical-device evidence.

## Risks and rollback

Settings/editor are large shared integration files; extract only connector boundaries rather than unrelated refactoring. Server-side feature disable must also hide entry points and preserve existing settings/editor flows. Do not treat client-side tool filters as permission enforcement.
