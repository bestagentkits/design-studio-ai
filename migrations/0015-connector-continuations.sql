ALTER TABLE connector_operations ADD COLUMN parent_operation_id TEXT REFERENCES connector_operations(id);
CREATE UNIQUE INDEX connector_operations_one_continuation ON connector_operations(parent_operation_id) WHERE parent_operation_id IS NOT NULL;
