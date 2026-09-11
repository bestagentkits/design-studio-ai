import { z } from 'zod';
import { clientEventSchema, telemetryQuerySchema } from './observability';
export const apiEndpoints = [
  {method:'GET',path:'/api/projects/{id}/scene/animation',summary:'Inspect complete animation; required pageId and optional start, end, samples (2–61) query',body:undefined},
  {method:'POST',path:'/api/projects/{id}/operations',summary:'Start idempotent save/export job; reuse operationId and exact payload on uncertain response',body:{kind:'export',operationId:'unique-operation-id',input:{format:'glb',expectedRevision:1,pageIndex:0}}},
  {method:'GET',path:'/api/projects/{id}/operations/{operationId}',summary:'Read owner-scoped operation status, stage, revision and result URL',body:undefined},
  {method:'GET',path:'/api/projects/{id}/operations/{operationId}/result',summary:'Download completed operation result',body:undefined},
  { method: 'GET', path: '/api/projects/{id}/scene', summary: 'Inspect 3D mesh topology, skin weights, skeleton and sampled pose; optional pageId and time query', body: undefined },
  { method: 'POST', path: '/api/projects/{id}/scene', summary: 'Preview or apply a bounded 3D authoring command with revision checking; discover sceneCommands in schema', body: { pageId: 'page-id', expectedRevision: 1, preview: true, command: { action: 'convert', nodeId: 'model-id' } } },
  { method: 'GET', path: '/api/health', summary: 'Health', body: undefined },
  { method: 'GET', path: '/api/schema', summary: 'Document v1/v2 and shared operation schemas', body: undefined },
  { method: 'GET', path: '/api/catalog', summary: 'Templates, themes, blocks and generation prompts', body: undefined },
  { method: 'GET', path: '/api/fonts', summary: 'Search Google Fonts catalog', body: undefined },
  { method: 'GET', path: '/api/providers/{provider}/models', summary: 'Discover provider models', body: undefined },
  { method: 'GET', path: '/api/design-systems', summary: 'List your design systems', body: undefined },
  { method: 'POST', path: '/api/design-systems', summary: 'Create a reusable design system', body: { name: 'My system', system: 'shadcn', theme: {}, components: [], compositions: [] } },
  { method: 'POST', path: '/api/design-systems/import', summary: 'Compile a portable DESIGN.md + tokens.css + manifest.json folder into a design system', body: { manifest: { id: 'acme', name: 'Acme' }, designMd: '# Acme', tokensCss: ':root { --bg: #fff; --fg: #000; --accent: #123; --font-display: "Inter"; --font-body: "Inter"; }' } },
  { method: 'GET', path: '/api/design-systems/{id}', summary: 'Read a design system (optional version query)', body: undefined },
  { method: 'GET', path: '/api/design-systems/{id}/versions', summary: 'List immutable design-system versions', body: undefined },
  { method: 'PUT', path: '/api/design-systems/{id}', summary: 'Append a design-system version with conflict protection', body: { expectedVersion: 1, definition: {} } },
  { method: 'POST', path: '/api/design-systems/{id}/apply', summary: 'Apply a saved design system to a project', body: { projectId: '', expectedRevision: 1 } },
  { method: 'POST', path: '/api/design-systems/{id}/insert', summary: 'Insert a reusable component or composition', body: { projectId: '', expectedRevision: 1, pageId: '', itemId: '' } },
  { method: 'DELETE', path: '/api/design-systems/{id}', summary: 'Delete library; existing projects retain embedded designs', body: undefined },
  { method: 'GET', path: '/api/projects', summary: 'List your projects', body: undefined },
  { method: 'POST', path: '/api/projects', summary: 'Create a project', body: { name: 'My design', kind: 'web' } },
  { method: 'GET', path: '/api/projects/{id}', summary: 'Read a project', body: undefined },
  {method:'GET',path:'/api/projects/{id}/motion',summary:'Inspect character rigs, clips and sampled pose (characterId, nodeId, time query)',body:undefined},
  { method: 'POST', path: '/api/projects/{id}/paint', summary: 'Render an owned-layer stroke or fill; paintingCommand requires observed document revision, painting generation and an exact-retry operationId', body: { expectedRevision: 1, expectedGeneration: 0, operationId: 'unique-command-id', paintingId: 'painting', layerId: 'layer', action: { type: 'stroke', preset: 'bristle', size: 16, flow: .8, color: '#336699', points: [{ x: 20, y: 20, pressure: .5 }] } } },
  { method: 'PUT', path: '/api/projects/{id}/document', summary: 'Save shared v1/v2 boards, diagrams, Elements and painting layers at the observed revision; painting saves accept exact-retry operationId', body: { expectedRevision: 1, document: {} } },
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
  { method: 'GET', path: '/api/projects/{id}/thumbnail', summary: 'Load a private saved-revision PNG cover; first request renders and stores it (202 when busy)', body: undefined },
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
    if (path.endsWith('/thumbnail')) parameters.push({ name: 'revision', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Saved revision; defaults to current. Only the two latest completed covers are retained.' });
    const upload = method === 'POST' && path.endsWith('/assets');
    const content = upload
      ? { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } }
      : { 'application/json': { schema: path.endsWith('/client-events') ? z.toJSONSchema(clientEventSchema) : schemas[`${method} ${path}`] ?? { type: 'object' }, example: body } };
    (paths[path] ??= {})[method.toLowerCase()] = { summary, parameters,
      ...(body ? { requestBody: { required: true, content } } : {}),
      responses: { '2XX': { description: 'Success; exports return file bytes with Content-Type and Content-Disposition' }, '400': { description: 'Invalid request' }, '401': { description: 'Authentication required' }, '403': { description: 'Insufficient scope' }, '404': { description: 'Resource not found' }, '409': { description: 'Revision or merge conflict' } },
    };
    if (path.endsWith('/thumbnail')) (paths[path][method.toLowerCase()] as any).responses = { '200': { description: 'Private cached PNG', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, '202': { description: 'Rendering in progress; retry after 2 seconds' }, '400': { description: 'Invalid saved revision or unsupported media' }, '429': { description: 'Thumbnail render rate limit reached' }, '502': { description: 'Rendering failed' }, '401': { description: 'Authentication required' }, '404': { description: 'Project or retained revision unavailable' }, '409': { description: 'Revision changed during rendering' }, '503': { description: 'Render cooldown; retry later' } };
  }
  return { openapi: '3.1.0', info: { title: 'Design Studio AI', version: '0.4.0' }, servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => /^[\w.-]+$/.test(name))) }, paths };
}
