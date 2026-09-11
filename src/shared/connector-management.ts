import { z } from 'zod';
import { connectorIdSchema, connectorRevisionSchema, connectorTimestampSchema } from './connector-values';
import { connectorSelectionSchema } from './connectors';
export const connectionBindingCreateSchema = z.strictObject({
  connectionId: connectorIdSchema, role: z.enum(['source','tool','destination']), selection: connectorSelectionSchema,
});
export const connectionGrantCreateSchema = z.strictObject({
  recipient: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('api'), tokenId: connectorIdSchema }),
    z.strictObject({ kind: z.literal('oauth'), clientId: connectorIdSchema, familyId: connectorIdSchema }),
    z.strictObject({ kind: z.literal('webmcp') }),
  ]),
  expectedPolicyRevision: connectorRevisionSchema,
  capabilities: z.array(z.enum(['discover','read_source','execute_read','prepare_write','run'])).min(1).max(5),
  selection: connectorSelectionSchema, expiresAt: connectorTimestampSchema,
});

export const mcpAuthorizationOptionsSchema = z.strictObject({ profile:z.enum(['modern','legacy']).default('modern'), scope:z.string().max(4096).optional(),
  client:z.strictObject({clientId:z.string().min(1).max(2048),clientSecret:z.string().min(1).max(16384).optional(),authMethod:z.enum(['none','client_secret_basic','client_secret_post']).default('none')}).optional(),
  clientMetadataUrl:z.string().max(2048).optional() });

export const mcpConnectionSetupSchema = z.strictObject({ connectionId: connectorIdSchema, expectedRevision: connectorRevisionSchema, accessToken: z.string().min(1).max(16384).optional() });
export const mcpAuthorizationStartSchema = z.strictObject({ connectionId: connectorIdSchema, expectedRevision: connectorRevisionSchema, options: mcpAuthorizationOptionsSchema });

export const connectionBindingRemoveSchema = z.strictObject({ expectedPolicyRevision: connectorRevisionSchema });
