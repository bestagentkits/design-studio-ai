# GitHub login and documentation navigation UI

Status: DONE_WITH_CONCERNS

## Delivered

- Login and registration both expose **Continue with GitHub** only when `GET /api/config` returns `githubEnabled: true`. The button performs a top-level navigation to `/api/auth/github`, without submitting email/password fields.
- The GitHub mark uses the official Primer Octicons source. Dark button, separator, keyboard labels, loading/disabled states, and responsive account controls match the existing studio UI.
- Callback query codes map to fixed safe messages. Unknown and inherited-property names use a generic failure message; raw callback text is never displayed. The UI strips OAuth callback query parameters after reading them.
- Email collisions instruct the person to sign in with their password and connect GitHub in Settings. No automatic account merge or connection-success simulation is implemented.
- Settings → Your account loads `/api/auth/github/status`, shows the actual connected login, and offers **Connect GitHub** when enabled and unconnected. Linking POSTs `/api/auth/github/link` before navigating to the returned authorized address. No unlink action was added.
- Before OAuth navigation, sessionStorage stores only a versioned, expiring brief snapshot: prompt, name, audience, kind, theme/template identifiers, and agent-settings destination. It never stores password, provider keys, personal API tokens, GitHub credentials, or OAuth response tokens. Recovery validates primitive fields and expires after 30 minutes; the entry is consumed on return.
- Imported source documents/binaries are not copied into browser storage. After a GitHub redirect the UI explicitly requests reimporting that file.
- Public `/docs` links appear in desktop navigation, a named mobile header shortcut, and the footer.
- `/?settings=agents` authenticates first when necessary and then opens the existing Agent connections settings. This intent also survives GitHub navigation. Settings accepts optional `initialTab`.

## Validation and integration

- Read the existing auth modal/account panel and the phase-05 GitHub-login plan.
- `npm run typecheck` passed after all changes.
- `npm run build` passed; subsequent edits only formatted existing code.
- Only `src/app/app.tsx`, `src/app/settings.tsx`, and `src/styles.css` were changed for this scope. Server, shared schema, main entry, and new documentation component remain with their respective owners.
- The controller owns route implementation, live GitHub OAuth verification, and focused/E2E tests. The previous local port 8787 was not running during this UI task, so no fresh end-to-end authorization or account-link verification is claimed. No background process was started.

Concerns: real callback/session behavior and the final `/docs` route mount require controller integration verification. Browser recovery depends on sessionStorage availability; imported files must be reselected. Frontend ownership is released.
