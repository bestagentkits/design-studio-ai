import { connectionCreateSchema } from './connectors';
import { mcpConnectionSetupSchema, mcpAuthorizationStartSchema, connectionBindingCreateSchema, connectionGrantCreateSchema, connectionBindingRemoveSchema } from './connector-management';
import { z } from 'zod';
import { clientEventSchema, telemetryQuerySchema } from './observability';
interface ApiEndpoint { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; summary: string; body: unknown; agentExposure: 'allowed' | 'human-only' | 'none' }
export const apiEndpoints = [
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
  schemas = { 'POST /api/projects/{id}/connections': z.toJSONSchema(connectionBindingCreateSchema), 'DELETE /api/projects/{id}/connections/{bindingId}': z.toJSONSchema(connectionBindingRemoveSchema), 'POST /api/projects/{id}/connections/{bindingId}/grants': z.toJSONSchema(connectionGrantCreateSchema), 'POST /api/connections': z.toJSONSchema(connectionCreateSchema), 'POST /api/connectors/mcp/connect': z.toJSONSchema(mcpConnectionSetupSchema), 'POST /api/connectors/mcp/authorize': z.toJSONSchema(mcpAuthorizationStartSchema), ...schemas };
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
      : { 'application/json': { schema: path.endsWith('/client-events') ? z.toJSONSchema(clientEventSchema) : schemas[`${method} ${path}`] ?? { type: 'object' }, example: body } };
    (paths[path] ??= {})[method.toLowerCase()] = { summary, parameters, 'x-studio-agent-exposure': endpoint.agentExposure,
      ...(body ? { requestBody: { required: true, content } } : {}),
      responses: { '2XX': { description: 'Success; exports return file bytes with Content-Type and Content-Disposition' }, '400': { description: 'Invalid request' }, '401': { description: 'Authentication required' }, '403': { description: 'Insufficient scope' }, '404': { description: 'Resource not found' }, '409': { description: 'Revision or merge conflict' } },
    };
  }
  return { openapi: '3.1.0', info: { title: 'Design Studio AI', version: '0.3.1' }, servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => /^[\w.-]+$/.test(name))) }, paths };
}
