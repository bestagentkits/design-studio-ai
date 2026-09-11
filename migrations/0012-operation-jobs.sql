CREATE TABLE operation_jobs (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 stage TEXT NOT NULL DEFAULT 'queued',
 input_key TEXT NOT NULL,
 result_key TEXT,
 result_type TEXT,
 revision INTEGER,
 error TEXT,
 lease TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 dispatched_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(project_id,user_id,operation_id)
);
CREATE INDEX operation_jobs_pending ON operation_jobs(status,lease_until);
CREATE INDEX operation_jobs_owner ON operation_jobs(user_id,created_at);
