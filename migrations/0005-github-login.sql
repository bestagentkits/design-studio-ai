CREATE TABLE github_accounts (
  github_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE github_login_states (
  hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX github_login_states_expiry ON github_login_states(expires_at);
