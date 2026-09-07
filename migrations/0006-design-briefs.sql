CREATE TABLE design_briefs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  brief TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
