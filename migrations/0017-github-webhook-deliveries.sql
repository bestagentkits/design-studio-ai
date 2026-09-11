CREATE TABLE github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX github_webhook_delivery_retention ON github_webhook_deliveries(processed_at);
