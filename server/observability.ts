import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Bindings, Env } from './types';
import { ApiError } from './security';
import type { TelemetryEvent } from '../src/shared/observability';
import { insertEvent, updateEvent, maintainTelemetry, eventColumns, safely } from './observability-store';

const correlation = Symbol('studio-internal-correlation');
type InternalBindings = Bindings & { [correlation]?: { traceId: string; parentId: string; channel: TelemetryEvent['channel'] } };
export interface SpanOptions { kind: TelemetryEvent['kind']; action: string; projectId?: string; provider?: string; model?: string }
export interface TelemetrySpan { event: TelemetryEvent; pending: boolean; set(values: Partial<Pick<TelemetryEvent, 'status' | 'httpStatus' | 'errorCode' | 'provider' | 'model' | 'outputBytes' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd' | 'usageSource'>>): void }
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const safeLabel = (value: unknown, limit = 160) => typeof value === 'string' && value.length <= limit && /^[a-zA-Z0-9_./:* -]+$/.test(value) && !/^(sk-|phc_|Bearer |Key )/i.test(value) ? value : null;
export function errorCode(error: unknown) {
  if (error instanceof ApiError) return safeLabel(error.code, 80) ?? 'request_failed';
  if (error instanceof z.ZodError) return 'invalid_input';
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'internal_error';
}
function channel(c: Context<Env>): TelemetryEvent['channel'] {
  const internal = (c.env as InternalBindings)[correlation];
  if (internal) return internal.channel;
  if (c.req.path === '/mcp') return 'mcp';
  if (c.get('tokenKind') === 'oauth') return 'oauth';
  const claimed = c.req.header('X-Studio-Client');
  if (c.get('user') && (claimed === 'cli' || claimed === 'webmcp')) return claimed;
  return c.get('authMethod') === 'session' ? 'browser' : c.get('authMethod') === 'token' ? 'api' : 'anonymous';
}
export function telemetryEnv(c: Context<Env>, span?: TelemetrySpan): Bindings {
  const parent = span?.event ?? c.get('telemetrySpan')?.event;
  return parent ? { ...c.env, [correlation]: { traceId: parent.traceId, parentId: parent.id, channel: parent.channel } } as InternalBindings : c.env;
}
export async function startSpan(c: Context<Env>, options: SpanOptions): Promise<TelemetrySpan> {
  const parent = c.get('telemetrySpan')?.event, internal = (c.env as InternalBindings)[correlation];
  const event: TelemetryEvent = { id: crypto.randomUUID(), traceId: parent?.traceId ?? internal?.traceId ?? crypto.randomUUID(), parentId: parent?.id ?? internal?.parentId ?? null,
    actorId: c.get('user')?.id ?? null, channel: channel(c), kind: options.kind, action: safeLabel(options.action) ?? 'unknown', projectId: options.projectId ?? null,
    startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, status: 'running', httpStatus: null, errorCode: null,
    provider: safeLabel(options.provider, 40), model: safeLabel(options.model, 120), inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, outputBytes: null, usageSource: 'unavailable' };
  const span: TelemetrySpan = { event, pending: false, set(values) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'outputBytes', 'httpStatus'] as const) if (key in values) event[key] = number(values[key]);
    if (values.errorCode !== undefined) event.errorCode = safeLabel(values.errorCode, 80);
    if (values.model !== undefined) event.model = safeLabel(values.model, 120);
    if (values.provider !== undefined) event.provider = safeLabel(values.provider, 40);
    if (values.status) event.status = values.status;
    if (values.usageSource) event.usageSource = values.usageSource;
  } };
  await insertEvent(c.env, event);
  return span;
}
export async function finishSpan(c: Context<Env>, span: TelemetrySpan, error?: unknown) {
  if (error !== undefined) { span.event.status = 'error'; span.event.errorCode = errorCode(error); }
  else if (!span.pending && span.event.status === 'running') span.event.status = 'success';
  if (!span.pending || error !== undefined) { span.event.finishedAt = new Date().toISOString(); span.event.durationMs = Math.max(0, Date.now() - Date.parse(span.event.startedAt)); }
  if (span.event.kind === 'mcp' && span.event.status === 'error') c.set('telemetryErrorCode', span.event.errorCode ?? 'mcp_tool_error');
  await updateEvent(c.env, span.event);
}
export async function withSpan<T>(c: Context<Env>, options: SpanOptions, work: (span: TelemetrySpan) => Promise<T>): Promise<T> {
  const span = await startSpan(c, options);
  try { const result = await work(span); await finishSpan(c, span); return result; }
  catch (error) { await finishSpan(c, span, error); throw error; }
}
export async function bindTelemetryActor(c: Context<Env>) {
  const span = c.get('telemetrySpan');
  if (span) { span.event.actorId = c.get('user')?.id ?? null; span.event.channel = channel(c); await updateEvent(c.env, span.event); }
}
export function providerUsage(raw: unknown, provider?: string): Pick<TelemetryEvent, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd' | 'usageSource'> {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const tokens = (value: unknown) => Number.isSafeInteger(value) ? number(value) : null;
  const inputTokens = tokens(value.input_tokens ?? value.prompt_tokens ?? value.promptTokenCount);
  const outputTokens = tokens(value.output_tokens ?? value.completion_tokens ?? value.candidatesTokenCount);
  const reported = tokens(value.total_tokens ?? value.totalTokenCount);
  const totalTokens = reported ?? (inputTokens !== null && outputTokens !== null ? tokens(inputTokens + outputTokens) : null);
  // OpenRouter credits are USD-denominated; other generic cost fields have no established currency.
  const costUsd = number(value.cost_usd ?? value.cost_in_usd ?? (provider === 'openrouter' ? value.cost : undefined));
  return { inputTokens, outputTokens, totalTokens, costUsd, usageSource: totalTokens !== null || inputTokens !== null || outputTokens !== null || costUsd !== null ? 'provider' : 'unavailable' };
}
export async function completeMediaSpan(c: Context<Env>, spanId: string | null, values: { outputBytes?: number; usage?: unknown; errorCode?: string }) {
  if (!spanId) return;
  await safely(c.env, async () => {
    const event = await c.env.DB.prepare(`SELECT ${eventColumns} FROM observability_events WHERE id=? AND actor_id=?`).bind(spanId, c.get('user')!.id).first<TelemetryEvent>();
    if (!event) return;
    // Cached completion can win the race; late provider measurements fill only missing fields.
    const usage = providerUsage(values.usage), finishedAt = new Date().toISOString();
    await c.env.DB.prepare("UPDATE observability_events SET status=CASE WHEN finished_at IS NULL THEN ? ELSE status END,error_code=CASE WHEN finished_at IS NULL THEN ? ELSE error_code END,finished_at=coalesce(finished_at,?),duration_ms=coalesce(duration_ms,?),output_bytes=coalesce(output_bytes,?),input_tokens=coalesce(input_tokens,?),output_tokens=coalesce(output_tokens,?),total_tokens=coalesce(total_tokens,?),cost_usd=coalesce(cost_usd,?),usage_source=CASE WHEN usage_source='provider' THEN usage_source ELSE ? END WHERE id=? AND actor_id=?")
      .bind(values.errorCode ? 'error' : 'success', values.errorCode ?? null, finishedAt, Math.max(0, Date.now() - Date.parse(event.startedAt)), number(values.outputBytes), usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.costUsd, usage.usageSource, spanId, c.get('user')!.id).run();
  });
}
export const observabilityMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (!(c.req.path.startsWith('/api/') || c.req.path === '/mcp' || c.req.path.startsWith('/oauth/'))) return next();
  // Observation reads must not populate their own dashboard or trigger a refresh feedback loop.
  if (c.req.path.startsWith('/api/observability/') || ['/api/health', '/api/config', '/api/schema', '/api/catalog', '/api/openapi'].includes(c.req.path)) return next();
  await maintainTelemetry(c.env);
  const route = c.req.matchedRoutes.filter(r => r.path !== '*' && !r.path.endsWith('/*')).at(-1)?.path ?? '/unmatched';
  const span = await startSpan(c, { kind: 'http', action: `${c.req.method} ${route}` });
  c.set('telemetrySpan', span); c.header('X-Request-ID', span.event.traceId);
  try { await next(); }
  finally {
    c.header('X-Request-ID', span.event.traceId);
    span.event.actorId = c.get('user')?.id ?? null; span.event.channel = channel(c);
    span.set({ httpStatus: c.res.status, status: c.res.status >= 400 || c.get('telemetryErrorCode') ? 'error' : 'success', errorCode: c.get('telemetryErrorCode') ?? (c.res.status >= 400 ? `http_${c.res.status}` : null) });
    await finishSpan(c, span);
  }
};
