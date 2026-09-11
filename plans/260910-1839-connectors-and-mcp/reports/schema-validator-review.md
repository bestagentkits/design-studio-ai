# Bounded schema validator review

Status: DONE. Controller repaired the budget defect; independent reproduction and authorized regression tests verified the fix. Production source remained read-only during review.

## Resolved: Repeated uncharged object enumeration defeated the intended work budget

`server/connector-schema-validation.ts:83-86` charges one step for object equality but calls `Object.keys` on both objects before comparing their first value. A failing first property therefore costs roughly two charged steps while scanning thousands of keys. Repeated local references can amplify this work substantially before the 100,000-step budget expires. `validate` also enumerates object keys before early rejection at lines 120-122, and constructs `Object.entries(patternProperties)` repeatedly at line 125.

Reproduction uses supported keywords and valid bounded JSON:

```js
const value = Object.fromEntries(Array.from({length:6000}, (_,i) => ['k'+i, 0]));
const defs = {s0:{const:{...value, k0:1}}};
for (let i=1;i<=24;i++) defs['s'+i] = {
  anyOf:[{$ref:'#/$defs/s'+(i-1)}, {$ref:'#/$defs/s'+(i-1)}]
};
validateConnectorArguments({$defs:defs, $ref:'#/$defs/s24'}, value);
```

Schema is 60,446 bytes; arguments 58,891 bytes. Isolated Node subprocess exceeded a four-second timeout and was terminated with SIGTERM. Smaller 2,500-key case reached `schema_budget_exceeded` after 2,396 ms. This blocks the request event loop despite both inputs meeting the 64 KiB caps.

Controller added per-evaluation key caching, charged key/entry enumeration, charged string equality, and reference-length accounting. Independent appended regression `repeated wide-object and long-string comparisons consume the work budget promptly` verifies the original 6,000-key failing `const`, early `maxProperties` rejection, and 58,000-character string comparison. All three cases meet the schema/argument byte caps and return `schema_budget_exceeded`. The subprocess has a five-second hard timeout and a two-second per-case ceiling; the whole test including process startup completed in about 200 ms locally.

## Other verification

- Focused validator suite after repair: 12/12 passed.
- Seeded differential comparison: 60,000 short pattern/value pairs against native `RegExp(pattern, 'u')`; zero acceptance or result mismatches. Covered anchors, finite/unbounded repetition, classes/negation/ranges, whitespace, escapes, dot, and supplementary Unicode characters.
- Dangerous native patterns were not executed; the resource probe ran in a subprocess with a hard timeout.
- Local references, unsupported-keyword preflight, non-progressing-cycle rejection, decimal multiple checking, argument structural limits, and operation error mapping inspected. No further concrete semantic defect established.
- Validation success and budget/unsupported errors remain distinct in `validateOperationTool`.

Rechecked array equality, required/dependent-property loops, numeric multiple calculations, pattern member matching, schema preflight, and reference traversal for remaining bulk CPU gaps. No further concrete defect established; this is a bounded review, not universal adversarial-proof certification.

Unresolved questions: none.
