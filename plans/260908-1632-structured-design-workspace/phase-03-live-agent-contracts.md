# Concurrent human and agent editing

Status: Complete — implemented and locally verified

## Implementation

Shared typed edits with per-field preconditions, atomic merge and explicit conflicts. Live revision synchronization, author-local undo safety. REST/MCP/CLI/WebMCP parity for new capabilities.

## Acceptance

Two-client concurrent edits, conflicting same-field writes, ownership, reconnect and stale revisions.

Evidence: [implementation status](reports/implementation-status.md). Format/runtime boundaries remain explicit.

## Safety and rollback

Keep old documents readable. No deployed data resets or secret changes. New behavior uses shared validators. Revert source additions if needed; retain user documents and additive migrations.
