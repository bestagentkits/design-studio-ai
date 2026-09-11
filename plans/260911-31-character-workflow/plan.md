# Character workflow completion — issue #31

Status: in progress

Outcome: deliver every tracked P0/P1/P2 section of #31, deploy, and verify the real Mochi workflow through WebMCP and reopened GLB artifacts.
Constraints: no AK skills; shared contracts across UI/REST/MCP/WebMCP/CLI; preserve existing documents, private projects and credentials; actual geometry and rendering; additive persistence changes. Retopology evaluation must not misrepresent triangular remeshing as anatomical quads.
Non-goals: paid generation providers, publishing private projects, unrelated feature expansion.

## Work and acceptance
- [ ] Durable operation lifecycle: owner-scoped save/export IDs, idempotency, progress, recovery, artifacts, all clients. Test uncertain response and restart/concurrent retry.
- [ ] Shared skeleton resource, explicit legacy conversion, compatible binds and export reuse. Compare pose and actual GLB counts.
- [ ] Named clip editor and commands: loops/blend/speed/amplitude/rest pose, deterministic boundaries, undo and export parity.
- [ ] Viewport rig handles and weight brushes with locks, normalization and rest/pose separation.
- [ ] Persistent IK/stance constraints, pole/limits/ground transforms, baked export; measure contact error.
- [ ] Structured clickable diagnostics with regions/times, before/after and full-animation/multi-angle agent operations.
- [ ] Sculpt/refinement/edge loops with preserved weights/UV/morphs and original recovery. Document anatomical quad-retopology evaluation.
- [ ] Seam editing, distortion checker, texture layers and normal/roughness maps, resource limits and export verification.
- [ ] Contract/docs/discovery parity and focused plus broad tests, cross-browser UI, review.
- [ ] PR exact-head CI, merge/deploy verification, live Mochi demonstration, close #31 with evidence.

## Current inspection
Baseline main includes #23/#30. Creative saves already have transactional receipts but only for v2 painted documents; generalize rather than duplicate. Existing exports execute inline. Existing attachment data copies bones/tracks, so sharing must be explicit and verify identical legacy animation before deduplication.

## Progress before integration

Implementation now covers durable jobs/queue/CLI/MCP/browser recovery, shared rig references and skin export deduplication, clip controls, joint/brush tools, contacts, structured diagnostics, checkpoints/plane cuts, layered PBR maps and four-angle PNG export. Owning docs and generated public content updated.

Verification: full unit/integration suite 319/319 passed. Focused geometry/job/export roundtrip set 18/18 passed, including world transform preservation and GLB foot-position comparison. Typecheck/build pass. UI regression found and fixed a mobile Operations overlay and duplicate React sibling keys; re-running affected UI before claiming acceptance.

Cloudflare queue `design-studio-operations` created; new code not yet deployed. Current branch needs integration of origin/main PR #34 (local JSON recovery). No feature commit or PR yet.

Pending hook confirmation: privacy hook falsely parsed SQL context `c.env.DB.prepare(...)` as a secret filename. User asked asynchronously to approve the `server/projects.ts` receipt-retention SQL edit. That specific patch has NOT applied; do not retry until approval. Other work continues. Current code exempts all `job-` receipt IDs; intended fix exempts only IDs belonging to real operation_jobs rows.
