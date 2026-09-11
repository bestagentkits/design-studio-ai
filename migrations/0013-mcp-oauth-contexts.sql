CREATE TABLE connection_mcp_oauth_setups (
  state_hash TEXT PRIMARY KEY NOT NULL REFERENCES connection_auth_states(state_hash) ON DELETE CASCADE,
  encrypted_context TEXT NOT NULL CHECK(length(CAST(encrypted_context AS BLOB)) BETWEEN 1 AND 131072)
);
CREATE TABLE connection_mcp_oauth_clients (
  connection_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  encrypted_context TEXT NOT NULL CHECK(length(CAST(encrypted_context AS BLOB)) BETWEEN 1 AND 131072),
  FOREIGN KEY(connection_id,user_id) REFERENCES connections(id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER connection_credentials_clear_mcp_client
AFTER DELETE ON connection_credentials
BEGIN
  DELETE FROM connection_mcp_oauth_clients WHERE connection_id=OLD.connection_id AND user_id=OLD.user_id;
END;
