CREATE TABLE IF NOT EXISTS asset_reservations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL CHECK(bytes > 0), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_reservations_owner ON asset_reservations(user_id, expires_at);
CREATE INDEX IF NOT EXISTS asset_reservations_project ON asset_reservations(project_id, expires_at);
CREATE TABLE IF NOT EXISTS creative_work_leases (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS creative_work_leases_owner ON creative_work_leases(user_id, expires_at);
CREATE TABLE IF NOT EXISTS creative_save_receipts (
  operation_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, user_id, operation_id)
);
