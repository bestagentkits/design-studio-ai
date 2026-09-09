import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { telemetryQuerySchema } from '../src/shared/observability';
export function registerObservabilityTools(server: McpServer, callApi: (method: string, path: string) => Promise<any>) {
  const query = (values: Record<string, unknown>) => new URLSearchParams(Object.entries(telemetryQuerySchema.parse(values)).map(([key, value]) => [key, String(value)])).toString();
  server.registerTool('get_observability_summary', { description: 'Inspect your measured usage, errors, latency, actors and coverage. scope=all requires a configured operator API key; OAuth remains owner-scoped.', inputSchema: telemetryQuerySchema.omit({ cursor: true, limit: true }).shape, annotations: { readOnlyHint: true } }, async args => callApi('GET', `/api/observability/summary?${query(args)}`));
  server.registerTool('list_activity_events', { description: 'List owner activity with cursor pagination. Events contain safe metadata, never prompts or credentials. All-account scope requires operator API key.', inputSchema: telemetryQuerySchema.shape, annotations: { readOnlyHint: true } }, async args => callApi('GET', `/api/observability/events?${query(args)}`));
  server.registerTool('get_activity_trace', { description: 'Follow a request ID through its recorded steps. Owner scoped by default; all scope requires operator API key.', inputSchema: { id: z.string().uuid(), scope: z.enum(['owner', 'all']).default('owner'), days: z.number().int().min(1).max(30).default(7) }, annotations: { readOnlyHint: true } }, async ({ id, scope, days }) => callApi('GET', `/api/observability/trace/${encodeURIComponent(id)}?scope=${scope}&days=${days}`));
}
