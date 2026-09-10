## End-to-end work summary
Adds native Gemini, OpenAI, LeonardoAI and Grok image generation, official DeepSeek text generation, and multiple custom provider connections. Users configure a name, base URL, API format and authentication method in Settings or the CLI; generation and discovery use the same server-validated connections across REST, MCP and WebMCP.

## Subagent delegation
One independent code reviewer completed the review: no actionable correctness/security findings; 14 focused tests passed. An initial reviewer could not start because its configured model was unavailable; it was replaced without changing source.

## Technical decisions
- Keep credentials encrypted, owner-scoped and masked. Endpoint/auth changes require a replacement credential; conditional updates reject concurrent credential overwrites.
- Preserve the operator HTTPS origin allowlist and reject redirects before credentials can be forwarded. Custom connections support OpenAI, Anthropic or Gemini formats and Bearer, header API key, Basic or no authentication.
- Persist asynchronous Leonardo jobs and store completed images as owned assets. New Gemini/Grok/Leonardo/custom image adapters support prompt-only generation; existing OpenAI/fal editing remains intact.
- Add migration `0009-custom-providers.sql`. Preserve the existing `ENCRYPTION_KEY` during deployment. Source version is 0.3.1; published 0.3.0 download links remain unchanged until archives are separately released.

## Deviations from plan
The original implementation task ended at local delivery. The follow-up explicitly authorizes main merge and production deployment verification. Shipping preflight also made the E2E provider origin self-contained and aligned version/schema assertions with the new contracts.

## Completion evidence
- Local acceptance evidence and review: [verification record](plans/260910-1828-provider-integrations/verification.md).
- Typecheck and production build pass; 157 unit/integration tests pass. CLI and skill archives package successfully.
- Browser coverage: Chromium desktop/mobile plus focused Firefox desktop and WebKit mobile provider workflows. Full default-harness E2E: 31 desktop and 30 mobile tests passed; one existing desktop-only test skipped on mobile.
- Public docs, OpenAPI/schema, CLI, MCP/WebMCP and generated llms references are synchronized.
- Screenshots: [desktop Settings](plans/260910-1828-provider-integrations/provider-settings-desktop.png), [mobile Settings](plans/260910-1828-provider-integrations/provider-settings-mobile.png).
- CI: pending. Live billed provider generation was not run; local contracts do not establish model access or quota.

## Checklist
- [x] Implement requested providers and custom connections.
- [x] Preserve authorization, credential and revision boundaries.
- [x] Update owning docs and generated references.
- [x] Pass typecheck, unit/integration tests, build and packaging.
- [ ] Complete PR CI and main deployment verification.

## Human actions required
To use a custom endpoint, the operator must add its exact HTTPS origin to `PROVIDER_ALLOWED_ORIGINS`; users supply their own credentials and accessible model IDs. No credentials are needed to review or merge this change.

## Linked Issues
Closes #12

## Ship Mode
- Mode: official
- Target: main
- Writing language: en (source: default; fallback: none)
