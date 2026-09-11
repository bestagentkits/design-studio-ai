import {z} from 'zod';
import {documentSchema} from './schema';
export const documentWriteSchema=z.object({document:documentSchema,expectedRevision:z.number().int().positive(),operationId:z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),expectedBriefRevision:z.number().int().min(0).optional()});
