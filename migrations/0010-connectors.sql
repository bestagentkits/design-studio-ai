-- Composite parent keys make ownership part of every connector resource relationship.
CREATE UNIQUE INDEX projects_connector_owner_key ON projects(id, user_id);
CREATE UNIQUE INDEX sessions_connector_owner_key ON sessions(hash, user_id);

CREATE TABLE connections (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adapter TEXT NOT NULL CHECK(adapter IN ('mcp', 'github', 'google-drive')),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  endpoint TEXT CHECK(endpoint IS NULL OR length(endpoint) BETWEEN 1 AND 2048),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('anonymous', 'bearer', 'oauth')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'connected', 'needs_reauthorization', 'disconnected')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  remote_identity TEXT CHECK(remote_identity IS NULL OR length(remote_identity) BETWEEN 1 AND 512),
  scopes_json TEXT NOT NULL DEFAULT '[]' CHECK(length(CAST(scopes_json AS BLOB)) <= 131072 AND json_valid(scopes_json) AND json_type(scopes_json) = 'array' AND json_array_length(scopes_json) <= 100),
  capability_fingerprint TEXT CHECK(capability_fingerprint IS NULL OR (length(capability_fingerprint) = 64 AND capability_fingerprint NOT GLOB '*[^a-f0-9]*')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, user_id),
  CHECK((adapter = 'mcp' AND endpoint IS NOT NULL) OR (adapter != 'mcp' AND endpoint IS NULL AND auth_mode = 'oauth')),
  CHECK(status != 'connected' OR adapter = 'mcp' OR remote_identity IS NOT NULL)
);
CREATE INDEX connections_owner_updated ON connections(user_id, updated_at DESC, id);

CREATE TABLE connection_credentials (
  connection_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL CHECK(length(CAST(encrypted_payload AS BLOB)) BETWEEN 1 AND 131072),
  expires_at INTEGER CHECK(expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at >= 0)),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(credential_version) = 'integer' AND credential_version BETWEEN 1 AND 9007199254740991),
  refresh_lease_id TEXT,
  refresh_lease_expires_at INTEGER CHECK(refresh_lease_expires_at IS NULL OR (typeof(refresh_lease_expires_at) = 'integer' AND refresh_lease_expires_at >= 0)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connection_id, user_id) REFERENCES connections(id, user_id) ON DELETE CASCADE,
  CHECK((refresh_lease_id IS NULL) = (refresh_lease_expires_at IS NULL))
);
CREATE INDEX connection_credentials_expiry ON connection_credentials(expires_at);
CREATE INDEX connection_credentials_refresh_lease ON connection_credentials(refresh_lease_expires_at);

CREATE TABLE connection_auth_states (
  state_hash TEXT PRIMARY KEY NOT NULL CHECK(length(state_hash) BETWEEN 32 AND 128),
  connection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL CHECK(length(CAST(encrypted_verifier AS BLOB)) BETWEEN 1 AND 4096),
  expected_issuer TEXT NOT NULL CHECK(length(expected_issuer) BETWEEN 1 AND 2048),
  expected_resource TEXT NOT NULL CHECK(length(expected_resource) BETWEEN 1 AND 2048),
  redirect_uri TEXT NOT NULL CHECK(length(redirect_uri) BETWEEN 1 AND 2048),
  return_intent_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(return_intent_json AS BLOB)) <= 4096 AND json_valid(return_intent_json) AND json_type(return_intent_json) = 'object'),
  connection_revision INTEGER NOT NULL CHECK(typeof(connection_revision) = 'integer' AND connection_revision BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at) = 'integer' AND expires_at >= 0),
  consumed_at TEXT,
  FOREIGN KEY(connection_id, user_id) REFERENCES connections(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(session_hash, user_id) REFERENCES sessions(hash, user_id) ON DELETE CASCADE
);
CREATE INDEX connection_auth_states_expiry ON connection_auth_states(expires_at);
CREATE INDEX connection_auth_states_connection ON connection_auth_states(connection_id, user_id);
CREATE INDEX connection_auth_states_session ON connection_auth_states(session_hash, user_id);

CREATE TABLE project_connection_bindings (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('source', 'tool', 'destination')),
  selection_json TEXT NOT NULL CHECK(length(CAST(selection_json AS BLOB)) <= 1048576 AND json_valid(selection_json) AND json_type(selection_json) = 'object'),
  disabled_at TEXT,
  policy_revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(policy_revision) = 'integer' AND policy_revision BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, user_id, project_id, connection_id),
  UNIQUE(id, user_id, project_id),
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id, user_id) REFERENCES connections(id, user_id) ON DELETE CASCADE
);
CREATE INDEX project_connection_bindings_project ON project_connection_bindings(project_id, user_id);
CREATE INDEX project_connection_bindings_connection ON project_connection_bindings(connection_id, user_id);

-- Principal IDs identify authenticated session/token/family/WebMCP-grant/run records.
-- Runtime authorization must resolve active principals; polymorphic IDs alone never grant access.
CREATE TABLE connection_agent_grants (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK(principal_kind IN ('session', 'api', 'oauth', 'webmcp', 'run')),
  principal_id TEXT NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 128),
  principal_client_id TEXT,
  policy_revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(policy_revision) = 'integer' AND policy_revision BETWEEN 1 AND 9007199254740991),
  capabilities_json TEXT NOT NULL CHECK(length(CAST(capabilities_json AS BLOB)) <= 1024 AND json_valid(capabilities_json) AND json_type(capabilities_json) = 'array' AND json_array_length(capabilities_json) BETWEEN 1 AND 5),
  selection_json TEXT NOT NULL CHECK(length(CAST(selection_json AS BLOB)) <= 1048576 AND json_valid(selection_json) AND json_type(selection_json) = 'object'),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at) = 'integer' AND expires_at >= 0),
  revoked_at TEXT,
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id, user_id) REFERENCES connections(id, user_id) ON DELETE CASCADE,
  CHECK((principal_kind = 'oauth' AND principal_client_id IS NOT NULL AND length(principal_client_id) BETWEEN 1 AND 128) OR (principal_kind != 'oauth' AND principal_client_id IS NULL))
);
CREATE INDEX connection_agent_grants_principal ON connection_agent_grants(user_id, project_id, connection_id, principal_kind, principal_id, principal_client_id);
CREATE INDEX connection_agent_grants_connection ON connection_agent_grants(connection_id, user_id);
CREATE INDEX connection_agent_grants_expiry ON connection_agent_grants(expires_at);

CREATE TABLE project_source_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  binding_id TEXT,
  adapter TEXT NOT NULL CHECK(adapter IN ('mcp', 'github', 'google-drive')),
  remote_identity TEXT NOT NULL CHECK(length(remote_identity) BETWEEN 1 AND 2048),
  remote_version TEXT NOT NULL CHECK(length(remote_version) BETWEEN 1 AND 512),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
  content_object_key TEXT NOT NULL CHECK(length(content_object_key) BETWEEN 1 AND 512),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 120),
  bytes INTEGER NOT NULL CHECK(typeof(bytes) = 'integer' AND bytes BETWEEN 0 AND 20971520),
  extraction_version TEXT NOT NULL CHECK(length(extraction_version) BETWEEN 1 AND 100),
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'disconnected')),
  UNIQUE(id, user_id, project_id),
  CHECK(binding_id IS NOT NULL OR status = 'disconnected'),
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(binding_id, user_id, project_id) REFERENCES project_connection_bindings(id, user_id, project_id) ON DELETE CASCADE
);
CREATE INDEX project_source_snapshots_binding ON project_source_snapshots(binding_id, user_id, project_id, fetched_at DESC);
CREATE INDEX project_source_snapshots_project ON project_source_snapshots(project_id, user_id);
-- Snapshot content/provenance is append-only; status may change when its connection disconnects.
CREATE TRIGGER project_source_snapshots_immutable
BEFORE UPDATE OF id, user_id, project_id, binding_id, adapter, remote_identity, remote_version,
  content_hash, content_object_key, mime_type, bytes, extraction_version, fetched_at
ON project_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Source snapshot content and provenance are immutable');
END;


CREATE TABLE connector_operations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK(principal_kind IN ('session', 'api', 'oauth', 'webmcp', 'run')),
  principal_id TEXT NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 128),
  principal_client_id TEXT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 200),
  effect TEXT NOT NULL CHECK(effect IN ('read', 'write', 'unknown')),
  arguments_hash TEXT NOT NULL CHECK(length(arguments_hash) = 64 AND arguments_hash NOT GLOB '*[^a-f0-9]*'),
  action_fingerprint TEXT NOT NULL CHECK(length(action_fingerprint) = 64 AND action_fingerprint NOT GLOB '*[^a-f0-9]*'),
  destination_hash TEXT NOT NULL CHECK(length(destination_hash) = 64 AND destination_hash NOT GLOB '*[^a-f0-9]*'),
  versions_json TEXT NOT NULL CHECK(length(CAST(versions_json AS BLOB)) <= 32768 AND json_valid(versions_json) AND json_type(versions_json) = 'object'),
  encrypted_arguments TEXT CHECK(encrypted_arguments IS NULL OR length(CAST(encrypted_arguments AS BLOB)) BETWEEN 1 AND 131072),
  approval_id TEXT,
  lease_id TEXT,
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR (typeof(lease_expires_at) = 'integer' AND lease_expires_at >= 0)),
  remote_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(length(CAST(remote_ids_json AS BLOB)) <= 524288 AND json_valid(remote_ids_json) AND json_type(remote_ids_json) = 'array' AND json_array_length(remote_ids_json) <= 100),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_expires_at INTEGER CHECK(payload_expires_at IS NULL OR (typeof(payload_expires_at) = 'integer' AND payload_expires_at >= 0)),
  UNIQUE(id, user_id),
  UNIQUE(id, user_id, project_id),
  FOREIGN KEY(binding_id, user_id, project_id, connection_id) REFERENCES project_connection_bindings(id, user_id, project_id, connection_id) ON DELETE CASCADE,
  FOREIGN KEY(approval_id, id, user_id) REFERENCES connector_approvals(id, operation_id, user_id),
  CHECK((principal_kind = 'oauth' AND principal_client_id IS NOT NULL AND length(principal_client_id) BETWEEN 1 AND 128) OR (principal_kind != 'oauth' AND principal_client_id IS NULL)),
  CHECK((lease_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK((status = 'running') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(status != 'running' OR effect = 'read' OR approval_id IS NOT NULL)
);
CREATE UNIQUE INDEX connector_operations_idempotency ON connector_operations(user_id, project_id, principal_kind, principal_id, COALESCE(principal_client_id, ''), idempotency_key);
CREATE INDEX connector_operations_project ON connector_operations(project_id, user_id, created_at DESC);
CREATE INDEX connector_operations_binding ON connector_operations(binding_id, user_id, project_id, connection_id);
CREATE INDEX connector_operations_lease ON connector_operations(status, lease_expires_at);
CREATE INDEX connector_operations_retention ON connector_operations(payload_expires_at);

CREATE TABLE connector_approvals (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  operation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  arguments_hash TEXT NOT NULL CHECK(length(arguments_hash) = 64 AND arguments_hash NOT GLOB '*[^a-f0-9]*'),
  action_fingerprint TEXT NOT NULL CHECK(length(action_fingerprint) = 64 AND action_fingerprint NOT GLOB '*[^a-f0-9]*'),
  destination_hash TEXT NOT NULL CHECK(length(destination_hash) = 64 AND destination_hash NOT GLOB '*[^a-f0-9]*'),
  versions_json TEXT NOT NULL CHECK(length(CAST(versions_json AS BLOB)) <= 32768 AND json_valid(versions_json) AND json_type(versions_json) = 'object'),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at) = 'integer' AND expires_at >= 0),
  consumed_at TEXT,
  UNIQUE(id, operation_id, user_id),
  FOREIGN KEY(operation_id, user_id) REFERENCES connector_operations(id, user_id) ON DELETE CASCADE
);
CREATE INDEX connector_approvals_operation ON connector_approvals(operation_id, user_id);
CREATE INDEX connector_approvals_expiry ON connector_approvals(expires_at);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL CHECK(principal_kind IN ('session', 'api', 'oauth', 'webmcp', 'run')),
  principal_id TEXT NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 128),
  principal_client_id TEXT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'ready_to_continue' CHECK(status IN ('ready_to_continue', 'running', 'awaiting_approval', 'needs_reauthorization', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')),
  provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 128),
  model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
  pins_json TEXT NOT NULL CHECK(length(CAST(pins_json AS BLOB)) <= 524288 AND json_valid(pins_json) AND json_type(pins_json) = 'array' AND json_array_length(pins_json) BETWEEN 1 AND 20),
  source_snapshot_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(length(CAST(source_snapshot_ids_json AS BLOB)) <= 16384 AND json_valid(source_snapshot_ids_json) AND json_type(source_snapshot_ids_json) = 'array' AND json_array_length(source_snapshot_ids_json) <= 100),
  model_turns INTEGER NOT NULL DEFAULT 0 CHECK(typeof(model_turns) = 'integer' AND model_turns BETWEEN 0 AND 8),
  tool_calls INTEGER NOT NULL DEFAULT 0 CHECK(typeof(tool_calls) = 'integer' AND tool_calls BETWEEN 0 AND 12),
  active_ms INTEGER NOT NULL DEFAULT 0 CHECK(typeof(active_ms) = 'integer' AND active_ms BETWEEN 0 AND 300000),
  pending_operation_id TEXT,
  proposal_id TEXT CHECK(proposal_id IS NULL OR length(proposal_id) BETWEEN 1 AND 128),
  lease_id TEXT,
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR (typeof(lease_expires_at) = 'integer' AND lease_expires_at >= 0)),
  encrypted_payload TEXT CHECK(encrypted_payload IS NULL OR length(CAST(encrypted_payload AS BLOB)) BETWEEN 1 AND 4194304),
  payload_expires_at INTEGER CHECK(payload_expires_at IS NULL OR (typeof(payload_expires_at) = 'integer' AND payload_expires_at >= 0)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, user_id, project_id),
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(pending_operation_id, user_id, project_id) REFERENCES connector_operations(id, user_id, project_id) ON DELETE CASCADE,
  CHECK((principal_kind = 'oauth' AND principal_client_id IS NOT NULL AND length(principal_client_id) BETWEEN 1 AND 128) OR (principal_kind != 'oauth' AND principal_client_id IS NULL)),
  CHECK((lease_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK((status = 'running') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(status != 'awaiting_approval' OR pending_operation_id IS NOT NULL),
  CHECK(status != 'succeeded' OR proposal_id IS NOT NULL)
);
CREATE UNIQUE INDEX agent_runs_idempotency ON agent_runs(user_id, project_id, principal_kind, principal_id, COALESCE(principal_client_id, ''), idempotency_key);
CREATE INDEX agent_runs_project ON agent_runs(project_id, user_id, created_at DESC);
CREATE INDEX agent_runs_pending_operation ON agent_runs(pending_operation_id, user_id, project_id);
CREATE INDEX agent_runs_lease ON agent_runs(status, lease_expires_at);
CREATE INDEX agent_runs_retention ON agent_runs(payload_expires_at);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  kind TEXT NOT NULL CHECK(kind IN ('model', 'tool', 'proposal')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')),
  operation_id TEXT,
  lease_id TEXT,
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR (typeof(lease_expires_at) = 'integer' AND lease_expires_at >= 0)),
  encrypted_payload TEXT CHECK(encrypted_payload IS NULL OR length(CAST(encrypted_payload AS BLOB)) BETWEEN 1 AND 2097152),
  payload_expires_at INTEGER CHECK(payload_expires_at IS NULL OR (typeof(payload_expires_at) = 'integer' AND payload_expires_at >= 0)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, sequence),
  FOREIGN KEY(run_id, user_id, project_id) REFERENCES agent_runs(id, user_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY(operation_id, user_id, project_id) REFERENCES connector_operations(id, user_id, project_id) ON DELETE CASCADE,
  CHECK((lease_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK((status = 'running') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX run_steps_run ON run_steps(run_id, user_id, project_id);
CREATE INDEX run_steps_operation ON run_steps(operation_id, user_id, project_id);
CREATE INDEX run_steps_lease ON run_steps(status, lease_expires_at);
CREATE INDEX run_steps_retention ON run_steps(payload_expires_at);
