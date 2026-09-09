import { clientEventSchema, type ClientTelemetryEvent } from '../shared/observability';
let initialized: Promise<void> | undefined;
let enabled = false, identityEpoch = 0;
const recent = new Map<string, number>();
export function initializeAnalytics() {
  return initialized ??= fetch('/api/config', { credentials: 'same-origin' }).then(response => response.json()).then(config => {
    enabled = config.analytics?.enabled === true;
  }).catch(() => { enabled = false; });
}
export function resetAnalyticsIdentity() { identityEpoch++; recent.clear(); }
/** Only this typed allowlist crosses the telemetry boundary. Never pass text, URLs or exception messages. */
export async function trackClient(input: ClientTelemetryEvent) {
  const epoch = identityEpoch;
  const parsed = clientEventSchema.safeParse(input);
  if (!parsed.success) return;
  await initializeAnalytics();
  if (!enabled || epoch !== identityEpoch) return;
  const key = JSON.stringify(parsed.data), now = Date.now();
  if (now - (recent.get(key) ?? 0) < 750) return;
  recent.set(key, now);
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
  try {
    await fetch('/api/observability/client-events', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(5000) });
  } catch { /* Analytics cannot interrupt editing or retry a design operation. */ }
}
export function trackClientFailure(requestId?: string, network = false) {
  void trackClient({ event: 'client_error', errorCode: network ? 'network_error' : 'request_failed', outcome: 'error', ...(requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? { requestId } : {}) });
}
