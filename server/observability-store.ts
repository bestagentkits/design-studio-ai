import type { Bindings, Database } from './types';
import type { TelemetryCoverage, TelemetryEvent } from '../src/shared/observability';

export const retentionDays = 30;
const runtimeHealth = new WeakMap<Database, { dropped: number; failed: boolean; cleanupAt: number; deliveryFailures: number; lastDeliveryAt: string | null }>();
export function health(env: Bindings) {
  let value = runtimeHealth.get(env.DB);
  if (!value) { value = { dropped: 0, failed: false, cleanupAt: 0, deliveryFailures: 0, lastDeliveryAt: null }; runtimeHealth.set(env.DB, value); }
  return value;
}
export async function safely(env: Bindings, work: () => Promise<unknown>) {
  try { await work(); return true; } catch { const state = health(env); state.dropped++; state.failed = true; return false; }
}
export async function maintainTelemetry(env: Bindings) {
  const state = health(env), timestamp = Date.now();
  if (timestamp - state.cleanupAt < 60000) return;
  state.cleanupAt = timestamp;
  await safely(env, async () => {
    await env.DB.prepare('DELETE FROM observability_events WHERE id IN (SELECT id FROM observability_events WHERE started_at<? LIMIT 1000)')
      .bind(new Date(timestamp - retentionDays * 86400000).toISOString()).run();
    // A request cannot keep running forever after a worker restart. Async provider jobs get a longer lease.
    await env.DB.prepare("UPDATE observability_events SET status='interrupted',error_code='completion_unobserved' WHERE status='running' AND started_at<? AND (kind!='provider' OR action!='provider.media.job')")
      .bind(new Date(timestamp - 15 * 60000).toISOString()).run();
    await env.DB.prepare("UPDATE observability_events SET status='interrupted',error_code='completion_unobserved' WHERE status='running' AND action='provider.media.job' AND started_at<?")
      .bind(new Date(timestamp - 86400000).toISOString()).run();
  });
}
export const eventColumns = `id,trace_id AS traceId,parent_id AS parentId,actor_id AS actorId,channel,kind,action,project_id AS projectId,
started_at AS startedAt,finished_at AS finishedAt,duration_ms AS durationMs,status,http_status AS httpStatus,error_code AS errorCode,
provider,model,input_tokens AS inputTokens,output_tokens AS outputTokens,total_tokens AS totalTokens,cost_usd AS costUsd,output_bytes AS outputBytes,usage_source AS usageSource`;
export async function insertEvent(env: Bindings, event: TelemetryEvent) {
  return safely(env, () => env.DB.prepare(`INSERT INTO observability_events(id,trace_id,parent_id,actor_id,channel,kind,action,project_id,started_at,finished_at,duration_ms,status,http_status,error_code,provider,model,input_tokens,output_tokens,total_tokens,cost_usd,output_bytes,usage_source) VALUES(${Array(22).fill('?').join(',')})`)
    .bind(event.id,event.traceId,event.parentId,event.actorId,event.channel,event.kind,event.action,event.projectId,event.startedAt,event.finishedAt,event.durationMs,event.status,event.httpStatus,event.errorCode,event.provider,event.model,event.inputTokens,event.outputTokens,event.totalTokens,event.costUsd,event.outputBytes,event.usageSource).run());
}
export async function updateEvent(env: Bindings, event: TelemetryEvent) {
  return safely(env, () => env.DB.prepare(`UPDATE observability_events SET actor_id=?,channel=?,action=?,project_id=?,finished_at=?,duration_ms=?,status=?,http_status=?,error_code=?,provider=?,model=?,input_tokens=?,output_tokens=?,total_tokens=?,cost_usd=?,output_bytes=?,usage_source=? WHERE id=?`)
    .bind(event.actorId,event.channel,event.action,event.projectId,event.finishedAt,event.durationMs,event.status,event.httpStatus,event.errorCode,event.provider,event.model,event.inputTokens,event.outputTokens,event.totalTokens,event.costUsd,event.outputBytes,event.usageSource,event.id).run());
}
export function coverage(env: Bindings, since: string | null, configured: boolean): TelemetryCoverage {
  const state = health(env);
  return { retentionDays, instrumentedSince: since, storage: state.failed ? 'degraded' : 'available', droppedEvents: state.dropped,
    posthog: { configured, deliveryFailures: state.deliveryFailures, lastDeliveryAt: state.lastDeliveryAt },
    limitations: ['Recent activity is not live presence.', 'CLI and WebMCP channel hints are client-reported; access is still enforced using authenticated credentials.', 'Usage comes only from provider-reported fields; missing tokens and costs remain unknown.', 'Retries cannot be inferred from repeated actions; no automatic retry count is reported.', 'Client activity is reported by the browser, not a server-verified outcome.', 'Interrupted operations have no observed completion; provider jobs may finish outside this service.', 'Delivery and dropped-event counters describe this runtime instance; they reset on restart.', 'Events older than 30 days are excluded; physical cleanup runs in bounded batches.'] };
}
