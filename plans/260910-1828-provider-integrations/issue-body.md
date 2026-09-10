## Problem
Users need native Gemini, OpenAI, LeonardoAI and Grok image generation, official DeepSeek text generation, and multiple custom API connections configured by base URL and authentication method.

## Acceptance criteria
- Native provider adapters and persisted asynchronous Leonardo jobs return owned media assets.
- Custom connections support named identities, protocol selection and Bearer/header-key/Basic/no-auth credentials with encrypted storage and server origin validation.
- Settings, REST, CLI, MCP, WebMCP, discovery and documentation share the updated contracts.
- Existing ownership, OAuth scope, revisions and source-editing behavior remain intact.
- Local tests and CI pass before main merge; production deployment is verified separately from live billed generation.
