# Connector surface parity — 2026-09-11

Implementation mapping at code revision `085732a`. These are shared route registrations, not separate claims of live-provider acceptance. CLI names use hyphens under `dsa connectors`; incoming MCP uses the names below. WebMCP exposes each allowed REST endpoint with an explicit project grant.

| Contract | REST | UI | CLI / MCP / WebMCP |
| --- | --- | --- | --- |
| `list_project_connections` | `GET /api/projects/{projectId}/connections` | Project bindings | Implemented / implemented / implemented |
| `discover_connection_tools` | `POST /api/projects/{projectId}/connections/{bindingId}/capabilities` | Inspect capabilities | Implemented / implemented / implemented |
| `list_project_sources` | `GET /api/projects/{projectId}/sources` | Source snapshots | Implemented / implemented / implemented |
| `read_project_source` | `GET /api/projects/{projectId}/sources/{sourceId}` | Read/download source | Implemented / implemented / implemented |
| `import_connection_source` | `POST /api/projects/{projectId}/connections/{bindingId}/sources` | Import snapshot | Implemented / implemented / implemented |
| `import_source_asset` | `POST /api/projects/{projectId}/sources/{sourceId}/asset` | Copy image to assets | Implemented / implemented / implemented |
| `refresh_project_source` | `POST /api/projects/{projectId}/sources/{sourceId}/refresh` | Refresh snapshot | Implemented / implemented / implemented |
| `list_connector_operations` | `GET /api/projects/{projectId}/connector-operations` | Recent actions | Implemented / implemented / implemented |
| `prepare_connector_operation` | `POST /api/projects/{projectId}/connector-operations` | Prepare for review | Implemented / implemented / implemented |
| `get_connector_operation` | `GET /api/projects/{projectId}/connector-operations/{operationId}` | Inspect action | Implemented / implemented / implemented |
| `execute_connector_operation` | `POST /api/projects/{projectId}/connector-operations/{operationId}/execute` | Execute approved action | Implemented / implemented / implemented |
| `read_connector_export` | `GET /api/projects/{projectId}/connector-operations/{operationId}/artifact` | Download prepared file | Implemented / implemented / implemented |
| `reconcile_connector_operation` | `POST /api/projects/{projectId}/connector-operations/{operationId}/reconcile` | Check remote result without retrying | Implemented / implemented / implemented |
| `cancel_connector_operation` | `POST /api/projects/{projectId}/connector-operations/{operationId}/cancel` | Cancel action | Implemented / implemented / implemented |
| `list_agent_runs` | `GET /api/projects/{projectId}/runs` | Run activity | Implemented / implemented / implemented |
| `start_agent_run` | `POST /api/projects/{projectId}/runs` | Tool-assisted chat | Implemented / implemented / implemented |
| `get_agent_run` | `GET /api/projects/{projectId}/runs/{runId}` | Inspect saved run | Implemented / implemented / implemented |
| `advance_agent_run` | `POST /api/projects/{projectId}/runs/{runId}/advance` | Continue run | Implemented / implemented / implemented |
| `cancel_agent_run` | `POST /api/projects/{projectId}/runs/{runId}/cancel` | Cancel run | Implemented / implemented / implemented |
| `get_agent_run_proposal` | `GET /api/projects/{projectId}/runs/{runId}/proposal` | Review/apply unsaved proposal | Implemented / implemented / implemented |

Account authentication/reconnect/disconnect, project binding changes, grant management, operation approval/denial and input-required continuation authorization are human-only REST/UI flows. CLI, MCP and WebMCP hand off to the signed-in Studio UI; they cannot issue their own approval or acquire credentials. WebMCP browser cookies do not bypass the explicit grant. Legacy tokens gain no implicit connector authority.

Owners: `src/shared/connector-agent-contracts.ts`, `src/shared/api-reference.ts`, `packages/cli/src/connector-commands.ts`, `server/connector-agent-tools.ts`, `src/app/browser-design-tools.ts`. Tests: connector-agent-surfaces, connector-contracts, CLI and security-boundaries suites passed within 367/367; generated public docs and browser docs tests passed. Real native-provider/model acceptance remains in [live acceptance](live-acceptance.md).
