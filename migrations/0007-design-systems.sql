CREATE TABLE design_systems (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX design_systems_owner ON design_systems(user_id);
CREATE TABLE design_system_versions (
  system_id TEXT NOT NULL REFERENCES design_systems(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(system_id, version)
);
