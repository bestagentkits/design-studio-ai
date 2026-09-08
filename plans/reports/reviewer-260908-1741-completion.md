# Completion review

Status: DONE_WITH_CONCERNS

- P1 — src/app/design-system-library.tsx:13,21. Choosing an entry copies its cached definition, then fetches a separate latest version list. Saving uses versions[0].version rather than the revision of that definition. If another client creates v2 after the list originally loaded v1, opening v1 fetches versions [2,1], and saving silently creates v3 from stale v1 with expectedVersion2. The server CAS is correct but the client supplies a revision whose content was never read. Keep the loaded-definition revision as the write precondition; make historical-version restore explicit.
- P2 — src/shared/design-systems.ts:42-44. Wrapping a legacy composition in a new absolute frame shifts top-level nodes while nested descendants with legacy page-space coordinates stay unmoved. Verified using actual insertSystemItem + resolveLayout: original parent(100,100), child(120,120); wrapper(40,40) yields parent(140,140), child(120,120), instead of child(160,160). Normalize legacy coordinates/hierarchy when inserting the composition.

Discovery q filtering issue found in server/discovery.ts and the MCP forwarding tools is already assigned to timeline_mesh_ui; avoid duplicate work. No additional concrete authorization or credential-routing regression found in inspected services: design-system reads join owner, version writes CAS in the INSERT, project mutations reuse saveDocument, custom provider endpoints never forward their credential to an official origin, and browser tools use documented relative paths with same-origin sessions.

Review was read-only for source. No full-suite or live provider assertions made. Parent received actionable findings during review.

Unresolved questions: none.
