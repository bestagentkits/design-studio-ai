# Design review and validation

Date: 2026-09-07. This is a design review, not implementation verification.

| Perspective | Concrete failure | Required resolution and evidence |
| --- | --- | --- |
| Scope | Seven export names conceal empty or invalid files | Open actual outputs, validate page counts/content, distinguish configured integrations |
| Scope | Text generation presented as image/audio/video support | Typed capability routes and real provider calls per modality |
| Assumptions | Worker CPU/memory unsuitable for headless rendering/transcoding | Browser-side export and real renderer/encoder capability checks |
| Assumptions | WebMCP examples copied from obsolete API | Feature-detect current document surface; test against available browser |
| Integration | Different node schemas or response envelopes per client | Controller-owned shared schema and route contract; compile and contract tests |
| Failure | Human and agent overwrite each other after reading same revision | One atomic owner-scoped SQL conditional update; concurrent write test |
| Failure | Successful provider result overwrites edits made during request | Proposal plus revision-checked save; race and failed-request preservation tests |
| Security | Other-user asset/project/provider access | Authorize every object lookup and nested asset reference; two-account negative tests |
| Security | Imports/LLM text run script in authenticated origin | Escape text, allowlist node styling/URLs, parse imports, sandbox preview and CSP |
| Security | Published project changes reveal later private content | Frozen snapshot plus snapshot-specific asset exposure; edit-after-publish test |
| Security | Custom provider URLs become an SSRF proxy | Operator origin allowlist, reject/revalidate redirects, bounded requests |
| Security | OAuth code redeemed twice or for wrong client/resource | Atomic consume; PKCE, redirect, client and audience binding tests |
| Security | Token or BYOK values appear in settings/logs/export | Hash access tokens; encrypt provider secrets; redacted read/error payload tests |

The contract and four phases preserve the full requested scope. File ownership is non-overlapping: controller owns shared/client/infrastructure; frontend owns `src/app/**`; backend owns `server/**`, `migrations/**`, `tests/server*`; planner owns only these documents. Implementation test commands must be taken from the root manifest after the controller creates it; do not invent passing commands before a runner exists.

Current external references were checked against primary documentation: [MCP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [WebMCP draft](https://webmachinelearning.github.io/webmcp/), [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/), [Google Slides](https://developers.google.com/workspace/slides/api/guides/presentations), and [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Planning journal

The schema and API envelopes were sent to the controller before document polishing to unblock implementation. The controller accepted both and confirmed concrete file ownership and available Cloudflare deployment credentials. Research found that current WebMCP and MCP transports differ from common older examples; those findings were sent immediately for compatibility decisions. No user approval is pending. Provider and Google credentials remain configuration-dependent and must be audited through available live state rather than inferred.

Unresolved questions: no product decision blocks implementation. Exact provider media payloads and SDK-supported MCP versions must be settled against implementation dependencies before those capabilities are advertised.
