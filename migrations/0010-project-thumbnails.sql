ALTER TABLE projects ADD COLUMN thumbnail_deleting INTEGER NOT NULL DEFAULT 0;
CREATE TABLE project_thumbnails (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('rendering','ready','failed')),
  storage_key TEXT,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(project_id, revision)
);
