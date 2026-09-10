# Performance boundaries

Use runtime-spike-gpu.mjs and its JSON for current CPU submission p95. This release enforces schema budgets, 300 exported frames/64 megapixels, 32 MiB native ZIP input/64 MiB declared expansion, bounded streaming JSON decompression, finite accumulated transforms, 20k-key bake limits, and a bounded physics cold-seek work estimate.

Desktop/mobile full frame p95, startup p95 and physical-device cold-seek p95 remain unmeasured. Mobile Playwright verifies responsive workflow, not handset GPU speed. Do not advertise the planning targets as measured guarantees. Dense 3D compositions use the existing SVG layer adapter and may cost substantially more than the standalone character WebGL workspace.
