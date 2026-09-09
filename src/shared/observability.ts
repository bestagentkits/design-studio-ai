import { z } from 'zod';

export const telemetryChannels = ['browser', 'api', 'oauth', 'mcp', 'cli', 'webmcp', 'anonymous'] as const;
export const telemetryKinds = ['http', 'provider', 'mcp', 'client', 'export'] as const;
export const telemetryStatuses = ['running', 'success', 'error', 'interrupted'] as const;
export const telemetryQuerySchema = z.object({
  scope: z.enum(['owner', 'all']).default('owner'), days: z.coerce.number().int().min(1).max(30).default(7),
  projectId: z.string().min(1).max(120).optional(), actorId: z.string().min(1).max(120).optional(),
  channel: z.enum(telemetryChannels).optional(), kind: z.enum(telemetryKinds).optional(),
  status: z.enum(telemetryStatuses).optional(), action: z.string().regex(/^[a-zA-Z0-9_./:* -]+$/).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(160).optional(),
});
export type TelemetryQuery = z.infer<typeof telemetryQuerySchema>;
export interface TelemetryEvent {
  id: string; traceId: string; parentId: string | null; actorId: string | null;
  channel: typeof telemetryChannels[number]; kind: typeof telemetryKinds[number]; action: string; projectId: string | null;
  startedAt: string; finishedAt: string | null; durationMs: number | null; status: typeof telemetryStatuses[number];
  httpStatus: number | null; errorCode: string | null; provider: string | null; model: string | null;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  costUsd: number | null; outputBytes: number | null; usageSource: 'provider' | 'unavailable';
}
export interface TelemetryCoverage {
  retentionDays: number; instrumentedSince: string | null; storage: 'available' | 'degraded'; droppedEvents: number;
  posthog: { configured: boolean; deliveryFailures: number; lastDeliveryAt: string | null };
  limitations: string[];
}
export interface TelemetrySummary {
  scope: 'owner' | 'all'; days: number;
  totals: { requests: number; errors: number; running: number; interrupted: number; successRate: number | null; avgDurationMs: number | null };
  usage: { providerCalls: number; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; costUsd: number | null; measuredTokenCalls: number; measuredCostCalls: number };
  byAction: { action: string; count: number; errors: number; avgDurationMs: number | null }[];
  byActor: { actorId: string | null; count: number; errors: number; lastSeen: string }[];
  byProvider: { provider: string; model: string | null; count: number; errors: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null }[];
  coverage: TelemetryCoverage;
}
export interface TelemetryEvents { events: TelemetryEvent[]; nextCursor: string | null }
export interface TelemetryTrace { traceId: string; events: TelemetryEvent[]; truncated: boolean }
export const clientEventNames = ['page_view', 'project_open', 'project_create', 'project_save', 'template_open', 'design_system_open', 'design_system_apply', 'export_start', 'export_finish', 'generation_start', 'generation_finish', 'editor_action', 'client_error'] as const;
export const clientEventSchema = z.object({
  event: z.enum(clientEventNames),
  page: z.enum(['home', 'projects', 'templates', 'design-systems', 'editor', 'observability', 'settings', 'docs', 'guide']).optional(),
  action: z.enum(['select', 'multiselect', 'move', 'resize', 'rotate', 'text_edit', 'font_change', 'duplicate', 'delete', 'group', 'ungroup', 'undo', 'redo', 'save', 'export', 'generate', 'navigate']).optional(),
  projectId: z.string().min(1).max(120).optional(), requestId: z.string().uuid().optional(),
  outcome: z.enum(['success', 'error']).optional(), errorCode: z.enum(['request_failed', 'network_error', 'unexpected_error', 'validation_error', 'revision_conflict']).optional(),
}).strict();
export type ClientTelemetryEvent = z.infer<typeof clientEventSchema>;
