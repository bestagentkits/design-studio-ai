CREATE TABLE observability_events (
  id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE CASCADE, channel TEXT NOT NULL, kind TEXT NOT NULL,
  action TEXT NOT NULL, project_id TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  duration_ms REAL, status TEXT NOT NULL, http_status INTEGER, error_code TEXT,
  provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
  cost_usd REAL, output_bytes INTEGER, usage_source TEXT NOT NULL DEFAULT 'unavailable'
);
CREATE INDEX observability_owner_time ON observability_events(actor_id, started_at DESC, id DESC);
CREATE INDEX observability_trace ON observability_events(trace_id, started_at, id);
CREATE INDEX observability_status_time ON observability_events(status, started_at DESC);
CREATE INDEX observability_kind_time ON observability_events(kind, started_at DESC);
ALTER TABLE media_jobs ADD COLUMN observability_span_id TEXT;
