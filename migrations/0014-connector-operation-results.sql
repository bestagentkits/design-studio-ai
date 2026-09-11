ALTER TABLE connector_operations ADD COLUMN encrypted_result TEXT
  CHECK(encrypted_result IS NULL OR length(CAST(encrypted_result AS BLOB)) BETWEEN 1 AND 1572864);
-- Invalidation and retention already erase arguments; results share their privacy lifetime.
CREATE TRIGGER connector_operation_result_cleanup
AFTER UPDATE OF encrypted_arguments ON connector_operations
WHEN NEW.encrypted_arguments IS NULL
BEGIN
  UPDATE connector_operations SET encrypted_result=NULL WHERE id=NEW.id AND user_id=NEW.user_id;
END;
