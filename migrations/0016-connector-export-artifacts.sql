CREATE TABLE connector_export_artifacts (
  operation_id TEXT PRIMARY KEY REFERENCES connector_operations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 32 AND 20971520),
  remote_id TEXT NOT NULL
);
CREATE TRIGGER connector_export_artifact_cleanup AFTER DELETE ON connector_export_artifacts BEGIN
  INSERT OR IGNORE INTO connector_object_cleanup(object_key,state,lease_id,due_at,created_at)
  VALUES(OLD.object_key,'deleting',NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER connector_export_payload_expired AFTER UPDATE OF encrypted_arguments ON connector_operations
WHEN NEW.encrypted_arguments IS NULL BEGIN
  DELETE FROM connector_export_artifacts WHERE operation_id=NEW.id;
END;
