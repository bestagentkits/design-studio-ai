# Paint CPU feasibility evidence

Status: historical initial runtime evidence; not full Phase 01 acceptance or production painting. Later cache/paged transaction implementation and measurements supersede the initial missing-paging observation below; see [current execution evidence](implementation-progress.md).

## Implemented and checked

- `src/shared/paint-runtime.ts`: pure browser/server-compatible CPU runtime; sparse 512x512 RGBA tiles, dimensions up to 4096, up to 24 layers. No DOM, GPU or dependencies.
- `src/shared/paint-pixels.ts`: algorithm `cpu-srgb-grain-v1`. Interchange uses straight-alpha sRGB bytes; source-over and brush pickup calculate premultiplied channels in sRGB, then unpremultiply/quantize to bytes. This is specified digital mixing, not linear-light or physical pigment simulation.
- Actual seeded spatial grain, circular coverage, pressure-controlled radius, path-distance spacing across input segments, flow/opacity/deposit. Pickup samples the original target-layer generation before each stamp and carries color forward; it never samples partially committed draft pixels.
- Layers have independent pixels, ordering, opacity, visibility and locking. Normal source-over only.
- Input validation precedes pixel mutation. Copy-on-write stroke staging preserves committed state on rejection. Defaults: 64 resident tiles (64 MiB), explicit maximum 256 (256 MiB). Temporary copied dirty tiles can double that resident allocation during a stroke. The cap covers all layers.
- At most 10,000 points/stamps and estimated 8,000,000 pixel iterations per command. Allocation, coordinates, settings and seed are bounded. No-op pressure/deposit allocates no tile.
- `npx tsx --test tests/paint-runtime.test.ts`: 5 passed. Tests independently assert known source-over pixels, sparse allocation, pressure/seed differences, spacing, blue pickup transport versus red overdraw, zero deposit, lock rejection, invalid numbers and atomic memory-limit rejection.

## Not established

No frame/input latency or physical desktop/iPad measurements. No Pencil tilt/palm input proof. No benchmark claim for 2048²/12 layers or 4096²/24 layers; fully painted desktop input requires 1536 tiles, exceeding this intentionally bounded resident prototype. Eviction/persisted loading is not implemented. No worker deadline/cancellation/context-loss integration.

Brush images, taper/tilt, erasing, groups, blend modes beyond normal, masks/clipping/alpha lock, fills/selections, serialization/assets, undo, uploads/CAS/receipts, revision recovery, exports, and REST/MCP/CLI/WebMCP remain unimplemented. Opacity currently applies per stamp, not a single group-opacity pass over an entire gesture. Pickup uses center samples from the target layer, not the merged visible surface. No production public contract or UI is enabled.

Unresolved questions: device performance, eviction/storage budgets, advanced layer/brush implementation and durable recovery must be established before adoption beyond this bounded probe.
