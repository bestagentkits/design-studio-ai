---
title: "Phase 7: Add selected Drive sources and connected exports"
status: in-progress
---

# Add selected Drive sources and connected exports

Priority: P2. Status: in progress. Depends on: 2, 4, 5. Estimate: 5-7 engineering days.

Context: [plan](plan.md), [architecture](architecture.md), [evidence](reports/research-and-source-evidence.md).

## File ownership

**Read:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/google-slides.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/export-page.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/projects.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/providers.md`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/docs/deployment.md`

**Modify:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/google-slides.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/exports.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/types.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/node.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/index.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/editor.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/compose.yaml`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/shared/api-reference.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connections-settings.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/connector-source-picker.tsx`

**Create:**

- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/google-auth.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/google-drive.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/server/connectors/google-content.ts`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/google-drive-picker.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/src/app/google-drive-destination.tsx`
- `/Volumes/GOON/codex/worktrees/d5cf/design-studio-ai/tests/google-drive-connector.test.ts`

## Outcome and requirements

Connect multiple Google accounts, select source files with Picker, retain provenance and save real PDF/PPTX files or supported native Slides results through a stored connection. Preserve the existing accessToken-based Google Slides route during transition. Import scope is explicit in architecture.md; no promise of whole-Drive search, arbitrary Office fidelity or OCR.

## Implementation steps

1. Add server-side Google authorization-code flow with session-bound state/PKCE where supported, account identity validation, offline credential handling and refresh/revoke races. Use separate connector settings if needed to avoid accidentally reusing broader legacy grants. Record the exact public/self-host callback/consent configuration without storing secrets in docs.
2. Use drive.file + Picker for user-selected/app-created files and folders. Verify actual per-method scopes, including Slides create/batchUpdate, against official docs. Do not request drive.readonly or whole-Drive scope to compensate for picker bugs. A selected folder does not automatically authorize every existing descendant file.
3. Implement the narrow in-memory Picker access-token exchange described in architecture.md. No refresh token is returned; server operations use stored connection credentials. Validate the returned file ID through the selected connection on the server, since the browser selection alone is not authority.
4. Fetch bounded metadata/content and convert Google Docs to text; support UTF-8 Markdown/text/JSON, supported images and text-based PDF extraction. Select a PDF extractor compatible with Node and Workers under measured byte/page/CPU limits. Detect unsupported/encrypted/scanned PDFs; report no extractable text rather than inventing content. Record source version/hash and extraction version.
5. Import image bytes through existing asset isolation. Never change Drive sharing to make a private image public. Persist immutable source snapshots and expose refresh/removal with the shared brief/revision behavior.
6. Reuse real PDF/PPTX export bytes and upload to a user-selected writable folder as new files. Show account/folder/filename/format/local revision before approval. Preallocate/provider-tag remote file identities where supported and persist them for reconciliation. Test Drive errors, denied folder access and partial upload; avoid duplicate file creation after timeout.
7. Refactor native Google Slides conversion into a shared internal operation accepting a server-resolved credential, while retaining the legacy route's behavior. Native Slides still rejects unsupported nodes/private-image cases; offer explicit PDF/PPTX alternatives. Do not automatically publish media or promise editable parity.
8. Record created presentation identity before subsequent batch updates. If content population fails, show partial presentation state and safe retry/reconciliation options. Do not create a second presentation blindly.
9. Add account/file/folder picker and export UI, error/reconnect paths and shared capability/reference entries. Browser OAuth compatibility and provider acceptance are separate tests.

## Todo

- [x] Implement stored Google connection lifecycle and safe Picker bridge.
- [x] Implement selected file ingestion with bounded extraction/provenance.
- [x] Upload actual PDF/PPTX bytes with durable remote identity.
- [x] Add connection-backed Slides conversion without breaking legacy export.
- [ ] Verify multi-account isolation and partial export recovery.

## Validation and success

Run `node scripts/build-renderer.mjs`, then `npx tsx --test tests/google-drive-connector.test.ts tests/export.test.ts tests/exports-agent-formats.test.ts` and `npm run typecheck`. Extend `tests/connectors-ui.spec.ts` for picker/account/export states using isolated browser test data.

Live acceptance requires a designated Google test account and consent configuration: pick a real Docs/text/PDF/image source, inspect extracted content, upload PDF/PPTX and inspect downloaded file bytes, create/open a supported Slides presentation, disconnect/revoke and confirm further reads fail. Record file IDs privately as needed; never post private contents. Verify real Picker account matching and non-expanded scopes.

## Risks and rollback

Google consent verification, client configuration, popup restrictions and PDF runtime limits are explicit dependencies. Keep adapter disabled when unconfigured, preserving existing export paths. Disconnect does not delete remote files; source cleanup and remote artifact cleanup are separate explicit actions.
