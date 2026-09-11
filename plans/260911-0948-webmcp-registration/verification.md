# WebMCP registration repair

- Outcome: allow the browser host to register editor tools without exceeding its configuration limits; preserve all tools, payload formats, server authorization and revisions.
- Base: 66e6582. Branch: codex/fix-webmcp-registration.
- Cause reproduced in Codex in-app browser with the real registerDesignTools bundle on localhost: the original registry was rejected with the same configuration-limit error as production.
- Additional-tool metadata: 48 tools, 112445 bytes before; 48 tools, 24942 bytes after. The expanded operations input accounted for 63702 bytes including tool metadata; document-write input for 25946 bytes. Host exact limits were not exposed.
- Fix: shallow registration envelopes for operation items and nested documents. Operation names and array limits derive from the shared schema; document-write revision fields remain derived from documentWriteSchema. Full schemas remain available from studio_capabilities. Execution validators are unchanged.
- Native browser acceptance: reduced registry accepted; studio_capabilities and studio_apply_operations called successfully. Full built editor then registered its additional and editor-specific tools; studio_get_design, studio_apply_operations, studio_save_design and studio_api_get_projects_id succeeded against isolated local SQLite. Saved name and revision read back from server. Invalid nested document returned invalid_input; stale revision returned revision_conflict; reconciled full document write succeeded at revision 5.
- Checks: focused browser-design-tools regression passed; npm run typecheck; npm test (180 passed); npm run build:cli; npm run build; npm run test:e2e -- tests/studio-feedback.spec.ts --project=desktop (6 passed); git diff --check.
- Build retained existing large-chunk warnings. Generated docs and llms indexes rebuilt through normal build.
- Docs impact: minor; agent guide, public WebMCP documentation and product agent skill describe compact envelopes and canonical schema discovery.
- Owned registry and acceptance servers on port 8792 stopped; isolated data removed by the server wrapper. E2E runner cleaned its server. Generated unrelated E2E screenshots restored.
- Production has not been deployed or verified with this change. Deployment is the remaining step before resuming the existing landing-page project.
