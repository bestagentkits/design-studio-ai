import { z } from 'zod';
import {
  boundedConnectorJson, connectorEndpointSchema, connectorHashSchema, connectorIdSchema,
  connectorPrincipalSchema, connectorRevisionSchema, connectorTimestampSchema,
} from './connector-values';
export { connectorEndpointSchema, connectorPrincipalSchema } from './connector-values';

export const connectorAdapterSchema = z.enum(['mcp', 'github', 'google-drive']);
export const connectionStatusSchema = z.enum(['pending', 'connected', 'needs_reauthorization', 'disconnected']);
export const connectionConfigSchema = z.discriminatedUnion('adapter', [
  z.strictObject({ adapter: z.literal('mcp'), endpoint: connectorEndpointSchema, authMode: z.enum(['anonymous', 'bearer', 'oauth']) }),
  z.strictObject({ adapter: z.literal('github'), authMode: z.literal('oauth') }),
  z.strictObject({ adapter: z.literal('google-drive'), authMode: z.literal('oauth') }),
]);
export const connectionCreateSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120), config: connectionConfigSchema,
});
export const connectionMetadataSchema = connectionCreateSchema.extend({
  id: connectorIdSchema, revision: connectorRevisionSchema, status: connectionStatusSchema,
  remoteIdentity: z.string().min(1).max(512).nullable(),
  scopes: z.array(z.string().min(1).max(300)).max(100),
  capabilityFingerprint: connectorHashSchema.nullable(), updatedAt: connectorTimestampSchema,
}).superRefine((value, context) => {
  if (value.status === 'connected' && value.config.authMode !== 'anonymous' && !value.remoteIdentity)
    context.addIssue({ code: 'custom', message: 'Authenticated connections require a stable remote identity.' });
});

export const connectorSelectionSchema = z.discriminatedUnion('adapter', [
  z.strictObject({ adapter: z.literal('mcp'), tools: z.array(z.string().min(1).max(200)).max(100), resources: z.array(z.string().min(1).max(2048)).max(100) }),
  z.strictObject({ adapter: z.literal('github'), repositoryId: z.string().regex(/^\d+$/), commit: z.string().regex(/^[a-f0-9]{40}$/), paths: z.array(z.string().min(1).max(1024).refine(path => !path.startsWith('/') && !path.split('/').some(p => ['..', '.', ''].includes(p)) && !path.includes('\\'))).min(1).max(100) }),
  z.strictObject({ adapter: z.literal('google-drive'), fileIds: z.array(connectorIdSchema).max(100), destinationFolderId: connectorIdSchema.optional() }),
]);
export const projectConnectionBindingSchema = z.strictObject({
  id: connectorIdSchema, projectId: connectorIdSchema, connectionId: connectorIdSchema,
  role: z.enum(['source', 'tool', 'destination']), policyRevision: connectorRevisionSchema,
  selection: connectorSelectionSchema,
});
export const connectionAgentGrantSchema = z.strictObject({
  id: connectorIdSchema, projectId: connectorIdSchema, connectionId: connectorIdSchema,
  principal: connectorPrincipalSchema, policyRevision: connectorRevisionSchema,
  capabilities: z.array(z.enum(['discover', 'read_source', 'execute_read', 'prepare_write', 'run'])).min(1).max(5),
  selection: connectorSelectionSchema, expiresAt: connectorTimestampSchema, revokedAt: connectorTimestampSchema.nullable(),
});

export const connectorToolSchema = z.strictObject({
  connectionId: connectorIdSchema, remoteName: z.string().min(1).max(200),
  description: z.string().max(8000), fingerprint: connectorHashSchema,
  inputSchema: boundedConnectorJson(64 * 1024, true).refine(value => value !== null && !Array.isArray(value) && typeof value === 'object'),
  // Local policy is independent of untrusted remote readOnly/destructive annotations.
  effect: z.enum(['read', 'write', 'unknown']),
});
export const sourceSnapshotSchema = z.strictObject({
  id: connectorIdSchema, projectId: connectorIdSchema, bindingId: connectorIdSchema,
  adapter: connectorAdapterSchema, remoteIdentity: z.string().min(1).max(2048),
  remoteVersion: z.string().min(1).max(512), contentHash: connectorHashSchema,
  mimeType: z.string().min(1).max(120), bytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
  extractionVersion: z.string().min(1).max(100), fetchedAt: connectorTimestampSchema,
  status: z.enum(['available', 'disconnected']),
});
export const connectorErrorCodeSchema = z.enum([
  'missing_grant', 'needs_reauthorization', 'approval_required', 'revision_conflict',
  'schema_changed', 'unsupported_protocol', 'limit_exceeded', 'outcome_unknown',
  'unsafe_destination', 'connection_revoked', 'unsupported_content', 'connector_unconfigured',
]);
export const connectorRecoverySchema = z.strictObject({
  code: connectorErrorCodeSchema, message: z.string().max(1000), requestId: connectorIdSchema,
  operationId: connectorIdSchema.optional(), runId: connectorIdSchema.optional(),
  humanPath: z.string().max(2048).regex(/^\/(?!\/)[a-zA-Z0-9/_-]+$/).optional(),
});
export type ConnectionMetadata = z.infer<typeof connectionMetadataSchema>;
export type ProjectConnectionBinding = z.infer<typeof projectConnectionBindingSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export type ConnectorTool = z.infer<typeof connectorToolSchema>;
