CREATE TABLE community_admin_claims (
  email_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_at TEXT NOT NULL
);
CREATE INDEX community_admin_claims_user ON community_admin_claims(user_id);
