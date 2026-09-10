import {documentWriteSchema} from '../shared/document-write';
import {motionProposalSchema} from '../shared/motion-proposal';
import {exportOptionsSchema} from '../shared/export-contract';
import { mediaInputSchema, generationInputSchema, providerInterviewSchema } from '../shared/provider-requests';
import { providerIdSchema, builtInProviders } from '../shared/providers';
import { z } from 'zod';
import { operationsSchema, mutateDocument } from '../shared/operations';
import { documentSchema, type DesignDocument } from '../shared/schema';
import { apiEndpoints } from '../shared/api-reference';
import { componentNames, componentSchema, layoutSchema, sceneObjectSchema } from '../shared/design-capabilities';
import { designSystemSchema } from '../shared/design-systems';
import { assetUploadBody } from './api-request-body';

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; execute: (args: Record<string, unknown>) => Promise<unknown> }
interface Context { registerTool: (tool: Tool) => void; unregisterTool?: (name: string) => void }
export function registerDesignTools(context: Context, get: () => DesignDocument, set: (doc: DesignDocument) => void) {
  const result = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const tools: Tool[] = [{
    name: 'studio_apply_operations', description: 'Atomically edit the open document using shared operations: add/update/delete/reparent nodes, page/layout, themes, tracks and keyframes. Changes appear immediately; live mode autosaves. Get the document first.',
    inputSchema: z.toJSONSchema(z.object({ operations: operationsSchema })),
    execute: async args => { const next = mutateDocument(get(), args.operations); set(next); return result({ document: next }); },
  }, {
    name: 'studio_capabilities', description: 'Discover canonical document/operation/component/layout/3D schemas and available API operations.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
    execute: async () => result({ providers: builtInProviders, providerId: z.toJSONSchema(providerIdSchema), mediaInput: z.toJSONSchema(mediaInputSchema), generationInput: z.toJSONSchema(generationInputSchema), documentWrite:z.toJSONSchema(documentWriteSchema),motionProposal:z.toJSONSchema(motionProposalSchema),exportInput:z.toJSONSchema(exportOptionsSchema), providerInterview: z.toJSONSchema(providerInterviewSchema), componentNames, document: z.toJSONSchema(documentSchema), operations: z.toJSONSchema(operationsSchema), designSystem: z.toJSONSchema(designSystemSchema), component: z.toJSONSchema(componentSchema), layout: z.toJSONSchema(layoutSchema), scene: z.toJSONSchema(sceneObjectSchema), endpoints: apiEndpoints }),
  }];
  // Only first-party documented endpoints are callable; the browser supplies its own session.
  for (const endpoint of apiEndpoints.filter(e => !e.path.endsWith('/client-events') && !e.path.includes('/auth/') && !e.path.includes('/tokens') && (!e.path.includes('/providers') || e.method === 'GET'))) {
    const operation = `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/^\/api\//, '').replace(/\{(\w+)\}/g, '$1').replace(/[^a-z0-9]/gi, '_')}`;
    tools.push({ name: `studio_api_${operation}`, description: endpoint.summary + '. Operates on the saved server state; pass current revisions for writes. Publications are public snapshots.',
      annotations: { readOnlyHint: endpoint.method === 'GET' },
      inputSchema: { type: 'object', properties: { parameters: { type: 'object', additionalProperties: { type: 'string' } }, query: { type: 'object', additionalProperties: { type: 'string' } }, ...(endpoint.body ? { body: endpoint.method==='PUT'&&endpoint.path.endsWith('/document')?z.toJSONSchema(documentWriteSchema):endpoint.path.endsWith('/export') ? z.toJSONSchema(exportOptionsSchema) : endpoint.path.endsWith('/media') ? z.toJSONSchema(mediaInputSchema) : endpoint.path.endsWith('/generate') ? z.toJSONSchema(generationInputSchema) : endpoint.path.endsWith('/brief/interview') ? z.toJSONSchema(providerInterviewSchema) : { type: 'object' } } : {}) }, ...(endpoint.body ? { required: ['body'] } : {}) },
      execute: async args => {
        const parameters = args.parameters as Record<string, string> | undefined;
        const path = endpoint.path.replace(/\{(\w+)\}/g, (_, key: string) => { if (!parameters?.[key]) throw new Error(`Missing path parameter: ${key}`); return encodeURIComponent(parameters[key]); });
        const query = new URLSearchParams(args.query as Record<string, string> ?? {});
        const upload = endpoint.method === 'POST' && endpoint.path.endsWith('/assets');
        const response = await fetch(path + (query.size ? `?${query}` : ''), { method: endpoint.method, credentials: 'same-origin', headers: { 'X-Studio-Client': 'webmcp', ...(!upload ? { 'Content-Type': 'application/json' } : {}) }, ...(endpoint.body ? { body: upload ? assetUploadBody(args.body as Record<string, unknown>) : JSON.stringify(args.body) } : {}) });
        if ((response.headers.get('Content-Type') ?? '').includes('json')) { const data = await response.json(); return { ...result(data), ...(!response.ok ? { isError: true } : {}) }; }
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'studio-export'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        return result({ downloaded: true, mimeType: blob.type, bytes: blob.size });
      },
    });
  }
  for (const tool of tools) context.registerTool(tool);
  return () => tools.forEach(tool => context.unregisterTool?.(tool.name));
}
