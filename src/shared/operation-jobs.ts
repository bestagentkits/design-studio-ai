import {z} from 'zod';
import {documentWriteSchema} from './document-write';
import {exportOptionsSchema} from './export-contract';
export const operationIdSchema=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const operationJobSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('save'),operationId:operationIdSchema,input:documentWriteSchema.omit({operationId:true})}),
 z.object({kind:z.literal('export'),operationId:operationIdSchema,input:exportOptionsSchema.extend({expectedRevision:z.number().int().positive()})}),
]);
export type OperationJobRequest=z.infer<typeof operationJobSchema>;
export type OperationJob={id:string;kind:'save'|'export';status:'queued'|'running'|'succeeded'|'failed';stage:string;revision:number|null;error:{code:string;message:string}|null;resultUrl:string|null;createdAt:number;updatedAt:number};
