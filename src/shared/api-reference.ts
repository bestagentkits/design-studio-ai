import { z } from 'zod';
import { clientEventSchema, telemetryQuerySchema } from './observability';
export const apiEndpoints = [
  { method: 'GET', path: '/api/health', summary: 'Health', body: undefined },
  { method: 'GET', path: '/api/schema', summary: 'Document and operation schemas', body: undefined },
  { method: 'GET', path: '/api/catalog', summary: 'Templates, themes and blocks', body: undefined },
  { method: 'GET', path: '/api/fonts', summary: 'Search Google Fonts catalog', body: undefined },
  { method: 'GET', path: '/api/providers/{provider}/models', summary: 'Discover provider models', body: undefined },
  { method: 'GET', path: '/api/design-systems', summary: 'List your design systems', body: undefined },
  { method: 'POST', path: '/api/design-systems', summary: 'Create a reusable design system', body: { name: 'My system', system: 'shadcn', theme: {}, components: [], compositions: [] } },
  { method: 'GET', path: '/api/design-systems/{id}', summary: 'Read a design system (optional version query)', body: undefined },
  { method: 'GET', path: '/api/design-systems/{id}/versions', summary: 'List immutable design-system versions', body: undefined },
  { method: 'PUT', path: '/api/design-systems/{id}', summary: 'Append a design-system version with conflict protection', body: { expectedVersion: 1, definition: {} } },
  { method: 'POST', path: '/api/design-systems/{id}/apply', summary: 'Apply a saved design system to a project', body: { projectId: '', expectedRevision: 1 } },
  { method: 'POST', path: '/api/design-systems/{id}/insert', summary: 'Insert a reusable component or composition', body: { projectId: '', expectedRevision: 1, pageId: '', itemId: '' } },
  { method: 'DELETE', path: '/api/design-systems/{id}', summary: 'Delete library; existing projects retain embedded designs', body: undefined },
  { method: 'GET', path: '/api/projects', summary: 'List your projects', body: undefined },
  { method: 'POST', path: '/api/projects', summary: 'Create a project', body: { name: 'My design', kind: 'web' } },
  { method: 'GET', path: '/api/projects/{id}', summary: 'Read a project', body: undefined },
  { method: 'PUT', path: '/api/projects/{id}/document', summary: 'Save a validated document at the observed revision', body: { expectedRevision: 1, document: {} } },
  { method: 'POST', path: '/api/projects/{id}/merge', summary: 'Merge nonconflicting human and agent edits', body: { baseRevision: 1, base: {}, document: {} } },
  { method: 'GET', path: '/api/projects/{id}/changes', summary: 'Read current revision and changes', body: undefined },
  { method: 'GET', path: '/api/projects/{id}/checks', summary: 'Inspect design', body: undefined },
  { method: 'GET', path: '/api/projects/{id}/brief', summary: 'Read design brief', body: undefined },
  { method: 'PUT', path: '/api/projects/{id}/brief', summary: 'Update request, answers and scope', body: { expectedRevision: 0, request: 'Design a product landing page' } },
  { method: 'POST', path: '/api/projects/{id}/brief/approve', summary: 'Explicitly approve the reviewed scope', body: { expectedRevision: 1 } },
  { method: 'POST', path: '/api/projects/{id}/brief/interview', summary: 'Prepare interview using your provider', body: { expectedRevision: 1, provider: 'openai' } },
  { method: 'PATCH', path: '/api/projects/{id}', summary: 'Rename or describe a project', body: { name: 'Updated name' } },
  { method: 'GET', path: '/api/projects/{id}/assets', summary: 'List owned assets', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/assets', summary: 'Upload a file (WebMCP converts base64 to multipart)', body: { name: 'asset.png', mimeType: 'image/png', base64: '' } },
  { method: 'POST', path: '/api/projects/{id}/google-slides', summary: 'Export using your Google access token', body: { accessToken: '' } },
  { method: 'GET', path: '/api/projects/{id}/messages', summary: 'Read project conversation', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/messages', summary: 'Store a conversation message', body: { role: 'user', text: 'Refine the header spacing' } },
  { method: 'POST', path: '/api/projects/{id}/generate', summary: 'Generate a design proposal with a configured provider', body: { provider: 'openai', expectedRevision: 1, prompt: 'Refine the header spacing' } },
  { method: 'POST', path: '/api/projects/{id}/media', summary: 'Generate images with OpenAI, Gemini, Leonardo, Grok or custom providers; OpenAI speech and fal media also supported', body: { provider: 'openai', kind: 'image', prompt: 'A ceramic vase in soft light' } },
  { method: 'GET', path: '/api/projects/{id}/media/{jobId}', summary: 'Read generation job status', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/export', summary: 'Export saved design', body: { format: 'html' } },
  { method: 'POST', path: '/api/projects/{id}/publish', summary: 'Publish an immutable snapshot', body: {} },
  { method: 'DELETE', path: '/api/projects/{id}/publish', summary: 'Unpublish the current public snapshot', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/preview', summary: 'Create a public immutable preview snapshot', body: {} },
  { method: 'DELETE', path: '/api/projects/{id}/preview', summary: 'Remove all public snapshots (preview alias)', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/share', summary: 'Create a public immutable share snapshot', body: {} },
  { method: 'DELETE', path: '/api/projects/{id}/share', summary: 'Remove all public snapshots (share alias)', body: undefined },
  { method: 'DELETE', path: '/api/projects/{id}', summary: 'Delete project and assets', body: undefined },
  { method: 'PUT', path: '/api/providers/{provider}', summary: 'Save an official or custom BYOK connection (account session or API key only)', body: { apiKey: '<secure credential>', model: '<model ID>' } },
  { method: 'DELETE', path: '/api/providers/{provider}', summary: 'Remove an owned BYOK connection (account session or API key only)', body: undefined },
  { method: 'GET', path: '/api/providers', summary: 'Read provider configuration metadata', body: undefined },
  { method: 'GET', path: '/api/observability/summary', summary: 'Account activity, measured usage and coverage; scope=all requires configured operator', body: undefined },
  { method: 'GET', path: '/api/observability/events', summary: 'Paginated activity events with owner isolation', body: undefined },
  { method: 'GET', path: '/api/observability/trace/{id}', summary: 'Read correlated trace steps visible to your account', body: undefined },
  { method: 'POST', path: '/api/observability/client-events', summary: 'Submit an allowlisted browser event without private content', body: { event: 'page_view', page: 'templates' } },
] as const;
export function openApiDocument(schemas: Record<string, unknown>) {
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
    const upload = method === 'POST' && path.endsWith('/assets');
    const content = upload
      ? { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } }
      : { 'application/json': { schema: path.endsWith('/client-events') ? z.toJSONSchema(clientEventSchema) : schemas[`${method} ${path}`] ?? { type: 'object' }, example: body } };
    (paths[path] ??= {})[method.toLowerCase()] = { summary, parameters,
      ...(body ? { requestBody: { required: true, content } } : {}),
      responses: { '2XX': { description: 'Success; exports return file bytes with Content-Type and Content-Disposition' }, '400': { description: 'Invalid request' }, '401': { description: 'Authentication required' }, '403': { description: 'Insufficient scope' }, '404': { description: 'Resource not found' }, '409': { description: 'Revision or merge conflict' } },
    };
  }
  return { openapi: '3.1.0', info: { title: 'Design Studio AI', version: '0.3.2' }, servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => /^[\w.-]+$/.test(name))) }, paths };
}
