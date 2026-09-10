import {z} from 'zod';
import {documentSchema} from './schema';
export const documentWriteSchema=z.object({document:documentSchema,expectedRevision:z.number().int().positive(),expectedBriefRevision:z.number().int().min(0).optional()});
