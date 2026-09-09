import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { telemetryChannels, telemetryKinds, telemetryStatuses, type TelemetryEvents, type TelemetrySummary, type TelemetryTrace } from '../shared/observability';
import { api, message, type User } from './api';
import { ActivityEvents, TraceDetails, UsageDetails, Metric } from './observability-details';
import './observability.css';

export function ObservabilityDashboard({ user, onSignIn }: { user: User | null; onSignIn: () => void }) {
  const initial = new URLSearchParams(location.search);
  const [filters, setFilters] = useState(() => ({ days: ['1', '7', '30'].includes(initial.get('days') ?? '') ? initial.get('days')! : '7', scope: initial.get('scope') === 'all' ? 'all' : 'owner', channel: initial.get('channel') ?? '', kind: initial.get('kind') ?? '', status: initial.get('status') ?? '', projectId: initial.get('projectId') ?? '', actorId: initial.get('actorId') ?? '' }));
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [events, setEvents] = useState<TelemetryEvents>({ events: [], nextCursor: null });
  const [trace, setTrace] = useState<TelemetryTrace | null>(null);
  const [traceId, setTraceId] = useState(initial.get('trace') ?? '');
  const [operator, setOperator] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false), [autoRefresh, setAutoRefresh] = useState(false);
  const generation = useRef(0), traceGeneration = useRef(0);
  useEffect(() => () => { traceGeneration.current++; generation.current++; }, []);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  useEffect(() => { if (user) void api<{ observability?: { operator: boolean } }>('/api/config').then(data => setOperator(data.observability?.operator ?? false)).catch(() => {}); }, [user?.id]);
  async function load(append = false) {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const [nextSummary, nextEvents] = await Promise.all([
        api<TelemetrySummary>(`/api/observability/summary?${query}`),
        api<TelemetryEvents>(`/api/observability/events?${query}${append && events.nextCursor ? `&cursor=${encodeURIComponent(events.nextCursor)}` : ''}`),
      ]);
      if (current !== generation.current) return;
      setSummary(nextSummary); setEvents(previous => ({ ...nextEvents, events: append ? [...previous.events, ...nextEvents.events] : nextEvents.events }));
    } catch (reason) { if (current === generation.current) setError(message(reason)); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => void load(), 200);
    return () => { clearTimeout(timer); generation.current++; };
  }, [user?.id, query]);
  useEffect(() => {
    if (!autoRefresh || !user) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, user?.id, query]);
  function filter(key: keyof typeof filters, value: string) {
    const next = { ...filters, [key]: value, ...(key === 'scope' && value === 'owner' ? { actorId: '' } : {}) };
    setFilters(next); setTrace(null); traceGeneration.current++; generation.current++;
    setSummary(null); setEvents({ events: [], nextCursor: null }); setError(''); setLoading(true);
    history.replaceState(null, '', `/activity?${new URLSearchParams(Object.entries(next).filter(([, entry]) => entry))}`);
  }
  async function openTrace(id: string) {
    const current = ++traceGeneration.current;
    setError(''); setTraceId(id);
    try {
      const data = await api<TelemetryTrace>(`/api/observability/trace/${encodeURIComponent(id)}?scope=${filters.scope}&days=${filters.days}`);
      if (current !== traceGeneration.current) return;
      setTrace(data);
      const url = new URL(location.href); url.searchParams.set('trace', id); history.replaceState(null, '', url.pathname + url.search);
    } catch (reason) { if (current === traceGeneration.current) setError(message(reason)); }
  }
  useEffect(() => { if (user && initial.get('trace')) void openTrace(initial.get('trace')!); }, [user?.id]);
  if (!user) return <section className="activity-dashboard"><Activity size={32} /><h1>Understand your studio</h1><p>Sign in to inspect activity, trace errors, and see measured provider usage for your account.</p><button className="button primary" onClick={onSignIn}>Sign in to view activity</button></section>;
  return <section className="activity-dashboard" aria-labelledby="activity-title">
    <header className="activity-heading"><div><p className="eyebrow">WORKSPACE HEALTH</p><h1 id="activity-title">Activity & usage</h1><p>Follow an action from request to result. Find errors and see what your providers report.</p></div>
      <button className="button" onClick={() => void load()} disabled={loading} aria-label="Refresh activity"><RefreshCw size={17} /> Refresh</button></header>
    <div className="activity-filters">
      <label>Period<select value={filters.days} onChange={e => filter('days', e.target.value)}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      <label>Scope<select value={filters.scope} onChange={e => filter('scope', e.target.value)}><option value="owner">My account</option>{(operator || filters.scope === 'all') && <option value="all">All accounts · operator</option>}</select></label>
      {(['channel', 'kind', 'status'] as const).map(key => <label key={key}>{key[0]!.toUpperCase() + key.slice(1)}<select aria-label={`Filter activity ${key}`} value={filters[key]} onChange={e => filter(key, e.target.value)}><option value="">All {key === 'kind' ? 'operations' : key + 's'}</option>{(key === 'channel' ? telemetryChannels : key === 'kind' ? telemetryKinds : telemetryStatuses).map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>Project ID<input value={filters.projectId} onChange={e => filter('projectId', e.target.value)} placeholder="Any project" /></label>
      {operator && filters.scope === 'all' && <label>Actor ID<input value={filters.actorId} onChange={e => filter('actorId', e.target.value)} placeholder="Any account" /></label>}
      <label className="activity-auto"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> Refresh every 15s</label>
    </div>
    {error && <p role="alert" className="activity-error">{error}</p>}
    <div aria-busy={loading}>
      {summary && <>
        <div className="activity-metrics"><Metric label="Requests" value={summary.totals.requests} /><Metric label="Errors" value={summary.totals.errors} tone={summary.totals.errors ? 'error' : undefined} /><Metric label="Success" value={summary.totals.successRate === null ? null : `${(summary.totals.successRate * 100).toFixed(1)}%`} /><Metric label="Average latency" value={summary.totals.avgDurationMs === null ? null : `${Math.round(summary.totals.avgDurationMs)} ms`} /><Metric label="Running" value={summary.totals.running} /><Metric label="Interrupted / unknown" value={summary.totals.interrupted} /></div>
        <UsageDetails summary={summary} />
      </>}
      <div className="activity-section-heading"><h2>Activity log</h2><form className="activity-trace-search" onSubmit={e => { e.preventDefault(); if (traceId.trim()) void openTrace(traceId.trim()); }}><label className="sr-only" htmlFor="trace-search">Request or trace ID</label><input id="trace-search" value={traceId} onChange={e => setTraceId(e.target.value)} placeholder="Request or trace ID" /><button className="icon-button" aria-label="Find trace"><Search size={18} /></button></form></div>
      <ActivityEvents events={events.events} openTrace={id => void openTrace(id)} />
      {!events.events.length && <p className="activity-empty">{loading ? 'Loading activity…' : 'No activity matches these filters. Create or edit a project, then refresh.'}</p>}
      {events.nextCursor && <button className="button" disabled={loading} onClick={() => void load(true)}><ArrowDown size={16} /> Load older activity</button>}
    </div>
    {summary && <details className="activity-coverage"><summary><ShieldCheck size={17} /> Coverage & data quality</summary><p>Stored for {summary.coverage.retentionDays} days. Recording since {summary.coverage.instrumentedSince ? new Date(summary.coverage.instrumentedSince).toLocaleString() : 'no recorded activity yet'}. Storage: {summary.coverage.storage}. Dropped events: {summary.coverage.droppedEvents}.</p><p>PostHog: {summary.coverage.posthog.configured ? 'configured' : 'not configured'} · delivery failures: {summary.coverage.posthog.deliveryFailures} · last accepted delivery: {summary.coverage.posthog.lastDeliveryAt ? new Date(summary.coverage.posthog.lastDeliveryAt).toLocaleString() : 'none observed'}.</p><ul>{summary.coverage.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>}
    {trace && <TraceDetails trace={trace} onClose={() => { traceGeneration.current++; setTrace(null); const url = new URL(location.href); url.searchParams.delete('trace'); history.replaceState(null, '', url.pathname + url.search); }} />}
  </section>;
}
