-- No owner foreign key: object cleanup must survive project/account deletion.
CREATE TABLE connector_object_cleanup (
  object_key TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('uploading','deleting','abandoned')),
  lease_id TEXT,
  due_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX connector_object_cleanup_due ON connector_object_cleanup(due_at);
CREATE TRIGGER project_source_snapshots_queue_delete
BEFORE DELETE ON project_source_snapshots
BEGIN
  INSERT OR IGNORE INTO connector_object_cleanup(object_key,state,lease_id,due_at,created_at)
  VALUES(OLD.content_object_key,'deleting',NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
