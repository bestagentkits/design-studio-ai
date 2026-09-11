# Browser validation — 2026-09-11

The current connector matrix passed **8/8** on Chromium desktop, Chromium mobile, Firefox desktop and WebKit mobile: two scenarios per configuration.

1. Settings pending setup survives reload, cancelled bearer input is not persisted in metadata, disconnect changes state and further discovery fails.
2. Actual public Cloudflare documentation MCP connects with no credentials. Project discovery and selection work; multiline edits preserve newlines and increment policy revision. Prepared operation survives browser refresh, requires explicit approval and executes once with a successful remote result. Finally disconnect and delete the isolated project.

Executable owner: [connectors-ui.spec.ts](../../../tests/connectors-ui.spec.ts). The public endpoint test requires explicit `CONNECTOR_LIVE_MCP=true`; no server responses are mocked. Reproduction command is in [verification](verification.md).

The full default release browser run also passed Chromium desktop 31 tests and mobile 30 tests. It skipped the two connector scenarios per configuration because that run did not enable connectors/live networking, plus one pre-existing mobile keyboard scenario. The separate enabled matrix above is the connector evidence. CI now enables connectors for its local Settings scenario; the external public endpoint remains opt-in.

Limits: this does not establish live Google Picker, native account export UX, a real model chat approval loop or every browser interaction. No credential-bearing trace/screenshot is published. E2E-owned port 18843 and temporary server processes exited after each run; unrelated listeners were untouched.

After the enabled full-suite CI exposed header overlap and Settings ordering, `e1c57dd` fixed both without weakening assertions or registration limits. The complete enabled suite now passed locally and in CI: 32 desktop + 31 mobile, with only the public-network opt-in and existing mobile keyboard skips. Chromium mobile/WebKit public MCP scenarios were rerun after the fix and passed 4/4.
