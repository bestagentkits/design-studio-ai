# Operation review and bounded schema validation

Status: DONE_WITH_CONCERNS. Source review plus isolated local tests; no provider calls or deployment.

## Confirmed findings

1. **Synchronous schema denial of service:** `server/connector-operation-versions.ts:79` invoked the SDK validator synchronously. Its bundled `@cfworker/json-schema` engine calls native `new RegExp(pattern,'u').test(instance)` and recursively expands combinators. Actual helper subprocesses exceeded a 2-second timeout and were killed for both:
   - 37-byte schema `{type:'string',pattern:'^(a+)+$'}` with `'a'.repeat(28)+'!'`.
   - 1,562-byte schema with `$defs.s0={type:'number'}` and 24 definitions each applying `allOf` to two references to the preceding definition; argument `0`.
   Both satisfy the existing JSON size/depth limits. Promise timeouts cannot interrupt this synchronous work.
2. **Unsupported constraints silently ignored:** the same helper accepted `'not an integer'` for a declared 2020-12 schema with `$defs.integerOnly={type:'integer'}` and `$dynamicRef:'#/$defs/integerOnly'`. The installed engine does not evaluate `$dynamicRef`. This violates the [2020-12 reference semantics](https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.2). Isolation alone would not repair it.
3. **Source lifecycle does not invalidate a different connection's approval:** `connector-operation-versions.ts:54–65` only checks pinned snapshot existence. A real SQLite test prepared/approved an operation on connection A using a snapshot from B, disconnected B, and successfully claimed A as `running`. `connection-store.ts:49–50` only invalidated operations directly targeting B. Retained/disconnected snapshots remain valid project copies, so the correction should invalidate prior approvals on the transition, not ban those copies from future explicit operations.

The controller owns lifecycle corrections and operation wiring. The original 9 operation tests passed during review.

## Implemented safe validator API

- `server/connector-schema-validation.ts`: `validateConnectorArguments(schema,args,{maxSteps?}): true` and `inspectConnectorSchema(schema): void`.
- `server/connector-schema-regex.ts`: bounded epsilon-NFA matching; never executes a schema-supplied native regular expression.
- Errors are `ConnectorSchemaError`, with `code` equal to `unsupported_schema`, `invalid_tool_arguments`, or `schema_budget_exceeded`.
- Catalog discovery can preflight schemas without inventing sample arguments. Preflight visits unselected branches too. Unsupported tools must remain visibly unsupported; never strip their constraints and expose them as usable.
- Limits: 64 KiB JSON/schema inputs, existing structural node/depth limits, at most 100,000 validation work steps, 64 validation/reference levels, 256 UTF-16 pattern units, 1,024 regex states and finite repetition bounds at most 256. Caller budgets can only reduce the step ceiling. Matching, reference expansion and collection comparisons share the work budget.

## Exact supported profile

Absent `$schema` means the explicit supported 2020-12 profile. The only accepted dialect declaration is `https://json-schema.org/draft/2020-12/schema`. This does **not** claim arbitrary 2020-12 or arbitrary remote MCP schema support.

Supported: boolean schemas; primitive/union `type`; `const` and `enum` with structural JSON equality; local JSON Pointer `$ref` including pointer/URI escaping; `$defs`/`definitions`; `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`; object `properties`, `patternProperties`, `additionalProperties`, `required`, `propertyNames`, property counts, `dependentRequired`/`dependentSchemas`; arrays `prefixItems`, `items`, item counts, `uniqueItems`, `contains` and contains counts; Unicode code-point string lengths and safe `pattern`; numeric inclusive/exclusive bounds and exact decimal `multipleOf` over the received JSON numbers.

Annotations accepted without validation effect: `title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`.

Explicitly unsupported: other dialects, `format`, dynamic/recursive references, `$id`/anchors, external references, `unevaluatedItems`/`unevaluatedProperties`, old-dialect keyword variants and unknown keywords. Non-progressing reference cycles reject; recursive schemas that descend into child instances work within depth/work limits. No remote schema fetching.

Regex profile: literal Unicode code points; initial `^`/final `$`; dot with ECMAScript line-terminator exclusions; character classes/negation/ranges; escaped syntax/control characters; `\d`/`\D`, `\w`/`\W`, `\s`/`\S`; single-atom `?`, `*`, `+`, `{m}`, `{m,n}`, `{m,}`. Unsupported: grouping, alternation, lookaround, backreferences, word-boundary assertions, Unicode property/hex escapes, lazy quantifiers and excessive pattern/state sizes. Native ECMAScript comparison tests cover only this deliberately restricted grammar. A direct RE2 substitution was avoided because accepted syntax can still differ semantically, e.g. dot/whitespace character sets.

## Lifecycle correction checklist for controller

- Connection disconnect or identity replacement: atomically cancel pending/awaiting-approval consumers and mark running consumers outcome_unknown, including operations whose snapshot pins come from that connection. Preserve already-retained copies for fresh explicit approvals.
- Source binding removal/disable or policy revocation: resolve its snapshot IDs **before** deletion; invalidate direct and cross-binding snapshot consumers in the same batch. Apply originating-principal grant invalidation separately from project copy ownership.
- Explicit source removal: invalidate snapshot consumers and clear retained private operation/run payloads according to removal policy before deleting the snapshot. Current existence CAS prevents a later claim but does not proactively settle already-running state or erase retained payloads.
- Project/account deletion: relational cascades remove operations, approvals, runs and snapshots; durable object deletion queue survives. A previously running external call cannot be undone or safely retried.
- Source refresh: append-only new snapshot does not revoke the old immutable snapshot and must not invalidate pins solely because a newer copy exists. A disconnected clone starts with no live binding/authority.
- Apply analogous checks to `agent_runs.source_snapshot_ids_json` and run-step private payloads; binding-only run pins are insufficient for source-copy consumers. Confirm exact owning column names when wiring.

## Evidence and remaining limits

Focused evaluator tests: common constraints; object/array equality; decimal arithmetic; local pointers and sibling assertions; recursive child-instance validation; unsupported keyword/dialect/preflight failures; supported-pattern differential checks; hostile regex rejection; exponential reference budget exhaustion; structural limits. The initial 11-test run passed and typecheck passed. Hostile cases finished in milliseconds locally; these observations are not a runtime SLA.

No new dynamic Worker service, regex dependency, provider traffic or network schema loading. Controller still must wire the validator into operation preparation/claim and SDK validation/catalog discovery, and rerun those integration tests. This profile rejects unsupported constraints explicitly; broader schema compatibility requires deliberate additional semantics/tests, not relaxed rejection.

Unresolved questions: none for the implemented profile; integration and lifecycle fixes remain controller-owned.
