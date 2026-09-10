# Node request regression diagnosis

Status: DONE. Read-only production source investigation; no source changes.

## Reproduction

Node v25.2.1, installed @hono/node-server2.1.1 and Hono4.13.7. Port18844 checked free before starting. Each runtime used a fresh mktemp DATA_DIR and normal registration limits; no external requests/accounts.

Commands:

```sh
DATA_DIR=$(mktemp -d /tmp/dsa-node-final-repro.XXXXXX) PORT=18844 APP_URL=http://127.0.0.1:18844 npx tsx server/node.ts
node /tmp/dsa-node-delete-probe.mjs
```

The temporary client registers one isolated account, creates a permanent token, deletes it, creates a web project, then deletes that project. Secrets remain only in temporary process memory; output reports status codes only.

Unmodified entry: registration201, token creation201, token DELETE500, project creation201, project DELETE500. Confirmed the observed CI failures independently on real HTTP.

A temporary entry imports the same app, replaces only its error handler to show stack, then imports server/node.ts. Exact failure:

```text
TypeError: Cannot read private member #state from an object whose class did not declare it
  at new Request (node:internal/deps/undici/undici:10426:27)
  at bodyLimit2 (.../hono/dist/middleware/body-limit/index.js:47:17)
  at async .../server/index.ts:57:3
  at async observabilityMiddleware (.../server/observability.ts:96:9)
```

## Cause and minimal repair

`overrideGlobalObjects:false` preserves native Request/Response globals. The Node adapter still hands the application a lightweight request object with a Request prototype, backed by its own symbols rather than native undici private state. Hono body-limit buffers bodies without a usable Content-Length and reconstructs `new Request(c.req.raw, requestInit)`. Native Request recognizes the prototype but cannot read its private state. Failure precedes authentication and the DELETE handler; database deletion logic is not the cause.

Materialize a genuine native Request at the Node-only fetch boundary before calling app.fetch, using the URL and explicit method, headers, body (omit for GET/HEAD), signal, and duplex:'half'. Do not pass the adapter object as the constructor input. Keep `overrideGlobalObjects:false` so outgoing native fetch responses still satisfy SDK Response identity checks. Copy the socket-derived CF-Connecting-IP before materialization.

Temporary harness proof wraps app.fetch with:

```ts
const fetch = app.fetch.bind(app);
app.fetch = (request, ...args) => fetch(new Request(request.url, {
  method: request.method,
  headers: request.headers,
  body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  signal: request.signal,
  duplex: 'half',
}), ...args);
```

With this wrapper, same real HTTP probe: registration201, token creation201, token DELETE200, project creation201, project DELETE200. No global Response replacement. A request.clone() wrapper also passed, but explicit reconstruction is preferred because it avoids an unused tee branch that could retain streamed bodies.

## Process cleanup and limits

Owned server PIDs98053,99886,2596,3948 and the intermediate clone runtime were stopped via SIGTERM; port18844 released. Temporary harnesses live under /tmp. No production rate limits changed, no remote traffic, no repository source edits. Parent owns the production patch and focused HTTP regression tests, including streamed/chunked body-limit and cancellation coverage. This is local Node evidence, not a rerun of the full beta CI.

Unresolved questions: none for the reproduced cause. Full exact-head CI remains a separate gate.
