import { z } from 'zod';
import { documentSchema } from './schema';
export const mergeRequestSchema = z.object({ base: documentSchema, document: documentSchema, baseRevision: z.number().int().positive() });
