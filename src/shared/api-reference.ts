import { connectorRequestBodySchema } from './connector-agent-contracts';
import { agentRunStartSchema, agentRunAdvanceSchema } from './agent-runs';
import { connectorOperationPrepareSchema, connectorOperationExecuteSchema, connectorOperationDecisionSchema } from './connector-operations';
import { connectorSourceImportSchema } from './connector-management';
import { connectionCreateSchema } from './connectors';
import { mcpConnectionSetupSchema, mcpAuthorizationStartSchema, connectionBindingCreateSchema, connectionGrantCreateSchema, connectionBindingRemoveSchema, connectionBindingUpdateSchema } from './connector-management';
import { z } from 'zod';
import { clientEventSchema, telemetryQuerySchema } from './observability';
interface ApiEndpoint { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; summary: string; body: unknown; agentExposure: 'allowed' | 'human-only' | 'none' }
export const apiEndpoints = [
  {agentExposure:'human-only',method:'PUT',path:'/api/projects/{id}/connections/{bindingId}',summary:'Change the explicit project selection with revision checks; revoke grants and retain disconnected source copies',body:{expectedPolicyRevision:1,role:'source',selection:{adapter:'mcp',tools:[],resources:[]}}},
  {agentExposure:'human-only',method:'GET',path:'/api/connections/agent-recipients',summary:'List owned active OAuth authorization identities for explicit connector grants; no tokens',body:undefined},
  {agentExposure:'human-only',method:'POST',path:'/api/connectors/github/authorize',summary:'Begin separate GitHub App authorization for a verified installation',body:{connectionId:'',expectedRevision:1,installationId:''}},
  {agentExposure:'human-only',method:'GET',path:'/api/connectors/github/callback',summary:'Complete one-use GitHub authorization bound to the initiating session',body:undefined},
  {agentExposure:'human-only',method:'GET',path:'/api/connectors/github/repositories',summary:'List repositories accessible to the user and selected GitHub installation; connectionId and page query parameters',body:undefined},
  {agentExposure:'human-only',method:'POST',path:'/api/connectors/github/resolve',summary:'Resolve a selected repository branch or tag to an immutable commit',body:{connectionId:'',repositoryId:'',ref:'main'}},
  {agentExposure:'none',method:'POST',path:'/api/connectors/github/webhook',summary:'Receive signature-verified GitHub installation and authorization revocations',body:{}},
  {agentExposure:'allowed',method:'POST',path:'/api/projects/{id}/sources/{sourceId}/asset',summary:'Copy a granted image snapshot into isolated project assets without changing the document',body:{}},
  {agentExposure:'allowed',method:'POST',path:'/api/projects/{id}/connector-operations/{operationId}/reconcile',summary:'Reconcile an uncertain Drive upload or GitHub PR using recorded identities; never repeats external writes',body:{expectedRevision:1}},
  {agentExposure:'allowed',method:'GET',path:'/api/projects/{id}/connector-operations/{operationId}/artifact',summary:'Download an authorized prepared PDF, PPTX or React ZIP for inspection before upload',body:undefined},
  {agentExposure:'human-only',method:'POST',path:'/api/connectors/google-drive/authorize',summary:'Begin separate session-bound Google Drive authorization',body:{connectionId:'',expectedRevision:1}},
  {agentExposure:'human-only',method:'GET',path:'/api/connectors/google-drive/callback',summary:'Redeem a one-use Google callback for the initiating session',body:undefined},
  {agentExposure:'human-only',method:'POST',path:'/api/connectors/google-drive/picker',summary:'Obtain a transient selected-account access token for Google Picker; never returns refresh credentials',body:{connectionId:''}},
  {agentExposure:'human-only',method:'POST',path:'/api/projects/{id}/connector-operations/{operationId}/continuation',summary:'Supply explicitly reviewed input to a paused MCP operation; creates a separately approved continuation',body:{expectedRevision:1,inputResponses:{}}},
  {agentExposure:'allowed',method:'GET',path:'/api/projects/{id}/runs',summary:'List saved run metadata without advancing',body:undefined},
  {agentExposure:'allowed',method:'POST',path:'/api/projects/{id}/runs',summary:'Persist a bounded run at exact document and brief versions',body:{provider:'openai',prompt:'Refine design',bindingIds:[],sourceSnapshotIds:[],expectedDocumentRevision:1,expectedBriefRevision:1,idempotencyKey:'unique-request-key'}},
  {agentExposure:'allowed',method:'GET',path:'/api/projects/{id}/runs/{runId}',summary:'Read run status, authorized proposal and provider usage',body:undefined},
  {agentExposure:'allowed',method:'POST',path:'/api/projects/{id}/runs/{runId}/advance',summary:'Advance exactly one run step with current grants',body:{expectedRevision:1}},
  {agentExposure:'allowed',method:'POST',path:'/api/projects/{id}/runs/{runId}/cancel',summary:'Cancel future steps and preserve uncertain in-flight outcomes',body:{expectedRevision:1}},
  {agentExposure:'allowed',method:'GET',path:'/api/projects/{id}/runs/{runId}/proposal',summary:'Revalidate a completed unsaved proposal against current authority and versions',body:undefined},
  {"agentExposure": "human-only", "method": "GET", "path": "/api/projects/{id}/connections/{bindingId}/grants", "summary": "Inspect existing agent grants for a project binding", "body": undefined},
  {"agentExposure": "allowed", "method": "GET", "path": "/api/projects/{id}/sources", "summary": "List private source metadata; agent results are limited to current source grants", "body": undefined},
  {"agentExposure": "allowed", "method": "GET", "path": "/api/projects/{id}/sources/{sourceId}", "summary": "Download an authorized immutable source as inert data", "body": undefined},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/sources/{sourceId}/refresh", "summary": "Import a new source snapshot without replacing existing content or brief", "body": {}},
  {"agentExposure": "human-only", "method": "DELETE", "path": "/api/projects/{id}/sources/{sourceId}", "summary": "Remove an owned source snapshot and invalidate dependent work", "body": undefined},
  {"agentExposure": "human-only", "method": "POST", "path": "/api/connections/{connectionId}/capabilities", "summary": "Discover bounded MCP capabilities before granting a project access", "body": {}},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/connections/{bindingId}/capabilities", "summary": "Discover only capabilities selected by both the project and agent grant", "body": {}},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/connections/{bindingId}/sources", "summary": "Import one selected MCP resource or Drive file as an immutable source snapshot", "body": {"uri": "resource://selected"}},
  {"agentExposure": "allowed", "method": "GET", "path": "/api/projects/{id}/connector-operations", "summary": "List the latest 50 operation records without private payloads", "body": undefined},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/connector-operations", "summary": "Prepare a selected tool operation against exact observed versions; unknown effects require human approval", "body": {"bindingId": "", "action": "", "arguments": {}, "idempotencyKey": "unique-request-key", "expectedVersions": {"connectionRevision": 1, "credentialVersion": 1, "policyRevision": 1, "documentRevision": 1, "briefRevision": 0, "sourceSnapshotIds": []}}},
  {"agentExposure": "allowed", "method": "GET", "path": "/api/projects/{id}/connector-operations/{operationId}", "summary": "Inspect an operation and authorized private payload without advancing it", "body": undefined},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/connector-operations/{operationId}/execute", "summary": "Claim approved operation once; uncertain results are never replayed", "body": {"expectedRevision": 1}},
  {"agentExposure": "human-only", "method": "POST", "path": "/api/projects/{id}/connector-operations/{operationId}/decision", "summary": "Approve once or deny the exact operation in an authenticated browser session", "body": {"expectedRevision": 1, "decision": "approve"}},
  {"agentExposure": "allowed", "method": "POST", "path": "/api/projects/{id}/connector-operations/{operationId}/cancel", "summary": "Cancel own pending operation with revision protection", "body": {"expectedRevision": 1}},
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/connections', summary: 'List project bindings; agents see only explicitly granted discovery selections', body: undefined },
  { agentExposure: 'human-only', method: 'POST', path: '/api/projects/{id}/connections', summary: 'Bind a connected account and explicit selection to an owned project', body: { connectionId: '', role: 'tool', selection: { adapter: 'mcp', tools: [], resources: [] } } },
  { agentExposure: 'human-only', method: 'DELETE', path: '/api/projects/{id}/connections/{bindingId}', summary: 'Remove a project binding, revoke grants and invalidate dependent work', body: { expectedPolicyRevision: 1 } },
  { agentExposure: 'human-only', method: 'POST', path: '/api/projects/{id}/connections/{bindingId}/grants', summary: 'Grant an active agent explicit capabilities and selection with expiry', body: { recipient: { kind: 'webmcp' }, expectedPolicyRevision: 1, capabilities: ['discover'], selection: { adapter: 'mcp', tools: [], resources: [] }, expiresAt: '<ISO timestamp within 90 days>' } },
  { agentExposure: 'human-only', method: 'DELETE', path: '/api/projects/{id}/connections/{bindingId}/grants/{grantId}', summary: 'Revoke an owned active project connection grant', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/connections', summary: 'List connection metadata; agents require projectId and explicit discovery grants; requires connectors enabled', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/connections/{connectionId}', summary: 'Read owned connection metadata; agents require projectId and explicit discovery grants', body: undefined },
  { agentExposure: 'human-only', method: 'POST', path: '/api/connections', summary: 'Create pending connection metadata using a signed-in session', body: { displayName: 'My MCP server', config: { adapter: 'mcp', endpoint: 'https://mcp.example.com/mcp', authMode: 'oauth' } } },
  { agentExposure: 'human-only', method: 'POST', path: '/api/connections/{connectionId}/disconnect', summary: 'Disconnect and revoke grants using a signed-in session', body: { expectedRevision: 1 } },
  { agentExposure: 'human-only', method: 'POST', path: '/api/connectors/mcp/connect', summary: 'Verify anonymous or bearer MCP access using a signed-in session', body: { connectionId: '', expectedRevision: 1 } },
  { agentExposure: 'human-only', method: 'POST', path: '/api/connectors/mcp/authorize', summary: 'Begin session-bound MCP OAuth authorization', body: { connectionId: '', expectedRevision: 1, options: { profile: 'modern' } } },
  { agentExposure: 'none', method: 'GET', path: '/api/connectors/mcp/client-metadata', summary: 'Public first-party OAuth client metadata when connectors are enabled', body: undefined },
  { agentExposure: 'human-only', method: 'GET', path: '/api/connectors/mcp/callback', summary: 'Redeem one-use OAuth callback bound to the initiating browser session', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/health', summary: 'Health', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/schema', summary: 'Document and operation schemas', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/catalog', summary: 'Templates, themes and blocks', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/fonts', summary: 'Search Google Fonts catalog', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/providers/{provider}/models', summary: 'Discover provider models', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/design-systems', summary: 'List your design systems', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/design-systems', summary: 'Create a reusable design system', body: { name: 'My system', system: 'shadcn', theme: {}, components: [], compositions: [] } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/design-systems/{id}', summary: 'Read a design system (optional version query)', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/design-systems/{id}/versions', summary: 'List immutable design-system versions', body: undefined },
  { agentExposure: 'allowed', method: 'PUT', path: '/api/design-systems/{id}', summary: 'Append a design-system version with conflict protection', body: { expectedVersion: 1, definition: {} } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/design-systems/{id}/apply', summary: 'Apply a saved design system to a project', body: { projectId: '', expectedRevision: 1 } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/design-systems/{id}/insert', summary: 'Insert a reusable component or composition', body: { projectId: '', expectedRevision: 1, pageId: '', itemId: '' } },
  { agentExposure: 'allowed', method: 'DELETE', path: '/api/design-systems/{id}', summary: 'Delete library; existing projects retain embedded designs', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects', summary: 'List your projects', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects', summary: 'Create a project', body: { name: 'My design', kind: 'web' } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}', summary: 'Read a project', body: undefined },
  { agentExposure: 'allowed', method: 'PUT', path: '/api/projects/{id}/document', summary: 'Save a validated document at the observed revision', body: { expectedRevision: 1, document: {} } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/merge', summary: 'Merge nonconflicting human and agent edits', body: { baseRevision: 1, base: {}, document: {} } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/changes', summary: 'Read current revision and changes', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/checks', summary: 'Inspect design', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/brief', summary: 'Read design brief', body: undefined },
  { agentExposure: 'allowed', method: 'PUT', path: '/api/projects/{id}/brief', summary: 'Update request, answers and scope', body: { expectedRevision: 0, request: 'Design a product landing page' } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/brief/approve', summary: 'Explicitly approve the reviewed scope', body: { expectedRevision: 1 } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/brief/interview', summary: 'Prepare interview using your provider', body: { expectedRevision: 1, provider: 'openai' } },
  { agentExposure: 'allowed', method: 'PATCH', path: '/api/projects/{id}', summary: 'Rename or describe a project', body: { name: 'Updated name' } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/assets', summary: 'List owned assets', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/assets', summary: 'Upload a file (WebMCP converts base64 to multipart)', body: { name: 'asset.png', mimeType: 'image/png', base64: '' } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/google-slides', summary: 'Export using your Google access token', body: { accessToken: '' } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/messages', summary: 'Read project conversation', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/messages', summary: 'Store a conversation message', body: { role: 'user', text: 'Refine the header spacing' } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/generate', summary: 'Generate a design proposal with a configured provider', body: { provider: 'openai', expectedRevision: 1, prompt: 'Refine the header spacing' } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/media', summary: 'Generate images with OpenAI, Gemini, Leonardo, Grok or custom providers; OpenAI speech and fal media also supported', body: { provider: 'openai', kind: 'image', prompt: 'A ceramic vase in soft light' } },
  { agentExposure: 'allowed', method: 'GET', path: '/api/projects/{id}/media/{jobId}', summary: 'Read generation job status', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/export', summary: 'Export saved design', body: { format: 'html' } },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/publish', summary: 'Publish an immutable snapshot', body: {} },
  { agentExposure: 'allowed', method: 'DELETE', path: '/api/projects/{id}/publish', summary: 'Unpublish the current public snapshot', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/preview', summary: 'Create a public immutable preview snapshot', body: {} },
  { agentExposure: 'allowed', method: 'DELETE', path: '/api/projects/{id}/preview', summary: 'Remove all public snapshots (preview alias)', body: undefined },
  { agentExposure: 'allowed', method: 'POST', path: '/api/projects/{id}/share', summary: 'Create a public immutable share snapshot', body: {} },
  { agentExposure: 'allowed', method: 'DELETE', path: '/api/projects/{id}/share', summary: 'Remove all public snapshots (share alias)', body: undefined },
  { agentExposure: 'allowed', method: 'DELETE', path: '/api/projects/{id}', summary: 'Delete project and assets', body: undefined },
  { agentExposure: 'human-only', method: 'PUT', path: '/api/providers/{provider}', summary: 'Save an official or custom BYOK connection (account session or API key only)', body: { apiKey: '<secure credential>', model: '<model ID>' } },
  { agentExposure: 'human-only', method: 'DELETE', path: '/api/providers/{provider}', summary: 'Remove an owned BYOK connection (account session or API key only)', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/providers', summary: 'Read provider configuration metadata', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/observability/summary', summary: 'Account activity, measured usage and coverage; scope=all requires configured operator', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/observability/events', summary: 'Paginated activity events with owner isolation', body: undefined },
  { agentExposure: 'allowed', method: 'GET', path: '/api/observability/trace/{id}', summary: 'Read correlated trace steps visible to your account', body: undefined },
  { agentExposure: 'none', method: 'POST', path: '/api/observability/client-events', summary: 'Submit an allowlisted browser event without private content', body: { event: 'page_view', page: 'templates' } },
] as const satisfies readonly ApiEndpoint[];
export function openApiDocument(schemas: Record<string, unknown>) {
  schemas = { 'PUT /api/projects/{id}/connections/{bindingId}':z.toJSONSchema(connectionBindingUpdateSchema), 'POST /api/projects/{id}/runs':z.toJSONSchema(agentRunStartSchema), 'POST /api/projects/{id}/runs/{runId}/advance':z.toJSONSchema(agentRunAdvanceSchema), 'POST /api/projects/{id}/runs/{runId}/cancel':z.toJSONSchema(agentRunAdvanceSchema), 'POST /api/projects/{id}/connections/{bindingId}/sources': z.toJSONSchema(connectorSourceImportSchema), 'POST /api/projects/{id}/connector-operations': z.toJSONSchema(connectorOperationPrepareSchema), 'POST /api/projects/{id}/connector-operations/{operationId}/execute': z.toJSONSchema(connectorOperationExecuteSchema), 'POST /api/projects/{id}/connector-operations/{operationId}/decision': z.toJSONSchema(connectorOperationDecisionSchema), 'POST /api/projects/{id}/connector-operations/{operationId}/cancel': z.toJSONSchema(connectorOperationExecuteSchema),  'POST /api/projects/{id}/connections': z.toJSONSchema(connectionBindingCreateSchema), 'DELETE /api/projects/{id}/connections/{bindingId}': z.toJSONSchema(connectionBindingRemoveSchema), 'POST /api/projects/{id}/connections/{bindingId}/grants': z.toJSONSchema(connectionGrantCreateSchema), 'POST /api/connections': z.toJSONSchema(connectionCreateSchema), 'POST /api/connectors/mcp/connect': z.toJSONSchema(mcpConnectionSetupSchema), 'POST /api/connectors/mcp/authorize': z.toJSONSchema(mcpAuthorizationStartSchema), ...schemas };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of apiEndpoints) {
    const { method, path, summary, body } = endpoint;
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true, schema: { type: 'string' } }));
    if (path === '/api/fonts' || path.endsWith('/models')) parameters.push({ name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Case-insensitive catalog search' });
    if (method === 'GET' && path === '/api/design-systems/{id}') parameters.push({ name: 'version', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Immutable version; latest when omitted' });
    if (method === 'GET' && path.startsWith('/api/observability/')) {
      const definition = z.toJSONSchema(telemetryQuerySchema) as { properties: Record<string, unknown> };
      for (const [name, schema] of Object.entries(definition.properties)) parameters.push({ name, in: 'query', schema });
    }
    if (method === 'GET' && path.startsWith('/api/connections')) parameters.push({name:'projectId',in:'query',schema:{type:'string'},description:'Required for agent callers; explicit discovery grant required.'});
    const upload = method === 'POST' && path.endsWith('/assets');
    const content = upload
      ? { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } }
      : { 'application/json': { schema: path.endsWith('/client-events') ? z.toJSONSchema(clientEventSchema) : schemas[`${method} ${path}`] ?? connectorRequestBodySchema(method,path) ?? { type: 'object' }, example: body } };
    (paths[path] ??= {})[method.toLowerCase()] = { summary, parameters, 'x-studio-agent-exposure': endpoint.agentExposure,
      ...(body ? { requestBody: { required: true, content } } : {}),
      responses: { '2XX': { description: 'Success; exports return file bytes with Content-Type and Content-Disposition' }, '400': { description: 'Invalid request' }, '401': { description: 'Authentication required' }, '403': { description: 'Insufficient scope' }, '404': { description: 'Resource not found' }, '409': { description: 'Revision or merge conflict' } },
    };
  }
  return { openapi: '3.1.0', info: { title: 'Design Studio AI', version: '0.3.1' }, servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => /^[\w.-]+$/.test(name))) }, paths };
}
