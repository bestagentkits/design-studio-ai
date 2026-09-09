import type { Bindings } from './types';
import type { ClientTelemetryEvent, TelemetryEvent } from '../src/shared/observability';
import { health } from './observability-store';

export function posthogConfig(env: Bindings): { key: string; host: string } | null {
  if (!env.POSTHOG_PROJECT_KEY || !env.POSTHOG_HOST) return null;
  try {
    const url = new URL(env.POSTHOG_HOST);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { key: env.POSTHOG_PROJECT_KEY, host: url.origin };
  } catch { return null; }
}
export async function forwardClientEvent(env: Bindings, event: TelemetryEvent, input: ClientTelemetryEvent) {
  const config = posthogConfig(env);
  if (!config) return;
  try {
    const response = await fetch(`${config.host}/i/v0/e/`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(2000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: config.key, event: `studio_${input.event}`, distinct_id: event.actorId ?? `anonymous:${event.id}`, timestamp: event.startedAt, uuid: event.id,
        properties: { $process_person_profile: false, $geoip_disable: true, $ip: null,
          source: 'design-studio-ai', page: input.page, action: input.action, outcome: input.outcome, error_code: input.errorCode,
          trace_id: event.traceId, project_id: event.projectId } }) });
    if (!response.ok) throw new Error('analytics_delivery_failed');
    await response.body?.cancel();
    health(env).lastDeliveryAt = new Date().toISOString();
  } catch { health(env).deliveryFailures++; }
}
