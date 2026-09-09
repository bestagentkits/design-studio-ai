import type { Context } from 'hono';
import type { Env } from './types';
import { fail, owner } from './security';
import { telemetryQuerySchema, type TelemetryQuery, type TelemetrySummary, type TelemetryEvent } from '../src/shared/observability';
import { coverage, eventColumns, maintainTelemetry } from './observability-store';
import { posthogConfig } from './observability-posthog';

export function isObservabilityOperator(c: Context<Env>) {
  return !!c.get('user') && c.get('tokenKind') !== 'oauth' && (c.env.OBSERVABILITY_ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(c.get('user')!.id);
}
export function telemetryFilter(c: Context<Env>) {
  const actor = owner(c), query = telemetryQuerySchema.parse(c.req.query());
  if (query.scope === 'all' && !isObservabilityOperator(c)) fail(403, 'operator_required', 'This view requires an explicitly configured operator account or API key.');
  if (query.actorId && query.scope !== 'all') fail(400, 'invalid_filter', 'Actor filtering requires operator scope.');
  const clauses = ['started_at>=?'], values: unknown[] = [new Date(Date.now() - query.days * 86400000).toISOString()];
  if (query.scope === 'owner') { clauses.push('actor_id=?'); values.push(actor); }
  for (const [key, column] of [['projectId', 'project_id'], ['actorId', 'actor_id'], ['channel', 'channel'], ['kind', 'kind'], ['status', 'status'], ['action', 'action']] as const) {
    if (query[key]) { clauses.push(`${column}=?`); values.push(query[key]); }
  }
  return { query, where: clauses.join(' AND '), values };
}
export async function listTelemetry(c: Context<Env>) {
  await maintainTelemetry(c.env);
  const { query, where, values } = telemetryFilter(c);
  let pagination = '';
  if (query.cursor) {
    const split = query.cursor.split('|');
    if (split.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(split[0]) || !/^[a-f0-9-]{36}$/.test(split[1])) fail(400, 'invalid_cursor', 'Use the nextCursor returned by the previous page.');
    pagination = ' AND (started_at<? OR (started_at=? AND id<?))'; values.push(split[0], split[0], split[1]);
  }
  const { results } = await c.env.DB.prepare(`SELECT ${eventColumns} FROM observability_events WHERE ${where}${pagination} ORDER BY started_at DESC,id DESC LIMIT ?`).bind(...values, query.limit + 1).all<TelemetryEvent>();
  const events = results.slice(0, query.limit), last = events.at(-1);
  return { events, nextCursor: results.length > query.limit && last ? `${last.startedAt}|${last.id}` : null };
}
export async function readTrace(c: Context<Env>) {
  await maintainTelemetry(c.env);
  const { query, where, values } = telemetryFilter(c), traceId = c.req.param('id') ?? '';
  if (!/^[a-f0-9-]{36}$/.test(traceId)) fail(404, 'not_found', 'Trace not found.');
  const { results } = await c.env.DB.prepare(`SELECT ${eventColumns} FROM observability_events WHERE ${where} AND trace_id=? ORDER BY started_at,id LIMIT 501`).bind(...values, traceId).all<TelemetryEvent>();
  if (!results.length) fail(404, 'not_found', 'Trace not found.');
  return { traceId, events: results.slice(0, 500), truncated: results.length > 500 };
}
export async function summarizeTelemetry(c: Context<Env>): Promise<TelemetrySummary> {
  await maintainTelemetry(c.env);
  const { query, where, values } = telemetryFilter(c);
  const one = async <T>(columns: string, extra = '') => (await c.env.DB.prepare(`SELECT ${columns} FROM observability_events WHERE ${where}${extra}`).bind(...values).first<T>())!;
  const group = async <T>(columns: string, suffix: string) => (await c.env.DB.prepare(`SELECT ${columns} FROM observability_events WHERE ${where} ${suffix}`).bind(...values).all<T>()).results;
  const counts = await one<{requests:number; errors:number; running:number; interrupted:number; succeeded:number; completed:number; avgDurationMs:number|null}>(`count(*) AS requests,coalesce(sum(status='error'),0) AS errors,coalesce(sum(status='running'),0) AS running,coalesce(sum(status='interrupted'),0) AS interrupted,coalesce(sum(status='success'),0) AS succeeded,coalesce(sum(status IN ('success','error')),0) AS completed,avg(duration_ms) AS avgDurationMs`, " AND kind='http' AND parent_id IS NULL");
  const active = await one<{running:number;interrupted:number}>("coalesce(sum(status='running'),0) AS running,coalesce(sum(status='interrupted'),0) AS interrupted", " AND (parent_id IS NULL OR (kind='provider' AND action='provider.media.job'))");
  const usage = await one<TelemetrySummary['usage']>(`count(*) AS providerCalls,sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,sum(total_tokens) AS totalTokens,sum(cost_usd) AS costUsd,coalesce(sum(input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR total_tokens IS NOT NULL),0) AS measuredTokenCalls,coalesce(sum(cost_usd IS NOT NULL),0) AS measuredCostCalls`, " AND kind='provider'");
  const byAction = await group<TelemetrySummary['byAction'][number]>(`action,count(*) AS count,sum(status='error') AS errors,avg(duration_ms) AS avgDurationMs`, 'GROUP BY action ORDER BY count DESC LIMIT 30');
  const byActor = await group<TelemetrySummary['byActor'][number]>(`actor_id AS actorId,count(*) AS count,sum(status='error') AS errors,max(started_at) AS lastSeen`, "AND kind IN ('http','client') AND parent_id IS NULL GROUP BY actor_id ORDER BY lastSeen DESC LIMIT 30");
  const byProvider = await group<TelemetrySummary['byProvider'][number]>(`provider,model,count(*) AS count,sum(status='error') AS errors,sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,sum(cost_usd) AS costUsd`, "AND kind='provider' AND provider IS NOT NULL GROUP BY provider,model ORDER BY count DESC LIMIT 30");
  const first = await one<{since:string|null}>('min(started_at) AS since');
  return { scope: query.scope, days: query.days, totals: { requests: counts.requests, errors: counts.errors, running: active.running, interrupted: active.interrupted, successRate: counts.completed ? counts.succeeded / counts.completed : null, avgDurationMs: counts.avgDurationMs }, usage, byAction, byActor, byProvider, coverage: coverage(c.env, first.since, !!posthogConfig(c.env)) };
}
