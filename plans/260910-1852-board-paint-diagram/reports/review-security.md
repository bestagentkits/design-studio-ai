# Security and isolation plan review

Scope: architecture, acceptance matrix, intake, contract research and current server/schema source. Planning-only review; no implementation, dependency audit, installation, tests, builds or servers. Phase files were not present when inspected. Applied the security skill's scoped STRIDE analysis; omitted unrelated scan stages.

## Findings

### 1. High — Public painting presentation must not grant raw editable-layer access by default

- **Plan location:** `architecture.md:80,94`; `acceptance-matrix.md:67`. Static exports have a reduced projection, but publication only promises snapshot-scoped bytes. The shared collector is proposed for both editable lifecycle and publication without a distinct public exposure policy.
- **Scenario:** An owner covers an image region with an opaque paint layer or a mask and shares the rendered artwork. Reusing today's publication pipeline exposes original layer tiles in the embedded canonical JSON and grants public byte access. A viewer can remove the mask or fetch underlying tiles even though the visible artwork conceals them. Snapshot ownership alone does not limit that exposure.
- **Source evidence:** `server/projects.ts:383-399` links every validated reference into `publication_assets`; `server/projects.ts:437-442` serves linked bytes without owner authentication. `server/projects.ts:467-471` removes speaker notes but otherwise forwards the document. `src/shared/render.ts:128-129` serializes the whole document into interactive HTML. `server/published-html.ts:7-11` is the owning viewer boundary.
- **Plan amendment:** Define a typed presentation projection separately from editable snapshots. Public Paint needs validated composited output and public playback resources, with no raw layers/masks/brush resources or unused assets unless editable-source sharing is an explicit separate action. Derive public asset grants from the projected payload, not the full private collector. Preserve interactive Board semantics that are intentionally public, including expandable mind maps; do not conflate a collapsed branch with private data. Add an artifact-level check that underlying masked pixels cannot be recovered from HTML or linked asset endpoints. Clarify the same distinction for HTML/React exports intended for sharing.

### 2. High — Resource preflight needs atomic admission and bounded execution, not only per-request estimates

- **Plan location:** `architecture.md:65,70,82-86`; `research/contracts.md:53` calls for concurrency quotas but does not specify admission/reservation semantics.
- **Scenario:** Several valid paint requests concurrently observe the same remaining storage budget, each starts a raster browser and stages tiles before CAS. Only one document commit wins, but every request has already consumed memory, CPU and retained staging storage. Repeated retries/conflicts can exhaust a self-host or browser-rendering allowance while the saved document remains within its 2,000-asset cap. A cleanup grace period increases the retained backlog.
- **Source evidence:** `server/projects.ts:110-112,159-178` limits one upload and persists it independently of document CAS; `server/projects.ts:87-100` performs CAS only on the document. `server/exports.ts:112-117` rate-limits then launches one browser per accepted request, and `server/exports.ts:138-154` has no explicit overall job deadline. `server/security.ts:107-132` counts attempts in a time window; it is not a concurrent-job or byte reservation. `server/index.ts:57-68` limits request bytes only.
- **Plan amendment:** Reserve projected staging bytes/assets and an execution slot atomically before expensive work. Count committed, staged, in-flight and retained-history storage; enforce both owner and installation-wide execution limits. Bound queue size and wall time, close/terminate canceled workers, release reservations in terminal paths, and expire abandoned reservations safely. Specify idempotent retry identity so a lost response does not restage/recompute the same job indefinitely. Verify simultaneous admission near quota and a conflict storm; the losing requests must not exceed the configured resource envelope.

### 3. Medium — Bind downgrade validation to the exact row revision used by the write

- **Plan location:** `architecture.md:40,70`; `acceptance-matrix.md:31`. The proposed stored-version check can still race if implemented immediately after today's row read while retaining today's caller-supplied CAS revision.
- **Scenario:** Stored project is v1/revision N. A v1 save supplies expected revision N+1, reads N, and passes a new stored-version guard. Another request upgrades to v2/N+1. The original UPDATE matches the supplied N+1 and overwrites v2 with v1. Future expected revisions are not currently rejected before validation. This is a same-owner integrity failure, not cross-owner access.
- **Source evidence:** `server/projects.ts:77-85` validates against a row read, but `server/projects.ts:88-96` binds the separate caller `expectedRevision`; no equality check with `row.revision` precedes the write. `server/collaboration.ts:11-16` reads and merges before a second read inside `saveDocument`, so version/merge-base decisions must likewise be attached to the revision ultimately committed.
- **Plan amendment:** Reject expected revisions unequal to the observed row revision before version/asset work, and CAS against that observed revision; alternatively enforce the version and revision predicates together atomically. Validate every supplied merge version before merge as already intended. Add a barrier-controlled interleaving check for v1 save versus v2 upgrade, including a future numeric revision. Do not weaken the accepted no-downgrade policy.

## Verified protections retained

Owner/project validation, additive migrations, reader-first rollout, trusted code-only raster execution, disabled renderer networking, decoded image/GIF budgets, and conservative committed-asset retention are already explicit. No recommendation to remove requested advanced Paint, animation, diagrams, devices or MIT/self-hosting support. GC's concurrent recheck requirement should be implemented as a real transaction/lease barrier, not a non-atomic last check before object deletion.

## Unresolved questions

None requiring a user round-trip for this plan review. Publication source exposure should be made explicit in the plan; the existing request requires rendered sharing, not automatic editable-source disclosure.

Status: DONE_WITH_CONCERNS
Summary: Three source-backed plan amendments cover public raw-layer disclosure, concurrent resource admission, and downgrade races.
Concerns: These are proposed-implementation hazards, not reproduced vulnerabilities in unimplemented Board/Paint code.
