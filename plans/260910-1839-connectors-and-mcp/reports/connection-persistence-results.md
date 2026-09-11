# Connection persistence in local workerd and D1

Observed 2026-09-10. Independent bounded review and executable check of the connector migration, connection store and credential store. No concrete defect found in the exercised scope.

## Reproduce

From the repository root with existing dependencies installed:

```sh
node plans/260910-1839-connectors-and-mcp/reports/probes/connection-persistence-runtime.mjs
```

The [probe](probes/connection-persistence-runtime.mjs) bundles the **actual server helpers** into a local workerd module and calls them through `Miniflare.dispatchFetch`. Helpers use native local D1 and Web Crypto, with a fresh random encryption key held only in memory. Test records and tokens are isolated values; there are no real accounts, provider calls or remote databases. Miniflare persistence is disabled by default, and the runtime is disposed in `finally`; no detached process is started. Both completed runs exited 0.

Runtime: Node v25.2.1, installed Miniflare/local workerd, compatibility date `2026-09-07`, `nodejs_compat`. Bundled probe size: 446,549 bytes. This is local D1 compatibility evidence, not a deployed Cloudflare account or production concurrency benchmark.

## Verified results

| Case | Observed result |
| --- | --- |
| Existing-database upgrade | Applied migrations 0001–0009, inserted isolated existing users/project, then applied 0010; document bytes and project revision 7 preserved |
| Actual helper create/store/read | Connection created; encrypted credential round-trip passed; ciphertext did not contain the access-token value |
| Ownership | Other owner read returned `connection_not_found`; other owner list remained empty |
| Concurrent helper refresh claims | Two concurrently dispatched requests returned 200 and 409 (`refresh_in_progress`); exactly one lease won |
| Refresh completion | Correct lease advanced credential version 1 → 2; mismatched lease and repeated completion rejected with `revision_conflict` |
| D1 batch result contract | Two updates returned `meta.changes` values `[1, 0]`, matching helper assumptions |
| D1 batch atomicity | A policy update followed by a CHECK failure rejected the batch; original policy revision 7 remained |
| Composite foreign key | Cross-owner project/connection binding insert rejected |
| JSON constraint | Replacing object-shaped selection JSON with `[]` rejected |
| Immutable snapshot trigger | Changing `remote_version` rejected; subsequent disconnect status update succeeded |
| Disconnect | Connection revision became 2; credential row deleted; binding policy revision became 8 |
| Repeated stale disconnect | Returned `revision_conflict`; binding policy revision remained 8 |
| Late refresh / credential resurrection | Completion using the pre-disconnect lease and a new save using disconnected revision 2 both rejected |
| Dependent operations and runs | Pending operation / ready run became `cancelled`; running operation / run became `outcome_unknown`; leases cleared and revisions incremented |
| Imported snapshot retention | Snapshot status became `disconnected`; original remote version remained `1` |
| Referential integrity | `PRAGMA foreign_key_check` returned no violations |

SQL migration text is read from its owning files. For D1's exec interface, the probe removes standalone SQL comments and joins lines, preserving complete multi-line table and trigger statements. It does not replace schema definitions with a simplified test schema.

The connected state is seeded after `createConnection` because remote authorization is outside this probe. Lease identifiers and credential plaintext are asserted in memory, not printed. Only result booleans, public metadata, error codes and source hashes are reported.

## Reviewed source identities

The probe compares source hashes before bundling and after verification, failing if any reviewed source changes during the run.

| Source | SHA-256 |
| --- | --- |
| `migrations/0010-connectors.sql` | `ff7e9d1761544b89f61d145f402d914a141ad02411e14cc12545f02d458ce617` |
| `server/connection-store.ts` | `a0889cefd5c1ba2f1b61c6de621dd0bf27f3f6d7fe9b8b3a2dbb400c0743219e` |
| `server/connector-credentials.ts` | `44e1bb29d7183aa62f1d1af371433034a73a34aef47c62d617101e327982cbb7` |

## Limits

This validates the selected SQL, crypto and compare-and-swap behavior in local workerd/D1. It does not establish production D1 latency, distributed refresh races across Cloudflare locations, successful remote OAuth rotation, request-eviction recovery, or finished route/operation authorization. Provider refresh and dispatch must still honor the returned credential versions, connection revisions and uncertainty states. No source, migration or existing test was changed by this review.

## Later foundation recheck

Re-ran the same executable on 2026-09-10 after the lifecycle fixes and OAuth context migration. Exit 0; all checks above passed with migrations 0001–0013, including preservation of the existing document and revision, exclusive refresh claim, failed-batch rollback, stale disconnect rejection and zero foreign-key violations. Bundle size: 447,742 bytes. Earlier source hashes above identify the earlier run; the rechecked hashes are:

| Source | SHA-256 |
| --- | --- |
| `migrations/0010-connectors.sql` | `dd5847fa1277767431ccf3ee900b8ba8b1e7b51338540f553fa2db4fc807efc0` |
| `server/connection-store.ts` | `081e4426b51babc40caa5369ddf177dda32520a9dec274ae7fc74378f0a7be16` |
| `server/connector-credentials.ts` | `532b44b019ccc1d262486840fa46a89d93765ba0b0de214fd06c0167acf116c6` |

The additional migrations were applied, but this probe does not claim complete OAuth-context or source-invalidation scenario coverage; their focused tests own those checks. Local runtime disposed after verification.

Status: DONE. Unresolved review findings: none within this bounded scope.
