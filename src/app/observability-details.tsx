import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { TelemetryEvent, TelemetrySummary, TelemetryTrace } from '../shared/observability';
import { Modal } from './ui';
export const quantity = (value: number | null | undefined) => value == null ? 'Not reported' : value.toLocaleString();
const cost = (value: number | null) => value === null ? 'Not reported' : `$${value.toFixed(5)}`;
export function Metric({ label, value, tone }: { label: string; value: string | number | null; tone?: string }) {
  return <div className={`activity-metric ${tone ?? ''}`}><span>{label}</span><strong>{typeof value === 'number' ? quantity(value) : value ?? 'Not reported'}</strong></div>;
}
export function ActivityEvents({ events, openTrace }: { events: TelemetryEvent[]; openTrace: (id: string) => void }) {
  return <div className="activity-table-scroll"><table className="activity-table"><thead><tr><th>Time / actor</th><th>Action</th><th>Channel</th><th>Status</th><th>Duration</th><th>Trace</th></tr></thead><tbody>{events.map(event => <tr key={event.id}>
    <td><time dateTime={event.startedAt}>{new Date(event.startedAt).toLocaleString()}</time><small title={event.actorId ?? undefined}>{event.actorId ?? 'Anonymous'}</small></td>
    <td><strong>{event.action}</strong>{event.projectId && <a href={`/?project=${encodeURIComponent(event.projectId)}`}>Project {event.projectId.slice(0, 8)} <ExternalLink size={12} /></a>}{event.errorCode && <code>{event.errorCode}</code>}</td>
    <td>{event.channel}<small>{event.kind}</small></td><td><span className={`activity-status ${event.status}`}>{event.status}</span></td><td>{event.durationMs === null ? '—' : `${event.durationMs.toLocaleString()} ms`}</td>
    <td><button className="text-button" onClick={() => openTrace(event.traceId)} aria-label={`Open trace ${event.traceId}`}>{event.traceId.slice(0, 8)} <ExternalLink size={13} /></button></td>
  </tr>)}</tbody></table></div>;
}
export function UsageDetails({ summary }: { summary: TelemetrySummary }) {
  const usage = summary.usage;
  return <>
    <div className="activity-section-heading"><h2>Provider usage</h2><span>Measured values only</span></div>
    <div className="activity-metrics usage"><Metric label="Provider calls" value={usage.providerCalls} /><Metric label="Input tokens" value={usage.inputTokens} /><Metric label="Output tokens" value={usage.outputTokens} /><Metric label="Reported spend" value={cost(usage.costUsd)} /></div>
    <p className="activity-note">Token measurements: {usage.measuredTokenCalls} / {usage.providerCalls} calls. Cost measurements: {usage.measuredCostCalls} / {usage.providerCalls} calls. Missing measurements are excluded; reported spend may be a partial total.</p>
    {summary.byProvider.length > 0 && <div className="activity-table-scroll"><table className="activity-table"><thead><tr><th>Provider / model</th><th>Calls</th><th>Errors</th><th>Input tokens</th><th>Output tokens</th><th>Reported spend</th></tr></thead><tbody>{summary.byProvider.map(row => <tr key={`${row.provider}:${row.model}`}><td>{row.provider}<small>{row.model ?? 'Model unavailable'}</small></td><td>{row.count}</td><td>{row.errors}</td><td>{quantity(row.inputTokens)}</td><td>{quantity(row.outputTokens)}</td><td>{cost(row.costUsd)}</td></tr>)}</tbody></table></div>}
    <div className="activity-breakdowns"><section><h2>Actions to inspect</h2>{summary.byAction.length ? <ul>{summary.byAction.map(row => <li key={row.action}><strong>{row.action}</strong><span>{row.count} calls · {row.errors} errors · {row.avgDurationMs === null ? 'no timing' : `${Math.round(row.avgDurationMs)} ms average`}</span></li>)}</ul> : <p>No measured actions yet.</p>}</section>
      <section><h2>Recent actors</h2><p className="activity-note">Recent activity does not imply someone is online.</p><ul>{summary.byActor.map(row => <li key={row.actorId ?? 'anonymous'}><code>{row.actorId ?? 'Anonymous'}</code><span>{row.count} actions · {row.errors} errors · {new Date(row.lastSeen).toLocaleString()}</span></li>)}</ul></section></div>
  </>;
}
function depth(event: TelemetryEvent, events: TelemetryEvent[]) {
  const visited = new Set([event.id]); let parent = event.parentId, level = 0;
  while (parent && !visited.has(parent) && level < 8) { visited.add(parent); level++; parent = events.find(row => row.id === parent)?.parentId ?? null; }
  return level;
}
export function TraceDetails({ trace, onClose }: { trace: TelemetryTrace; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return <Modal title="Trace details" onClose={onClose}><div className="modal-body activity-trace"><div className="activity-trace-id"><code>{trace.traceId}</code><button className="icon-button" title={copied ? 'Copied' : 'Copy trace ID'} aria-label="Copy trace ID" onClick={() => void navigator.clipboard?.writeText(trace.traceId).then(() => setCopied(true)).catch(() => setCopied(false))}><Copy size={17} /></button></div><span role="status">{copied ? 'Trace ID copied' : ''}</span>
    {trace.truncated && <p role="status">This trace exceeds the display limit. The visible steps are a partial trace.</p>}
    <ol className="activity-spans">{trace.events.map(event => <li key={event.id} style={{ marginInlineStart: `${depth(event, trace.events) * 12}px` }}><div><strong>{event.action}</strong><span className={`activity-status ${event.status}`}>{event.status}</span></div><p>{event.kind} · {event.channel} · {event.durationMs === null ? 'Timing unavailable' : `${event.durationMs} ms`} · HTTP {event.httpStatus ?? '—'}</p>{event.errorCode && <p className="activity-error"><code>{event.errorCode}</code></p>}<small>{new Date(event.startedAt).toLocaleString()} · actor {event.actorId ?? 'anonymous'}</small>{event.provider && <p>{event.provider} / {event.model ?? 'unknown model'} · tokens in {quantity(event.inputTokens)}, out {quantity(event.outputTokens)} · {cost(event.costUsd)}</p>}<details><summary>Correlation</summary><code>Span: {event.id}<br />Parent: {event.parentId ?? 'Root request'}<br />Usage source: {event.usageSource}<br />Output bytes: {quantity(event.outputBytes)}</code></details></li>)}</ol>
  </div></Modal>;
}
