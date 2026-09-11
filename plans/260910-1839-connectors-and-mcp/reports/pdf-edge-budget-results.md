# Remote PDF extraction budget — 2026-09-11

## Outcome

The actual `extractSourcePdf` implementation passed remote Cloudflare Workers acceptance for text extraction and configured rejection boundaries. This closes the absence of any remote PDF CPU observation; it does not establish peak memory, worst-case PDF complexity or the full Google/model workflow.

## Method

Deployed the isolated `design-studio-ai-beta-pdf-probe` Worker with the application's compatibility date, public-fetch flag and 30,000 ms CPU limit. The probe imports the real extraction function, requires a temporary bearer secret, bounds input before buffering and has no database, bucket, browser or provider credential bindings. Files were rendered locally from generated HTML using Chromium, whose process was closed in `finally`.

The successful measured sequence included one-page and twenty-page text PDFs, a twenty-one-page rejection, a text-free rejection and a byte-limit rejection. A separate twenty-page PDF was padded to exactly 2,097,152 bytes to exercise the accepted byte ceiling. Padding exercises input size, not adversarial content complexity. Extracted text contained the expected marker; the twenty-page cases returned 22,289 bytes of text.

## Results

| Input | HTTP | Worker CPU ms | Worker wall ms |
| --- | --- | --- | --- |
| 1-page text, 19,795 bytes | 200 | 93 | 100 |
| 20-page text, 34,226 bytes | 200 | 125 | 135 |
| 21 pages | 413 limit_exceeded | 2 | 2 |
| No extractable text | 422 unsupported_content | 3 | 4 |
| 2,097,153 bytes | 413 limit_exceeded | 14 | 38 |
| 20 pages padded to 2,097,152 bytes | 200 | 179 | 221 |

Read execution metrics from the [Cloudflare telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), filtered to the isolated probe's service. [Redacted measurements](pdf-edge-budget-results.json) preserve invocation times/statuses. CPU time excludes network waits; client-observed total elapsed time is not treated as CPU time. The largest upload took 15,478 ms end to end, while the Worker event recorded 221 ms wall time and 179 ms CPU.

An initial sequence encountered HTTP 401 during secret propagation after two successful cases; its runner incorrectly attempted to parse the plain-text authorization error as JSON. The corrected runner handles non-JSON errors and the complete subsequent sequence passed. No authorization check was bypassed or removed. Those initial events remain in the raw redacted measurements rather than being silently omitted.

## Limits and cleanup

These are individual representative samples, not percentile, load or worst-case guarantees. No peak-memory measurement is available from these event fields. The current 2 MiB, 20-page and 256 KiB extracted-text limits remain unchanged; no broader budget is justified by these samples. Google selection/account authorization and model latency require their separate live tests.

The temporary Worker and its secret were deleted after measurement. The application Worker, domains, stable encryption key and beta data were unchanged. Local secret material was removed. Probe source/config remain under reports/probes for reproduction; no remote process is left running.
