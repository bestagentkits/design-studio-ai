import type { Bindings } from './types';
import { id, now } from './security';

export const CONNECTOR_UPLOAD_LEASE_MS = 5 * 60 * 1000;
export async function beginConnectorObjectUpload(env: Bindings) {
  const key = `private/connector-sources/${id()}/${id()}`, lease = id();
  await env.DB.prepare("INSERT INTO connector_object_cleanup(object_key,state,lease_id,due_at,created_at) VALUES(?,'uploading',?,?,?)")
    .bind(key, lease, Date.now() + CONNECTOR_UPLOAD_LEASE_MS, now()).run();
  return { key, lease };
}
/** Call only after this uploader's put has settled; no future write can recreate the object. */
export async function abandonConnectorObjectUpload(env: Bindings, key: string, lease: string) {
  await env.DB.prepare("UPDATE connector_object_cleanup SET state='deleting',due_at=0 WHERE object_key=? AND (lease_id=? OR state='abandoned')")
    .bind(key, lease).run();
}
/** Request-driven, bounded cleanup. Failed deletions remain durable for the next invocation. */
export async function cleanupConnectorObjects(env: Bindings, limit = 25) {
  const count = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 25));
  const { results } = await env.DB.prepare("SELECT object_key FROM connector_object_cleanup WHERE due_at<=? ORDER BY CASE state WHEN 'deleting' THEN 0 ELSE 1 END,due_at LIMIT ?")
    .bind(Date.now(), count).all<{ object_key: string }>();
  let deleted = 0, failed = 0;
  for (const { object_key: key } of results) {
    const lease = id();
    const claimed = await env.DB.prepare(`UPDATE connector_object_cleanup SET state=CASE WHEN state='uploading' THEN 'abandoned' ELSE state END,lease_id=?,due_at=?
      WHERE object_key=? AND due_at<=? RETURNING state`).bind(lease, Date.now() + 60000, key, Date.now()).first<{ state: string }>();
    if (!claimed) continue;
    try {
      await env.ASSETS_BUCKET.delete(key);
      if (claimed.state === 'deleting') await env.DB.prepare("DELETE FROM connector_object_cleanup WHERE object_key=? AND lease_id=? AND state='deleting'").bind(key, lease).run();
      // A crashed/paused upload might still finish later. Keep its tombstone until its uploader
      // acknowledges completion; repeated idempotent deletion prevents permanent orphan objects.
      else await env.DB.prepare('UPDATE connector_object_cleanup SET due_at=? WHERE object_key=? AND lease_id=?').bind(Date.now() + 3600000, key, lease).run();
      deleted++;
    } catch { failed++; }
  }
  return { examined: results.length, deleted, failed };
}
