# Runtime backend evidence

Self-authored transparent PNG, two independent instances, each 64 bones and 32 attachments, 5,184 vertices and 10,000 keys in the shared rig workload. Scripts and JSON results live beside this report.

The original SVG spike measured synchronous DOM/layout work: p95 Chromium 187.3 ms, Firefox 415 ms, WebKit 2343 ms. That makes SVG inappropriate for the dense interactive workspace. Native WebGL submits textured triangles while retaining the shared evaluator. See runtime-spike-gpu-results.json for the latest rerun on this checkout.

These are CPU submission times in headless Playwright on the local macOS host, not end-to-end display FPS, GPU completion, or physical mobile-device results. There was no hardware-normalized comparison. The backend selection is supported; universal 60 FPS is not established.

Focused pixel tests verify texture orientation, transparent pixels and inverse/ordinary clipping on both Canvas2D and WebGL. Desktop/mobile browser workflow tests exercise deliberate WebGL context loss and native ZIP round-trip. More complex alpha-edge/mesh blend combinations remain appropriate regression additions; no claim of bit-identical output across all formats.
