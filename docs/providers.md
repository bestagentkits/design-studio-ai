# BYOK providers and media editing

Provider keys are saved per user through Settings or `/api/providers/:provider`. They are encrypted at rest and returned only as masked configuration. A key, model access, and sufficient provider quota are required for generation. These integrations call real provider APIs; they do not generate sample media when configuration is missing.

## Official and custom connections

Settings includes OpenAI (ChatGPT), Gemini, Anthropic, OpenRouter, fal, LeonardoAI, Grok (xAI) and DeepSeek. ChatGPT subscriptions are separate from OpenAI API credentials/quota. DeepSeek calls its [official Chat Completions API](https://api-docs.deepseek.com/) directly, with the default text model from the [shared provider catalog](../src/shared/providers.ts); it does not route through OpenRouter.

Choose **Add custom provider** to create multiple named connections. Each has a stable `custom-<slug>` ID, display name, HTTPS base URL including its API version path, default model and API format (`openai`, `anthropic`, or `gemini`). These formats mean OpenAI Chat Completions/Images, Anthropic Messages, or Gemini generateContent compatibility; arbitrary response mapping is not supported. Custom image generation requires OpenAI or Gemini format and a compatible image model. Select saved connections in the brief, editor or media provider picker.

Authentication choices are Bearer token, API key in a named header, HTTP Basic (credential is `username:password`), or no authentication. Credentials are encrypted at rest, including Basic credentials. Query-string credentials are not supported. Header names cannot override routing, cookies or transport framing. Official integrations retain fixed authentication; use a custom connection to select another method.

The operator must allow the custom origin in `PROVIDER_ALLOWED_ORIGINS`, for example `https://api.example.com`. The server validates HTTPS and the allowlist both when saving and before use; unlisted endpoints return `invalid_provider_url`. Keep the existing `ENCRYPTION_KEY` when applying the additive custom-provider migration. See [deployment and backups](deployment.md#backups-and-rollback).

`PUT /api/providers/custom-team` accepts the shared [provider settings schema](../src/shared/providers.ts):

```json
{
  "name": "Team gateway",
  "baseUrl": "https://api.example.com/v1",
  "protocol": "openai",
  "model": "your-model-id",
  "authMethod": "api-key",
  "authHeader": "X-API-Key",
  "apiKey": "<credential supplied securely>"
}
```

Omitting `apiKey` retains a saved credential for metadata updates. Changing the base URL, authentication method or credential header requires a new credential; switching to `none` clears it. Concurrent changes return `409 provider_conflict`; reread the connection before retrying. Metadata responses include `name`, `protocol`, `authMethod` and `authHeader` but only a masked `apiKey`. Account/API-key authorization is required; MCP OAuth and WebMCP do not manage credentials. They can use configured connections for generation.

```sh
dsa providers set deepseek --key-env DEEPSEEK_API_KEY
dsa providers set custom-team --name "Team gateway" --base-url https://api.example.com/v1 --protocol openai --model your-model-id --auth-method api-key --auth-header X-API-Key --key-env TEAM_API_KEY
dsa providers set custom-team --model another-model --keep-key
```

## Model and font discovery

Settings, the brief and the editor offer searchable model IDs through authenticated `GET /api/providers/:provider/models?q=...`. [Discovery](../server/discovery.ts) calls each provider's official catalog with the account's saved credential, bounds pagination, and caches results for ten minutes. Responses identify live, cached or fallback provenance. Missing credentials, custom proxy configuration or upstream failure use labeled starter suggestions and the saved model ID. Custom IDs remain accepted; catalog membership does not guarantee task compatibility or account quota. Custom proxy credentials are never forwarded to an official provider origin. OAuth agent tokens cannot access provider credential-backed discovery.

Google Fonts selection uses `GET /api/fonts?q=...`. Operators can configure server-only `GOOGLE_FONTS_API_KEY` to enable the full official catalog, cached for 24 hours. Without it, or when Google is unavailable, the picker identifies its curated Google-family fallback. Browser previews load selected families from Google's CSS2 service; isolated server exports embed bounded Google font responses before rendering. Regular faces are requested to support families without weight/italic axes; browsers synthesize those styles. Local system fonts are not fetched.

The shared response schemas, normalization, limits and fallback entries are owned by [discovery.ts](../src/shared/discovery.ts) and the server route, rather than an independently maintained model list here. Tests validate account separation, query filtering, pagination, credential transport and explicit fallback behavior. Live credential-backed catalog access remains a separate integration check.

## Supported operations

| Provider | Operation | Default model and source |
| --- | --- | --- |
| OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, custom | Create/edit a structured design document | User-configured text model; current document supplied as context |
| OpenAI | Image generation | `gpt-image-1`, prompt |
| Gemini | Image generation | `gemini-3.1-flash-image`, native generateContent image output |
| Grok (xAI) | Image generation | `grok-imagine-image-2.0`, base64 output |
| LeonardoAI | Image generation | Phoenix 1.0 model UUID, private async generation |
| Custom OpenAI/Gemini compatible | Image generation | Explicit image model override or saved default model |
| OpenAI | Image editing | `gpt-image-1`, owned PNG/JPEG/WebP uploaded as multipart `image[]` |
| OpenAI | Speech synthesis | `gpt-4o-mini-tts`, prompt is spoken text, optional voice |
| fal | Image generation | `fal-ai/flux/dev`, prompt |
| fal | Image transformation | `fal-ai/flux/dev/image-to-image`, owned raster image |
| fal | Text-to-video | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video`, prompt |
| fal | Image-to-video | `fal-ai/kling-video/v2.1/standard/image-to-video`, owned raster image |
| fal | Video editing | `fal-ai/kling-video/o1/video-to-video/edit`, owned MP4 |
| fal | Music/sound-effect generation | `fal-ai/stable-audio-25/text-to-audio`, descriptive prompt |
| fal | Audio transformation | `fal-ai/stable-audio-25/audio-to-audio`, owned MP3/WAV/OGG |

OpenAI image edits use its documented [multipart editing endpoint](https://developers.openai.com/api/reference/resources/images/methods/edit). Supported fal source transformations use the documented [FLUX image input](https://fal.ai/models/fal-ai/flux/dev/image-to-image/api), [Kling image input](https://fal.ai/models/fal-ai/kling-video/v2.1/standard/image-to-video/api), and [Kling video edit input](https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/api). The default text-to-video endpoint follows the [Kling 2.5 reference](https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v2.5-turbo-pro).

Stable Audio supports music and effects through [text-to-audio](https://fal.ai/models/fal-ai/stable-audio-25/text-to-audio/api), with [audio-to-audio](https://fal.ai/models/fal-ai/stable-audio-25/audio-to-audio/api) for source transformation. This is a prompt-driven generative model, not a speech voice selector or a deterministic waveform editor.

Native image calls follow [Gemini generateContent](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [Grok image generation](https://docs.x.ai/developers/model-capabilities/images/generation), and [Leonardo Phoenix](https://docs.leonardo.ai/v1.0/docs/phoenix). Leonardo generation is private (`public: false`); the server polls its [generation endpoint](https://docs.leonardo.ai/v1.0/reference/getgenerationbyid) and copies the completed image to the project's owned assets. OpenAI/Gemini/Grok base64 outputs are bounded and checked for PNG/JPEG/WebP signatures so JPEG is not mislabeled PNG.

## Request contract

POST `/api/projects/:id/media` accepts:

```json
{
  "kind": "image",
  "provider": "openai",
  "prompt": "Keep the composition and change the background to warm ivory.",
  "sourceAssetId": "ASSET_ID"
}
```

`kind` is `image`, `audio`, or `video`; `provider` is `openai`, `gemini`, `grok`, `leonardo`, `fal`, or a saved `custom-<slug>` ID. Gemini, Grok, Leonardo and custom image connections support prompt-only image generation; source editing remains available through OpenAI and fal. DeepSeek is a text provider for brief interviews and design proposals, not an image provider. Existing prompt-only requests remain valid. Optional fields are `model`, `voice`, `sourceAssetId`, `durationSeconds`, and `strength`.

- `sourceAssetId` selects an uploaded asset owned by the current user **and this project**. Cross-project references require copying/uploading into the target first. Omit it for prompt-only generation. Source type chooses the default model automatically.
- `durationSeconds` is an integer: 1–190 for Stable Audio, or 5/10 for the default Kling generation models. New prompt-only music defaults to 30 seconds. Audio edits keep the source duration when omitted. Kling O1 edits preserve source timing and reject a duration override.
- `strength` is 0–1 and applies only to fal source-image or source-audio transformations. It is rejected for prompt-only generation, speech, and video.
- `voice` applies only to OpenAI speech synthesis. fal music/effects are controlled by the prompt.
- Source-conditioned requests accept only the documented model for their input mode. Incompatible model/source combinations return actionable errors. Safe model overrides remain possible for existing text-driven image/video requests; the selected provider model must support the submitted prompt and expected output kind.

The server reads owned source bytes directly. OpenAI receives multipart bytes; fal receives a base64 data URI according to its documented file-input support. The source is not published or given a new publicly accessible application URL. Sending an edit request does send the selected media to the configured provider under that provider's data policies.

## Results and limitations

OpenAI image/speech, Gemini, Grok and custom image requests return `{asset}`. Leonardo image requests and all fal media requests return HTTP 202 with `{job:{id,status:"queued"}}`. Poll GET `/api/projects/:id/media/:jobId` for `queued`, `processing`, or `{status:"completed",asset}`. Polling supports all three media kinds. Saved completed results are reused; racing completion writes remove duplicate asset records/bytes. Failed or unrecognized upstream statuses return an error rather than waiting forever.

Assets remain separate from document nodes until explicitly placed and saved. Media generation does not overwrite the selected source or silently mutate the design document.

Sources and generated files are capped at 20 MB. Requests are capped at 4,000 prompt characters; generation is rate-limited to 30 attempts per user/IP in 15 minutes. Provider endpoints require configured HTTPS origins; redirects are rejected. Generated fal downloads must use `fal.media` or its subdomains; Leonardo downloads must use `cdn.leonardo.ai`. Downloads never receive provider credentials, and output MIME types must match the requested media kind. Raw provider diagnostics and keys are not returned to clients.

Kling O1 requires MP4 source clips of 3–10 seconds and 720–2160px resolution. The server enforces the media type and byte limit; the provider validates clip duration/dimensions. Convert unsupported source formats before uploading. A provider rejecting a data URI or its own model constraints yields an actionable failure; the application never publishes private media as a fallback. A model identifier existing in configuration does not guarantee account access or capacity.

## Verification

`tests/provider-integrations.test.ts` checks native request construction, auth methods, decoding, polling states and real HTTP redirect rejection. `tests/custom-providers.test.ts` checks encrypted connection updates, isolation and schemas against real SQLite. These are contract/local integration tests, not proof of live provider generation. `tests/provider-capabilities.test.ts` checks real request construction, source-to-model validation, forbidden download locations, actual SQLite project ownership, missing configuration, and reuse of persisted completed jobs. Tests do not stub successful provider responses or claim generated media without credentials. Run `node --import tsx --test tests/provider-capabilities.test.ts` and the shared server/CLI tests after route changes.

No live provider keys were available for this implementation task. Live creation/editing, music quality, and video output remain credential-dependent integration checks. The additional provider request formats were checked against the primary references above on 2026-09-10.
