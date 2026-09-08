# Final cross-client review

Scope: design-system services/shared schema/browser library/MCP/CLI, discovery, browser tools, API reference/playground, font loading, and editor integration. Read-only source review; no source changes. Applied `ak-code-review`.

## Findings — resolved on re-review

1. **P2 — Capturing components drops render-critical content.** `src/app/design-system-library.tsx:43` captures only component/style/sizing/name. `src/shared/design-systems.ts:6` cannot represent source, text, or dimensions, and `:38` inserts every preset at 240×48 without source/text. Capture an Image component using a public HTTPS source at 500×300, save, then insert: result has no `src` and is 240×48. `src/app/design-component.tsx:29` consequently renders “Set an image asset”; Avatar loses its picture too. Verified with a direct `tsx` reproduction through shared schema and insertion. Preserve captured render content and dimensions through the shared preset contract, retaining the private-asset restriction; optional fields can keep existing presets compatible.

2. **P3 — Playground curl examples have no origin.** `src/app/api-playground.tsx:36` uses the browser-relative `requestPath` in the advertised CLI command. The initial command is `curl -X GET '/api/health' ...`; running it exits 3 with “URL rejected: No host part in the URL.” Use an absolute URL resolved against the application origin, with existing shell quoting. The text also says the command uses the environment key, while it actually emits a placeholder token; align the wording or use the documented environment variable.

## Resolution verification

- **P2 resolved.** `systemComponentSchema` now reuses optional node validators for `src`, `text`, `width`, and `height`; definition validation rejects private asset sources. The UI calls shared `captureSystemComponent`, and insertion retains those fields with compatible defaults. A fresh direct `tsx` assertion reproducing capture → schema → insertion passed for the original public Image source, text, and 500×300 dimensions. Additional assertions passed for rejection of private/published/javascript sources and invalid dimensions, plus application retaining authored source/text and filling only missing content. Real API regression coverage is being added by the core tester; not claimed run by this reviewer.
- **P3 resolved.** `src/app/api-playground.tsx:13` resolves the command URL against the browser origin (example origin for SSR); `:37` shell-quotes the absolute URL and emits a literal `$DESIGN_STUDIO_API_KEY` header reference. A fresh `renderToStaticMarkup(ApiPlayground)` assertion passed: output contains `https://studio.example/api/health` and the environment variable, and no `YOUR_API_KEY` placeholder.

## Verified nonissues and limits

- Owner and observed-version checks stay in shared server handlers; browser/API/CLI/MCP do not introduce alternate persistence contracts.
- Discovery uses owner/credential-separated cache keys, refuses official-origin requests for custom proxy credentials, and rejects OAuth credential access. `server/providers.ts:109–125` forces manual redirects and rejects non-success responses before response use.
- Browser tool upload delegates to the multipart adapter; schema parsing and normal server authorization still apply.
- Parent is running the full suite. This reviewer did not rerun it or claim provider/Google live success. No new processes started.

Status: DONE
Summary: Both reported defects resolved and focused reproductions pass. No outstanding findings in this review scope.
Unresolved questions: none.
