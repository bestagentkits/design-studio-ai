# Provider integration review

Date: 2026-09-10
Scope: pending provider integration implementation before main shipping.
Status: DONE

No actionable correctness or security findings in the reviewed provider changes.

## Evidence

- `server/provider-connections.ts:29` scopes credential reads to the authenticated owner and revalidates the HTTPS origin allowlist before use. Metadata responses expose only the fixed mask.
- `server/provider-connections.ts:68` requires a fresh credential when its endpoint or authentication target changes; `:72` encrypts values, including Basic credentials, and clears the prior secret when selecting no authentication. Conditional writes at `:74` prevent a metadata update from restoring a concurrently rotated credential.
- `src/shared/providers.ts` rejects credential control characters and routing/framing/cookie headers. Custom origins require explicit operator allowlisting; this is the intended trust boundary.
- `server/providers.ts:46` rejects redirect responses without forwarding credentials. Provider failures return bounded generic errors.
- `server/providers.ts:273` records the selected async provider; `:301` scopes polling by job, owner and project. Completed results return before looking up credentials; concurrent completion retains one asset and removes duplicate bytes.
- `server/image-providers.ts` sets Leonardo generations private, restricts completed image URLs to its HTTPS CDN, filters Gemini thought images, and detects actual PNG/JPEG/WebP signatures. The download call at `server/providers.ts:324` sends no provider authentication.
- Custom text/image routing preserves the connection's selected authentication while dispatching through shared protocol builders. Unsupported source edits and media kinds fail explicitly.
- REST schema discovery, MCP, WebMCP, CLI, Settings, brief and editor changes include the new provider IDs and saved custom connection IDs. Owning docs disclose unsupported operations and lack of live generation verification.

## Fresh verification

- `node --import tsx --test tests/custom-providers.test.ts tests/provider-integrations.test.ts tests/provider-capabilities.test.ts`: 14 passed, 0 failed.
- `git diff --check`: passed.
- Reviewed existing browser provider test source; did not run a second E2E harness while the shipping controller owns that gate.

## Resolved concern

Search snippets still showed `deepseek-v4-flash`, but the directly opened [official pricing page](https://api-docs.deepseek.com/quick_start/pricing/) explicitly identifies `deepseek-flash` as the current model. The [2026-09-10 changelog](https://api-docs.deepseek.com/updates/) confirms the V4.1 release and replacement. Retain the implemented default. Also checked the current [Grok image request](https://docs.x.ai/developers/model-capabilities/images/generation), [Gemini image model](https://ai.google.dev/gemini-api/docs/image-generation), and [Leonardo polling endpoint](https://docs.leonardo.ai/v1.0/reference/getgenerationbyid) references.

## Limits

No provider secrets read and no billed provider calls made. This review verifies local contracts and source behavior, not live account/model access or exported provider-image fidelity. Main merge, full E2E rerun, deployment and production readiness remain the shipping controller's separate gates.

Unresolved questions: none.
