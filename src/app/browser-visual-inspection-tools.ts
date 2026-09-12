import { z } from 'zod';
import { visualInspectionSchema, workspaceInspectionSchema, visualInspectionContent, type VisualInspectionResult } from '../shared/visual-inspection';

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean>; execute: (args: Record<string, unknown>) => Promise<unknown> }
interface Context { registerTool: (tool: Tool) => void; unregisterTool?: (name: string) => void }

export function visualInspectionTools(): Tool[] {
  return [false, true].map(project => ({
    name: project ? 'studio_api_post_projects_id_inspect' : 'studio_api_post_projects_inspect',
    description: project ? 'See saved page or project PNGs with revision/page mapping. Schema: /api/schema visualInspection.' : 'See private workspace covers with IDs/revisions. Schema: /api/schema workspaceInspection.',
    annotations: { readOnlyHint: true },
    // Keep browser registration bounded; execution uses the full discoverable validator.
    inputSchema: { type: 'object', properties: { ...(project ? { parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } : {}), body: { type: 'object' } }, required: project ? ['parameters', 'body'] : ['body'] },
    execute: async args => {
      const input = (project ? visualInspectionSchema : workspaceInspectionSchema).parse(args.body);
      const parameters = project ? z.object({ id: z.string().min(1) }).parse(args.parameters) : undefined;
      const path = parameters ? `/api/projects/${encodeURIComponent(parameters.id)}/inspect` : '/api/projects/inspect';
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Studio-Client': 'webmcp' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }] };
      return visualInspectionContent(data as VisualInspectionResult);
    },
  }));
}

export function registerVisualInspectionBrowserTools(context: Context) {
  const registered: string[] = [];
  const cleanup = () => registered.forEach(name => context.unregisterTool?.(name));
  try { for (const tool of visualInspectionTools()) { context.registerTool(tool); registered.push(tool.name); } }
  catch { cleanup(); return () => {}; }
  return cleanup;
}
