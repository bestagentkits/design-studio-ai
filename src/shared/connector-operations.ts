import { z } from 'zod';
import { boundedConnectorJson, connectorHashSchema, connectorIdSchema, connectorPrincipalSchema, connectorRevisionSchema, connectorTimestampSchema } from './connector-values';

export const connectorOperationStatusSchema = z.enum(['pending', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown']);
export type ConnectorOperationStatus = z.infer<typeof connectorOperationStatusSchema>;
const transitions: Record<ConnectorOperationStatus, readonly ConnectorOperationStatus[]> = {
  pending: ['awaiting_approval', 'running', 'cancelled', 'failed'],
  awaiting_approval: ['pending', 'cancelled', 'failed'],
  running: ['succeeded', 'failed', 'outcome_unknown'],
  // Unknown outcomes can only be settled by adapter reconciliation, never dispatched again.
  outcome_unknown: ['succeeded', 'failed'], succeeded: [], failed: [], cancelled: [],
};
export const canTransitionConnectorOperation = (from: ConnectorOperationStatus, to: ConnectorOperationStatus) => transitions[from].includes(to);

export const connectorVersionPinsSchema = z.strictObject({
  connectionRevision: connectorRevisionSchema, credentialVersion: connectorRevisionSchema,
  policyRevision: connectorRevisionSchema, documentRevision: connectorRevisionSchema,
  briefRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sourceSnapshotIds: z.array(connectorIdSchema).max(100),
});
export const connectorOperationPrepareSchema = z.strictObject({
  bindingId: connectorIdSchema, action: z.string().min(1).max(200),
  arguments: boundedConnectorJson(64 * 1024),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  expectedVersions: connectorVersionPinsSchema,
});
export const connectorApprovalSchema = z.strictObject({
  id: connectorIdSchema, operationId: connectorIdSchema, userId: connectorIdSchema,
  argumentsHash: connectorHashSchema, actionFingerprint: connectorHashSchema,
  destinationHash: connectorHashSchema, versions: connectorVersionPinsSchema,
  expiresAt: connectorTimestampSchema, consumedAt: connectorTimestampSchema.nullable(),
});
export const connectorOperationSchema = z.strictObject({
  id: connectorIdSchema, projectId: connectorIdSchema, connectionId: connectorIdSchema,
  principal: connectorPrincipalSchema, revision: connectorRevisionSchema,
  status: connectorOperationStatusSchema, action: z.string().min(1).max(200),
  errorCode: z.string().max(100).nullable().default(null),
  effect: z.enum(['read', 'write', 'unknown']), argumentsHash: connectorHashSchema,
  actionFingerprint: connectorHashSchema, destinationHash: connectorHashSchema,
  versions: connectorVersionPinsSchema, approvalId: connectorIdSchema.nullable(),
  leaseId: connectorIdSchema.nullable(), leaseExpiresAt: connectorTimestampSchema.nullable(),
  remoteIds: z.array(z.string().min(1).max(1024)).max(100),
  createdAt: connectorTimestampSchema, updatedAt: connectorTimestampSchema,
}).superRefine((operation, context) => {
  if ((operation.status === 'running') !== Boolean(operation.leaseId && operation.leaseExpiresAt))
    context.addIssue({ code: 'custom', message: 'Only a running operation has a complete execution lease.' });
  if (Boolean(operation.leaseId) !== Boolean(operation.leaseExpiresAt))
    context.addIssue({ code: 'custom', message: 'Lease identity and expiry must be set together.' });
  if (operation.status === 'running' && operation.effect !== 'read' && !operation.approvalId)
    context.addIssue({ code: 'custom', message: 'Write and unknown effects require exact approval before dispatch.' });
});
export type ConnectorOperation = z.infer<typeof connectorOperationSchema>;

export const connectorOperationExecuteSchema = z.strictObject({expectedRevision:connectorRevisionSchema});
export const connectorOperationDecisionSchema = connectorOperationExecuteSchema.extend({decision:z.enum(['approve','deny'])});
