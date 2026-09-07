# Chat-first interview and quality

Status: Implemented and verified on 2026-09-08. Added scope from the user; release publication is tracked in the plan index.

## Outcome

The first prompt opens a persisted project conversation. AI-generated interactive questions establish audience, outcome, visual direction, deliverables, and constraints. The user can revise answers, inspect and approve a scope, then generate the design. External agents can drive the same state through REST, MCP, CLI, and WebMCP using their own model; website users can use configured BYOK providers.

## Constraints

Keep existing manual editing and generation contracts compatible. Never simulate a provider response or infer approval from missing answers. Persist brief state with optimistic concurrency; reject stale approvals and cross-user access. Do not expose provider keys or private project contents in public documentation. New user-visible behaviors require accurate docs and tests. Full creative-suite depth remains an active quality objective, not a claim of parity with established editors.

## Implementation

- Shared validated questions, answers, scope contract in `src/shared/brief.ts`.
- Owner-scoped brief persistence and revision checks; BYOK interview endpoint using existing provider transport.
- Chat-first frontend interview, editable scope and explicit approval; recoverable provider/configuration errors.
- MCP/CLI/WebMCP parity and updated machine-readable instructions.
- Review mobile/keyboard behavior, loading/error/empty states, asset/document isolation, and performance before release.

## Verification and rollback

Real SQLite integration tests for all transitions, stale revisions, isolation, malformed input, and provider configuration failure. Browser checks for resume, approval and appearance. Existing tests/build remain passing. Additive migration; rollback the application without deleting saved briefs.

The final run passed 70 tests and 14 desktop/mobile E2E checks, including the actual-response save race regression. Cloudflare and Docker each passed 21 checks. Deterministic design checks are available in the editor, REST, MCP, WebMCP, and CLI. The independent [quality review](reports/onboarding-quality-review.md) and [release evidence](reports/release-v020.md) record observed behavior and remaining external-credential limits.
