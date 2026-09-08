# Font and model discovery

Status: DONE_WITH_CONCERNS

Implemented `server/discovery.ts`, shared discovery validators/catalogs and font loader, searchable font/model inputs, Settings and brief model controls. Parent owns route registration, environment mapping, Inspector/renderer integration and product docs; export worker owns font embedding.

## Contract

- Mount `discoveryRoutes` at `/api`: authenticated `GET /fonts`, authenticated session/API-token `GET /providers/:provider/models`. Model discovery rejects OAuth credentials independently of the parent middleware.
- Optional server `GOOGLE_FONTS_API_KEY` enables full Google catalog. Missing key or upstream failure returns explicitly labeled curated families. Keys stay server-side.
- Models use the account's saved encrypted provider key, existing `providerConfig`, and existing manual-redirect upstream transport. Official fixed endpoints only. Custom proxy credentials never forwarded to an official origin; custom model IDs remain accepted.
- Model cache: 64 entries, 10-minute TTL, key includes account/provider/encrypted credential/base URL digest. Font cache: four entries, 24-hour TTL. Requests limited to five model pages, 3,000 models, 4 MB per response, 10 seconds per upstream request. Font results capped at 5,000. Live cache misses use existing rate limiter.
- `FontPicker({value,onChange,label?,disabled?})`; `ModelPicker({provider,value,onChange,label?,placeholder?,disabled?,refreshKey?})`. Inputs search suggestions and permit custom values; stale provider responses are aborted/ignored. Settings refreshes discovery after saving credentials.
- `documentFontFamilies(doc)`, `googleFontsStylesheetUrl(families)`, `loadDocumentFonts(doc,target?)` from `src/shared/font-loading.ts`. System fonts skipped. Loader recognizes `style[data-studio-fonts-embedded]` with attribute equal to computed stylesheet URL; embedded exports make no external CSS request. Stylesheet/font waits are bounded; concurrent requests for the same stylesheet share its load promise.

## Verification

- `npm run typecheck`: pass, including CLI TypeScript.
- `npx tsx --test tests/discovery.test.ts tests/provider-capabilities.test.ts`: 11/11 pass.
- Tests cover official response adapters and headers/origins, opaque pagination query encoding, cache expiry/capacity/credential separation, font URL injection filtering, authenticated real-SQLite account isolation, OAuth rejection, custom-proxy fallback, missing-key fallback. No mocked successful upstream generation or real credentials used.
- `git diff --check` for owned files: pass.
- Shared review requested from `core_verification`; parent owns final build/browser suite.

## Official references checked

- [Google Fonts catalog](https://developers.google.com/fonts/docs/developer_api) and [CSS2 stylesheet API](https://developers.google.com/fonts/docs/css2).
- [OpenAI model list](https://developers.openai.com/api/reference/resources/models/methods/list).
- [Anthropic model list](https://platform.claude.com/docs/en/api/models/list).
- [Gemini model list](https://ai.google.dev/api/models).
- [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).
- [fal model search](https://fal.ai/docs/platform-apis/v1/models).

## Limits

Live credential-backed catalogs not exercised without real user credentials. Starter model suggestions preserve existing defaults and are explicitly unverified. Catalog membership does not establish generation-task compatibility. Pagination limits can return a labeled partial catalog; arbitrary IDs still accepted. Google Fonts helper loads the regular face so families without bold/italic do not invalidate the entire CSS request; browsers synthesize those styles. No new background server/process remains.

Docs impact: minor; parent should document optional Google Fonts key, discovery endpoints, fallback provenance, custom model support and font-loading limits in the existing provider/architecture owners.

Unresolved questions: none.
