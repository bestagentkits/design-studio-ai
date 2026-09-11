-- Invalidate existing consent when a retained source changes lifecycle or is removed.
-- New operations may explicitly select the remaining disconnected project copy.
CREATE TRIGGER project_source_snapshots_invalidate_status
AFTER UPDATE OF status ON project_source_snapshots
WHEN OLD.status != NEW.status
BEGIN
  UPDATE connector_operations SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id
    AND status IN('pending','awaiting_approval','running')
    AND EXISTS(SELECT 1 FROM json_each(versions_json,'$.sourceSnapshotIds') WHERE value=OLD.id);
  UPDATE run_steps SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id AND status IN('pending','running')
    AND run_id IN(SELECT r.id FROM agent_runs r,json_each(r.pins_json) pin,
      json_each(pin.value,'$.versions.sourceSnapshotIds') source
      WHERE r.user_id=OLD.user_id AND r.project_id=OLD.project_id AND source.value=OLD.id);
  UPDATE agent_runs SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id
    AND status IN('ready_to_continue','running','awaiting_approval','needs_reauthorization')
    AND EXISTS(SELECT 1 FROM json_each(pins_json) pin,
      json_each(pin.value,'$.versions.sourceSnapshotIds') source WHERE source.value=OLD.id);
END;

CREATE TRIGGER project_source_snapshots_invalidate_delete
BEFORE DELETE ON project_source_snapshots
BEGIN
  UPDATE connector_operations SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id
    AND status IN('pending','awaiting_approval','running')
    AND EXISTS(SELECT 1 FROM json_each(versions_json,'$.sourceSnapshotIds') WHERE value=OLD.id);
  UPDATE run_steps SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id AND status IN('pending','running')
    AND run_id IN(SELECT r.id FROM agent_runs r,json_each(r.pins_json) pin,
      json_each(pin.value,'$.versions.sourceSnapshotIds') source
      WHERE r.user_id=OLD.user_id AND r.project_id=OLD.project_id AND source.value=OLD.id);
  UPDATE agent_runs SET
    status=CASE WHEN status='running' THEN 'outcome_unknown' ELSE 'cancelled' END,
    revision=revision+1,lease_id=NULL,lease_expires_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    payload_expires_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+604800000
  WHERE user_id=OLD.user_id AND project_id=OLD.project_id
    AND status IN('ready_to_continue','running','awaiting_approval','needs_reauthorization')
    AND EXISTS(SELECT 1 FROM json_each(pins_json) pin,
      json_each(pin.value,'$.versions.sourceSnapshotIds') source WHERE source.value=OLD.id);
END;
