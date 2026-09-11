# Verification — 2026-09-11

Current implementation is based on `f114988`; this report records observed checks, not a production release.

| Check | Observed result |
| --- | --- |
| TypeScript + CLI typecheck | Passed, including final form fixes |
| CLI build | Passed |
| Full unit/integration suite | 367 passed, zero failures |
| Application / renderer / public docs build | Passed; existing document-view dynamic import warning |
| Design skill packaging | Passed |
| Workers beta dry-run | Passed; no deployment implied |
| Local D1 migrations 0001–0017 | Passed, existing project retained, zero FK violations |
| Local workerd PDF + RSA | Passed with real rendered PDF and key signing; CPU not measured |
| Connector browser scenarios | 8/8: Chromium desktop/mobile, Firefox desktop, WebKit mobile |
| Public MCP endpoint | Real discovery + documentation search, negotiated 2026-07-28 via Node pinned transport |
| Full release browser suite | Chromium desktop 31 passed / 2 skipped; mobile 30 passed / 3 skipped. Connector-disabled and opt-in live tests skipped in this default run; separate enabled 8/8 matrix passed. |

The opt-in public MCP browser scenario uses no remote fixture or mocked fetch. It creates isolated local account/project data, connects the public documentation endpoint, discovers/enables a tool, edits a multiline selection, prepares an action, refreshes, approves once and executes. It checks one succeeded operation, then disconnects and deletes its project. Both scenarios passed on all four configured browser/device projects. It does not test a paid model or a remote write.

Reproduce the connector matrix:

```sh
E2E_PORT=18843 CONNECTORS_ENABLED=true CONNECTOR_LIVE_MCP=true STUDIO_CROSS_BROWSER=1 npm run test:e2e -- tests/connectors-ui.spec.ts --project=desktop --project=mobile --project=firefox --project=webkit
```

Runtime probes:

```sh
node plans/260910-1839-connectors-and-mcp/reports/probes/connection-persistence-runtime.mjs
node plans/260910-1839-connectors-and-mcp/reports/probes/native-content-runtime.mjs
```

The E2E harness owns its temporary database and port and shuts the server down after tests. Public endpoint availability is external; this opt-in test is not silently treated as a deterministic CI gate.

## Review and unresolved evidence

Reviewed authority guards, exact approval/claim, immutable export artifacts, GitHub user-installation-repository intersection, signed webhook replay, source asset races, client parity and UI state. Resolved findings are in [implementation progress](implementation-progress-2026-09-11.md). No independent reviewer or universal security certification is claimed.

Required live acceptance remains: designated GitHub App/repository; Google OAuth project, Picker and Drive folder; a permitted model/tool loop; real remote write and external OAuth recovery. Beta currently lacks native connector settings. Those are unverified, not passing tests. See [release readiness](release-readiness.md).
