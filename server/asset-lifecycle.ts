import type { Context } from 'hono';
import type { Env } from './types';
import { fail, id, owner } from './security';

export const PROJECT_ASSET_QUOTA = 2 * 1024 ** 3;
export const OWNER_ASSET_QUOTA = 8 * 1024 ** 3;
/** Admission is a single conditional insert, so concurrent uploads cannot spend the same capacity. */
export async function reserveAsset(c: Context<Env>, projectId: string, bytes: number) {
  const key = id(), time = Date.now(), expires = time + 300000;
  await c.env.DB.prepare('DELETE FROM asset_reservations WHERE expires_at < ?').bind(time).run();
  const result = await c.env.DB.prepare(`INSERT INTO asset_reservations(id,user_id,project_id,bytes,expires_at)
    SELECT ?,?,?,?,? WHERE
    COALESCE((SELECT SUM(size) FROM assets WHERE project_id=?),0) + COALESCE((SELECT SUM(bytes) FROM asset_reservations WHERE project_id=? AND expires_at>=?),0) + ? <= ? AND
    COALESCE((SELECT SUM(size) FROM assets WHERE user_id=?),0) + COALESCE((SELECT SUM(bytes) FROM asset_reservations WHERE user_id=? AND expires_at>=?),0) + ? <= ?`)
    .bind(key, owner(c), projectId, bytes, expires, projectId, projectId, time, bytes, PROJECT_ASSET_QUOTA, owner(c), owner(c), time, bytes, OWNER_ASSET_QUOTA).run();
  if (!result.meta.changes) fail(413, 'asset_quota_exceeded', 'Asset storage is full, including retained history and uploads in progress. Export a backup and remove unused projects before uploading.');
  return key;
}
export async function reserveCreativeWork(c: Context<Env>, projectId: string) {
  const key = id(), time = Date.now(), expires = time + 60000;
  await c.env.DB.prepare('DELETE FROM creative_work_leases WHERE expires_at < ?').bind(time).run();
  const result = await c.env.DB.prepare(`INSERT INTO creative_work_leases(id,user_id,project_id,expires_at) SELECT ?,?,?,?
    WHERE (SELECT COUNT(*) FROM creative_work_leases WHERE expires_at>=?) < 2
    AND (SELECT COUNT(*) FROM creative_work_leases WHERE user_id=? AND expires_at>=?) < 1`).bind(key, owner(c), projectId, expires, time, owner(c), time).run();
  if (!result.meta.changes) fail(429, 'painting_busy', 'A painting is already being processed. Wait for its result before retrying.');
  return {
    assertActive: () => { if (Date.now() >= expires) fail(408, 'painting_timeout', 'Painting processing expired. Your previous saved document is unchanged.'); },
    release: () => c.env.DB.prepare('DELETE FROM creative_work_leases WHERE id=?').bind(key).run(),
  };
}
