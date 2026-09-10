import { z } from 'zod';
import { connectorIdSchema, connectorPrincipalSchema, connectorRevisionSchema, connectorTimestampSchema } from './connector-values';
import { connectorVersionPinsSchema } from './connector-operations';
import { textProviderSchema } from './providers';

// Provisional ceilings from the design. Runtime probes must validate these before execution is enabled.
export const agentRunLimits = Object.freeze({ modelTurns: 8, toolCalls: 12, toolTimeoutMs: 30000, activeMs: 300000, toolResponseBytes: 1024 * 1024, advertisedTools: 20 });
export const agentRunStatusSchema = z.enum(['ready_to_continue', 'running', 'awaiting_approval', 'needs_reauthorization', 'succeeded', 'failed', 'cancelled', 'outcome_unknown']);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export const agentRunStartSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(12000),
  provider: textProviderSchema, model: z.string().min(1).max(200).optional(),
  bindingIds: z.array(connectorIdSchema).min(1).max(20),
  sourceSnapshotIds: z.array(connectorIdSchema).max(100),
  expectedDocumentRevision: connectorRevisionSchema, expectedBriefRevision: connectorRevisionSchema,
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
});
export const agentRunAdvanceSchema = z.strictObject({ expectedRevision: connectorRevisionSchema });
export const agentRunSchema = z.strictObject({
  id: connectorIdSchema, projectId: connectorIdSchema, principal: connectorPrincipalSchema,
  revision: connectorRevisionSchema, status: agentRunStatusSchema,
  provider: textProviderSchema, model: z.string().min(1).max(200),
  pins: z.array(z.strictObject({ bindingId: connectorIdSchema, versions: connectorVersionPinsSchema })).min(1).max(20),
  modelTurns: z.number().int().min(0).max(agentRunLimits.modelTurns),
  toolCalls: z.number().int().min(0).max(agentRunLimits.toolCalls),
  activeMs: z.number().int().min(0).max(agentRunLimits.activeMs),
  pendingOperationId: connectorIdSchema.nullable(), proposalId: connectorIdSchema.nullable(),
  leaseId: connectorIdSchema.nullable(), leaseExpiresAt: connectorTimestampSchema.nullable(),
  createdAt: connectorTimestampSchema, updatedAt: connectorTimestampSchema,
}).superRefine((run, context) => {
  if ((run.status === 'running') !== Boolean(run.leaseId && run.leaseExpiresAt) || Boolean(run.leaseId) !== Boolean(run.leaseExpiresAt))
    context.addIssue({ code: 'custom', message: 'Only a running step has a complete execution lease.' });
  if (run.status === 'awaiting_approval' && !run.pendingOperationId)
    context.addIssue({ code: 'custom', message: 'An approval pause must reference its exact operation.' });
  if (run.status === 'succeeded' && !run.proposalId)
    context.addIssue({ code: 'custom', message: 'A successful design run must reference a validated proposal.' });
});
export type AgentRun = z.infer<typeof agentRunSchema>;
