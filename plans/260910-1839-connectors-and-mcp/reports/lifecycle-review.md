# Connector lifecycle review

Status: DONE. Initial read-only source review followed by an authorized regression test in `tests/connector-credentials.test.ts`. Controller fixed production code; both findings below are verified resolved.

## Findings

### Resolved: Disconnect left terminal private payloads without retention deadlines

`server/connection-store.ts:49-53` transitions operations and runs to terminal states but neither sets `payload_expires_at` nor clears ciphertext. Prepared operations start with NULL expiry (`server/connector-operations.ts:44`); maintenance only removes ciphertext with `payload_expires_at <= now` (`server/connector-retention.ts:11-16`). NULL never matches, retaining private arguments/run content indefinitely after disconnect. Source triggers only cover referenced snapshots and do not cover a tool-only binding.

Controller added seven-day terminal expiry in the guarded disconnect batch. Regression `disconnect without snapshots invalidates run steps and expires private terminal payloads` verifies expiry on operations/runs/steps, retention before expiry, and cleanup after expiry.

### Resolved: Disconnect did not invalidate steps of affected runs

The disconnect batch marks an active run `outcome_unknown` and clears its lease but does not update `run_steps` (`server/connection-store.ts:51-54`). Pending/running steps remain active with unchanged revisions and leases; their private payloads also remain outside terminal cleanup. Binding removal already demonstrates the necessary propagation in `server/connection-bindings.ts`.

Controller added step invalidation in the guarded transaction. The same regression verifies running steps become `outcome_unknown`, pending steps become `cancelled`, revisions increment, leases clear, and unrelated connection records remain untouched.

## Independent verification

- Ran credential, auth-state, principal, policy, binding, source, and migration suites: 54 tests passed, zero failures.
- Real in-memory SQLite reproduction applied all migrations, seeded one tool binding without snapshots, one pending operation, one running run and its running model step, then called `disconnectConnection` and `maintainConnectorState`.
- Observed operation: `cancelled`, NULL expiry. Run: `outcome_unknown`, NULL expiry. Step: still `running`, NULL expiry, original active lease.
- No external accounts, network calls, or production databases used. Database closed after probe.
- After repairs: credential suite 11/11 passed, including the new lifecycle regression. It uses real SQLite and encrypted test payloads, with no snapshots to trigger secondary invalidation.

## Reviewed without concrete defects

Owner/composite-FK isolation; session-bound one-time OAuth state; encrypted credential/state record binding; refresh version/revision/lease CAS; disconnect protection against late credential resurrection; source exact-selection enforcement and guarded upload finalization; durable cleanup intents and immutable clone copies.

Unresolved questions: none within this review scope. OAuth resource-guard centralization is owned separately by the controller.
