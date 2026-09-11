# Durable save and export operations

The [shared request schema](../src/shared/operation-jobs.ts) owns this contract. `POST /api/projects/{id}/operations` accepts `kind`, a caller-chosen `operationId`, and `input` containing the normal save/export fields and an observed `expectedRevision`. It returns an operation immediately. Reuse the exact ID and payload after an uncertain response. A conflicting payload returns `operation_id_conflict`; stale revisions never get silently advanced.

Poll `GET /api/projects/{id}/operations/{operationId}` for `queued`, `running`, `succeeded` or `failed`, the current stage, committed revision and private result URL. Download `.../result` only after success. Save results contain the original committed project receipt; export results contain real file bytes. Export jobs pin the document snapshot at acceptance; referenced assets must remain available until rendering completes. A later edit cannot change the accepted document snapshot.

Both status and results require project ownership. Neither creates a publication. Jobs and artifacts remain available until project deletion. Inputs contain private documents and belong in the same protected backup/retention boundary as projects. A result is capped at 100 MB; MCP transfers at most 20 MB per result, with CLI download for larger artifacts.

The editor uses jobs for manual saves outside Live mode and cloud exports. **Operations** remembers the latest ID across a reload and lets you check/download its result. Live collaborative merging retains its existing merge contract. A lost connection does not cancel the worker; inspect the original receipt before another save. Retry of an unchanged request in the current editor reuses its ID. Do not replace unsaved local work with a downloaded receipt without reconciliation.

WebMCP `studio_start_save({operationId})` captures the open local document and returns immediately. Poll `studio_api_get_projects_id_operations_operationId`, then call `studio_reconcile_save({operationId})` to merge the receipt into local state. Reconciliation refuses a newer unrelated base. The generic POST operations tool starts exports; GET result downloads binary artifacts. These are browser tools; network MCP uses `start_operation`, `get_operation`, and `get_operation_result`.

CLI:

```sh
dsa operations start PROJECT --file request.json
dsa operations status PROJECT OPERATION
dsa operations result PROJECT OPERATION --out character.glb
```

Example export request (replace the revision and ID with observed values):

```json
{"kind":"export","operationId":"character-export-unique-id","input":{"format":"glb","pageIndex":0,"expectedRevision":12}}
```

Failure responses carry a code and repair message. For a stale revision, read and reconcile before creating a new operation. A terminal failed job is retained, not restarted by a duplicate submission. For a renderer/configuration failure, repair the cause and deliberately start a new ID after checking the old status. Temporary worker interruption uses a lease and queue redelivery; a save committed before interruption returns its stored receipt without another revision increment.

Cloudflare uses the queue configured in [wrangler.jsonc](../wrangler.jsonc) and [worker entry](../server/worker.ts). Provision `design-studio-operations` once with `npm run cf -- queues create design-studio-operations` before deploying; migration `0012-operation-jobs.sql` is additive. Self-hosted Node runs the same durable worker from its database, one operation at a time. A restarted worker can reclaim an expired 16-minute lease. Status polling can redispatch queued Cloudflare work after a lost dispatch. See [deployment](deployment.md) for coordinated database/assets/secret backups.
