# MCP resource service review

Status: DONE. No remaining concrete findings in the bounded resource-service review. Implementation read-only.

## Verified boundaries

- Binding ownership, project identity, capabilities and selected resource URI are checked before credential access or network dispatch.
- A second authorization check after the MCP handshake blocks catalog/resource reads when access changes during initialization. Both regression cases observe only discovery traffic.
- Post-response checks pin connection revision, binding policy and selection, grant identity, live principal, credential version, refresh lease and expiry.
- The trusted SQL guard reaches the snapshot INSERT predicate. Credential rotation during object storage prevents publication; failed imports retain the existing durable cleanup path.
- Discovery returns the intersection of binding and agent-grant exact tool/resource selections, excludes wildcard templates, and fingerprints the filtered catalog.
- Resource URIs remain opaque identifiers. Only the configured MCP endpoint is fetched; returned content must match the selected URI and pass inert-content decoding before immutable snapshot storage.

## Validation

Independently ran `npx tsx --test tests/mcp-resources.test.ts tests/connector-sources.test.ts tests/connector-bindings.test.ts`: 27/27 passed, including 13 resource tests. Coverage includes revocation during initialization and response, credential rotation during object storage, grant-filtered discovery and mismatched/unsafe content rejection. Test peers and isolated databases close through teardown; no background process remains from this review.

Scope: trusted server service and source persistence guards. This review does not enable production routes or establish live provider success.

Unresolved questions: none.
