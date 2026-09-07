# Persisted design brief backend

## Summary

Implemented private project briefs, structured interviews and answers, explicit scope approval, and approved-scope generation gating. Focused brief tests pass 9/9; existing server, provider-capability, and regression tests pass 19/19. Application and CLI typechecks pass.

## Implemented contract

- `GET /api/projects/:id/brief` returns the persisted brief or null after checking project ownership.
- `PUT /api/projects/:id/brief` uses revision 0 for creation and the current revision for changes. Initial creation requires a nonempty request and adds no invented interview questions. Agents can supply validated interviews, answers, and scope without provider credentials.
- `POST /api/projects/:id/brief/interview` uses the persisted request, answers, project context, and existing provider transport to request structured interview JSON. It has an owner-scoped rate limit and a bounded requested output. Provider/configuration/parsing failures do not save a brief. The final save uses the original brief revision, rejecting late responses after another write or approval.
- `POST /api/projects/:id/brief/approve` requires a valid scope and every required answer. It increments the revision and records approval explicitly. Optional unanswered questions do not block readiness.
- Every PUT and successful provider interview clears approval. Answers are merged by question ID; empty strings or arrays clear an answer. Unknown IDs, incompatible answer types, duplicate selections, and unknown selected options are rejected. Choice questions accept a string as an explicit custom answer.
- Replacing questions retains answers only when the ID, type, and wording still match and prior selections remain valid. Removed questions, changed meanings, and removed selected options clear their incompatible answers.

Migration `0006-design-briefs.sql` stores owner, project, revision, JSON brief, and update time. Project deletion cascades the brief. Conditional inserts and updates enforce optimistic concurrency for initial creation, updates, and approval.

## Provider and generation integration

Extracted `completeText` and `textProviderSchema` in `server/providers.ts`, retaining the existing provider allowlist, encrypted credential loading, transport timeouts, redirects policy, response bounds, model handling, and usage fields. Existing design generation keeps its prior request behavior when no brief exists.

When a brief exists, generation requires an approved status, valid scope presence, and approval timestamp. The complete approved scope is included in the system prompt. A brief revision change during generation rejects the late proposal instead of returning output based on an outdated approval. The generation module reads persisted brief state directly to avoid a dependency cycle with the interview routes.

## Validation

- `npx tsx --test tests/briefs.test.ts`: 9 passed, 0 failed.
- `npx tsx --test tests/server.test.ts tests/provider-capabilities.test.ts tests/regressions.test.ts`: 19 passed, 0 failed.
- `npm run typecheck`: passed.

Real SQLite tests cover persistence after reopening, owner and anonymous isolation, request-only creation, approval and stale approval, malformed answers, scope changes, custom answers, safe answer preservation, concurrent creation and writes, missing provider behavior, compatibility for projects without briefs, and cascade deletion. No provider-success HTTP responses were mocked or claimed.

## Review and remaining validation

Source review checked ownership before storage access, parameterized queries, atomic revision predicates, strict write schemas, non-inferred approval, private provider inputs, and preserving the previous generation transport. The controller owns final integration review, build/deployment, UI wiring, and live provider validation. Real model interview quality and successful provider output remain to be checked with a configured provider; isolated failure and persistence behavior are verified here.
