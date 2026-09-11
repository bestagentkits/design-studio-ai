# Provider integrations

Status: complete in local worktree; live generation and deployment not verified

Outcome: real Gemini, OpenAI, LeonardoAI and Grok image generation; official DeepSeek text generation; multiple owner-scoped custom API connections with base URL and authentication selection.

Constraints: encrypted credentials; existing HTTPS origin allowlist; no provider success claimed without live credentials; preserve revisions, source ownership and OAuth boundaries.
Non-goals: unrelated media editing expansion, arbitrary response mapping or OAuth client registration for upstream providers.

- [x] Shared provider catalog, custom connection schema and additive migration
- [x] Official image adapters and Leonardo job polling; DeepSeek text transport
- [x] Settings, brief, editor, CLI, MCP, WebMCP and schema discovery
- [x] Owning docs and generated public references
- [x] Focused tests, typecheck, full tests/build, desktop/mobile browser verification and review

Acceptance: new connections persist without exposing secrets; correct endpoint/auth/payload per official API; unsupported capabilities fail explicitly; custom connections selectable by people and agents; owned image assets persist with correct MIME; async jobs retain isolation and completion reuse.

Sources: [Gemini generateContent](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [OpenAI images](https://developers.openai.com/api/docs/guides/image-generation), [Leonardo Phoenix](https://docs.leonardo.ai/v1.0/docs/phoenix), [Leonardo polling](https://docs.leonardo.ai/v1.0/reference/getgenerationbyid), [Grok images](https://docs.x.ai/developers/model-capabilities/images/generation), [DeepSeek](https://api-docs.deepseek.com/).

Verification: [delivery evidence](verification.md).

Shipping follow-up authorized: merge a reviewed PR to main and verify automatic production deployment. Live billed generation remains unverified.
