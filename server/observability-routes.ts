import { Hono } from 'hono';
import type { Env } from './types';
import { ApiError, fail, origin, rateLimit } from './security';
import { clientEventSchema } from '../src/shared/observability';
import { projectRow } from './projects';
import { listTelemetry, readTrace, summarizeTelemetry } from './observability-queries';
import { startSpan, finishSpan } from './observability';
import { forwardClientEvent } from './observability-posthog';
import { health, maintainTelemetry } from './observability-store';

export const observabilityRoutes = new Hono<Env>();
observabilityRoutes.get('/summary', async c => c.json(await summarizeTelemetry(c)));
observabilityRoutes.get('/events', async c => c.json(await listTelemetry(c)));
observabilityRoutes.get('/trace/:id', async c => c.json(await readTrace(c)));
observabilityRoutes.post('/client-events', async c => {
  if (c.req.header('Origin') !== origin(c)) fail(403, 'invalid_origin', 'Client events must originate from this application.');
  if (Number(c.req.header('Content-Length') ?? 0) > 2048) fail(413, 'body_too_large', 'Client event exceeds 2 KB.');
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > 2048) fail(413, 'body_too_large', 'Client event exceeds 2 KB.');
  const input = clientEventSchema.parse(JSON.parse(text));
  await rateLimit(c, 'client-events', 300);
  if (input.projectId) await projectRow(c, input.projectId);
  await maintainTelemetry(c.env);
  const span = await startSpan(c, { kind: 'client', action: `client.${input.event}${input.action ? `.${input.action}` : input.page ? `.${input.page}` : ''}`, projectId: input.projectId });
  if (input.requestId && c.get('user')) {
    const prior = await c.env.DB.prepare('SELECT id,trace_id AS traceId FROM observability_events WHERE trace_id=? AND actor_id=? ORDER BY started_at LIMIT 1')
      .bind(input.requestId, c.get('user')!.id).first<{id:string;traceId:string}>();
    if (prior) { span.event.traceId = prior.traceId; span.event.parentId = prior.id; }
  }
  span.set({ status: input.outcome ?? (input.event === 'client_error' ? 'error' : 'success'), errorCode: input.errorCode ?? null });
  // Correlation is assigned only after checking ownership; update the insert without trusting browser identities.
  try { await c.env.DB.prepare('UPDATE observability_events SET trace_id=?,parent_id=? WHERE id=?').bind(span.event.traceId, span.event.parentId, span.event.id).run(); }
  catch { health(c.env).dropped++; health(c.env).failed = true; }
  await finishSpan(c, span);
  await forwardClientEvent(c.env, span.event, input);
  return c.json({ ok: true, requestId: span.event.traceId }, 202);
});
observabilityRoutes.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) return c.json({ error: { code: 'invalid_input', message: 'Invalid observability request.' } }, 400);
  health(c.env).failed = true;
  return c.json({ error: { code: 'observability_unavailable', message: 'Activity storage is unavailable. Other studio operations remain available.' } }, 503);
});
