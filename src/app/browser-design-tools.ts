import {operationJobSchema} from '../shared/operation-jobs';
import {inspectSceneAnimation} from '../shared/scene-inspection';
import { sceneDocumentCommand } from './scene-document-command';
import { sceneCommandSchema } from '../shared/scene-authoring-schema';
import { inspectScene } from '../shared/scene-inspection';
import { paintingCommandSchema } from '../shared/painting-command';
import {documentWriteSchema} from '../shared/document-write';
import {motionProposalSchema} from '../shared/motion-proposal';
import {exportOptionsSchema} from '../shared/export-contract';
import { mediaInputSchema, generationInputSchema, providerInterviewSchema } from '../shared/provider-requests';
import { providerIdSchema, builtInProviders } from '../shared/providers';
import { z } from 'zod';
import { operationsSchema, operationSchema, mutateDocument } from '../shared/operations';
import { documentSchema, type DesignDocument } from '../shared/schema';
import { apiEndpoints } from '../shared/api-reference';
import { componentNames, componentSchema, layoutSchema, sceneObjectSchema } from '../shared/design-capabilities';
import { designSystemSchema } from '../shared/design-systems';
import { assetUploadBody } from './api-request-body';

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean>; execute: (args: Record<string, unknown>) => Promise<unknown> }
interface Context { registerTool: (tool: Tool) => void; unregisterTool?: (name: string) => void }
export function registerDesignTools(context: Context, get: () => DesignDocument, set: (doc: DesignDocument) => void) {
  const result = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const tools: Tool[] = [{name:'studio_inspect_scene_animation',description:'Sample the complete local animation and return time-indexed geometry diagnostics and foot contact errors.',inputSchema:{type:'object',properties:{pageId:{type:'string'},start:{type:'number'},end:{type:'number'},samples:{type:'integer'}},required:['pageId']},annotations:{readOnlyHint:true},execute:async args=>result(inspectSceneAnimation(get(),String(args.pageId),Number(args.start??0),Number(args.end??get().timeline?.duration??0),Number(args.samples??25)))},{
    name:'studio_scene_command', description:'Preview or apply an atomic 3D command to the open document. Discover sceneCommands via studio_capabilities. Compact response contains diagnostics, not mesh buffers. Preview defaults true; apply is undoable and live mode autosaves.',
    inputSchema:{type:'object',properties:{pageId:{type:'string'},command:{type:'object'},preview:{type:'boolean',default:true}},required:['pageId','command']},
    execute:async args=>{const input=z.object({pageId:z.string(),command:sceneCommandSchema,preview:z.boolean().default(true)}).parse(args);const original=get();const next=await sceneDocumentCommand(original,input.pageId,input.command);if(get()!==original)throw new Error('Design changed while geometry was processing. Inspect and retry.');if(!input.preview)set(next);return result({preview:input.preview,...inspectScene(next,input.pageId)});}
  },{
    name:'studio_inspect_scene',description:'Read compact 3D topology, rig and sampled pose diagnostics for the current unsaved document.',inputSchema:{type:'object',properties:{pageId:{type:'string'},time:{type:'number',minimum:0,maximum:3600}}},annotations:{readOnlyHint:true},
    execute:async args=>{const q=z.object({pageId:z.string().optional(),time:z.number().finite().min(0).max(3600).default(0)}).parse(args);return result(inspectScene(get(),q.pageId,q.time));}
  },{
    name: 'studio_apply_operations', description: 'Atomically edit the open document using shared operations: add/update/delete/reparent nodes, page/layout, themes, tracks, keyframes, boards, elements and painting manifests. Changes appear immediately; live mode autosaves. Get the document and studio_capabilities operation schemas first.',
    // Registration stays shallow: expanded node/character unions exceed browser host limits.
    // Execution still uses the complete shared validator; discover nested fields with studio_capabilities.
    inputSchema: { type: 'object', properties: { operations: { ...z.toJSONSchema(operationsSchema), items: { type: 'object', properties: { op: { type: 'string', enum: operationSchema.options.map(option => option.shape.op.value) } }, required: ['op'], additionalProperties: true } } }, required: ['operations'], additionalProperties: false },
    execute: async args => { const next = mutateDocument(get(), args.operations); set(next); return result({ document: next }); },
  }, {
    name: 'studio_capabilities', description: 'Discover canonical document/operation/component/layout/3D schemas and available API operations.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
    execute: async () => result({ operationJob:z.toJSONSchema(operationJobSchema),sceneCommands:z.toJSONSchema(sceneCommandSchema), supportedDocumentVersions: [1,2], providers: builtInProviders, providerId: z.toJSONSchema(providerIdSchema), mediaInput: z.toJSONSchema(mediaInputSchema), generationInput: z.toJSONSchema(generationInputSchema), documentWrite:z.toJSONSchema(documentWriteSchema),motionProposal:z.toJSONSchema(motionProposalSchema),exportInput:z.toJSONSchema(exportOptionsSchema), providerInterview: z.toJSONSchema(providerInterviewSchema), componentNames, document: z.toJSONSchema(documentSchema), operations: z.toJSONSchema(operationsSchema), designSystem: z.toJSONSchema(designSystemSchema), component: z.toJSONSchema(componentSchema), layout: z.toJSONSchema(layoutSchema), scene: z.toJSONSchema(sceneObjectSchema), endpoints: apiEndpoints }),
  }];
  // Only first-party documented endpoints are callable; the browser supplies its own session.
  for (const endpoint of apiEndpoints.filter(e => !e.path.endsWith('/client-events') && !e.path.includes('/auth/') && !e.path.includes('/tokens') && (!e.path.includes('/providers') || e.method === 'GET'))) {
    const operation = `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/^\/api\//, '').replace(/\{(\w+)\}/g, '$1').replace(/[^a-z0-9]/gi, '_')}`;
    tools.push({ name: `studio_api_${operation}`, description: endpoint.summary + '. Saved state; writes require observed revisions.' + (/\/(publish|preview|share)$/.test(endpoint.path)?' Creates or manages public snapshots.':''),
      annotations: { readOnlyHint: endpoint.method === 'GET' },
      inputSchema: { type: 'object', properties: { parameters: { type: 'object', additionalProperties: { type: 'string' } }, query: { type: 'object', additionalProperties: { type: 'string' } }, ...(endpoint.body ? { body: endpoint.method==='PUT'&&endpoint.path.endsWith('/document')?z.toJSONSchema(documentWriteSchema.extend({ document: z.object({}).loose().describe('Canonical DesignDocument. Discover the full document schema with studio_capabilities before writing.') })):endpoint.path.endsWith('/operations') ? {type:'object',properties:{kind:{type:'string',enum:['save','export']},operationId:{type:'string'},input:{type:'object',description:'Discover canonical operationJob in studio_capabilities.'}},required:['kind','operationId','input']} : endpoint.path.endsWith('/paint') ? z.toJSONSchema(paintingCommandSchema) : endpoint.path.endsWith('/export') ? z.toJSONSchema(exportOptionsSchema) : endpoint.path.endsWith('/media') ? z.toJSONSchema(mediaInputSchema) : endpoint.path.endsWith('/generate') ? z.toJSONSchema(generationInputSchema) : endpoint.path.endsWith('/brief/interview') ? z.toJSONSchema(providerInterviewSchema) : { type: 'object' } } : {}) }, ...(endpoint.body ? { required: ['body'] } : {}) },
      execute: async args => {
        const parameters = args.parameters as Record<string, string> | undefined;
        const path = endpoint.path.replace(/\{(\w+)\}/g, (_, key: string) => { if (!parameters?.[key]) throw new Error(`Missing path parameter: ${key}`); return encodeURIComponent(parameters[key]); });
        const query = new URLSearchParams(args.query as Record<string, string> ?? {});
        const upload = endpoint.method === 'POST' && endpoint.path.endsWith('/assets');
        const response = await fetch(path + (query.size ? `?${query}` : ''), { method: endpoint.method, credentials: 'same-origin', headers: { 'X-Studio-Client': 'webmcp', ...(!upload ? { 'Content-Type': 'application/json' } : {}) }, ...(endpoint.body ? { body: upload ? assetUploadBody(args.body as Record<string, unknown>) : JSON.stringify(args.body) } : {}) });
        if ((response.headers.get('Content-Type') ?? '').includes('json')) { const data = await response.json(); return { ...result(data), ...(!response.ok ? { isError: true } : {}) }; }
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')??'')?.[1]??'studio-export'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        return result({ downloaded: true, mimeType: blob.type, bytes: blob.size, filename:a.download });
      },
    });
  }
  for (const tool of tools) context.registerTool(tool);
  return () => tools.forEach(tool => context.unregisterTool?.(tool.name));
}
