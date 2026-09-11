import { z } from 'zod';
import { documentSchema } from './schema';
export const documentSaveSchema = z.object({
  document: documentSchema,
  expectedRevision: z.number().int().positive(),
  operationId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});
