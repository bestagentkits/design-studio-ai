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

Cloudflare queue `design-studio-operations` created; new code not yet deployed. Feature commit ed5b864 and merge 7bc6706 include main PR #34 (local JSON recovery). Follow-up verification fixes remain uncommitted; no PR yet.

Pending hook confirmation: privacy hook falsely parsed SQL context `c.env.DB.prepare(...)` as a secret filename. User asked asynchronously to approve the `server/projects.ts` receipt-retention SQL edit. That specific patch has NOT applied; do not retry until approval. Other work continues. Current code exempts all `job-` receipt IDs; intended fix exempts only IDs belonging to real operation_jobs rows.

## Follow-up verification

- Scene flow passed desktop Chromium, mobile Chromium, Firefox and mobile WebKit. Full desktop/mobile E2E in progress; legacy save waiters and schema inventory expectations updated to the new job contract.
- Independent scene review: no blocking findings, 17/17 geometry and real GLB roundtrip tests passed. Job review found a stale-lease input-read race; worker now renews/checks lease before side effects and the forced lease-theft regression passes.
- Real Mochi revision 9 backed up privately outside the repository. Local candidate preserves the original page, converts 76 tracks to 7, adds a recoverable shoulder refinement and authored maps. JSON float roundoff required tolerance below 1e-9 in compatible-rig comparison; differing clip tags/mute still reject.
- Candidate GLB: 2,100,480 bytes, 25 meshes, one 22-joint skin, four animations with 61 channels each; normal and roughness maps embedded. Baseline 9,686,136 bytes, 24 skins, 1,130 channels per clip. This is local candidate evidence, not a production claim.
- Cached immutable mesh topology makes the candidate 25-pose full scan complete in 5.60s, 382,745-byte compact output, zero warning samples, maximum edge stretch 1.9655. Informational seams appear only in the first frame. Contact samples: active error <1e-12; maximum foot-joint penetration 0.00205 scene units over 49 walk samples.

The pending receipt-retention SQL narrowing is an optional storage-policy refinement: current code conservatively retains all job-prefixed receipts, preserving recovery. It is not a dependency of the implemented lifecycle or production acceptance; do not apply that blocked edit without permission.

## Main integration and UI verification

Main PR #35 integrated at e456d39. All 333 unit/integration tests, typecheck, build and skill packaging passed. PR #36 opened. Desktop Paint, public docs, keyboard and diagram rechecks passed; Character Motion passed unchanged on isolated retry after a single connection reset. Mobile checks found a real header overlap after adding Operations; a wrapping two-row mobile header and labeled compact Operations icon fix it. Independent review found no blockers; affected UI rerun remains in progress. The superseded CI run was cancelled before merge.

Header fix verification: typecheck/build/skill packaging passed; mobile thumbnail 2/2, studio feedback 6/6, keyboard 3 passed/1 existing skip, scene authoring 1/1 on unchanged isolated retry after one export-click timeout. Other mobile rechecks passed. Local transient connection/export timing failures are recorded, not removed from assertions; final CI must run the complete suite.
