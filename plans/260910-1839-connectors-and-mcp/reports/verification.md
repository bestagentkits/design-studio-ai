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

## Enabled full-suite regression and correction

CI run 34571677384 at `085732a` passed typecheck, 367 tests and build but failed browser verification; deployment was skipped. Enabling connectors exposed a Settings End-key ordering regression and mobile header overlap. The failed desktop test restarted its worker and contributed to a later signup rate-limit failure; the rate limit and assertions were not changed. Commit `e1c57dd` keeps Your account last and moves the mobile connector entry out of the crowded header. Focused enabled navigation/workspace/Settings checks passed 5 desktop and 5 mobile tests, with the opt-in external case skipped. Full CI subsequently passed on the correction.

After `e1c57dd`, the complete local release browser suite with CONNECTORS_ENABLED=true passed: desktop 32 passed / 1 opt-in live skip; mobile 31 passed / 1 opt-in live skip plus the existing keyboard skip. The public MCP flow was rerun on Chromium mobile and WebKit mobile after the layout fix: 4/4 passed. Cloudflare remote preview of the actual application transport/client also passed public discovery/search (2026-07-28, 2,038 text bytes).

Final exact-code CI: [34572237146](https://github.com/bestagentkits/design-studio-ai/actions/runs/34572237146), SHA `e1c57dd68f0398f69240cabb622f1e2f92c8a353`, success. CI confirmed 367 tests, desktop 32/33 (one opt-in skip), mobile 31/33 (opt-in plus existing keyboard skip), all builds/packages and beta deployment. See [release readiness](release-readiness.md) for active Cloudflare version, migrations and direct live checks.
