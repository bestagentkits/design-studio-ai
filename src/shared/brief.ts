import { z } from 'zod';

export const questionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(600).default(''),
  type: z.enum(['text', 'single', 'multiple']),
  options: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  required: z.boolean().default(true),
}).superRefine((question, context) => {
  if (question.type !== 'text' && question.options.length < 2)
    context.addIssue({code:'custom', message:'Choice questions need at least two options.'});
  if (new Set(question.options).size !== question.options.length)
    context.addIssue({code:'custom', message:'Question options must be unique.'});
});
export const scopeSchema = z.object({
  objective: z.string().trim().min(1).max(2000),
  audience: z.string().trim().min(1).max(1000),
  direction: z.string().trim().min(1).max(2000),
  deliverables: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  constraints: z.array(z.string().trim().min(1).max(500)).max(12),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
});
export const interviewSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  questions: z.array(questionSchema).max(8),
  scope: scopeSchema.nullable(),
}).superRefine((interview, context) => {
  if (new Set(interview.questions.map(q => q.id)).size !== interview.questions.length)
    context.addIssue({code:'custom',message:'Question IDs must be unique.'});
  if (!interview.questions.length && !interview.scope)
    context.addIssue({code:'custom',message:'An interview must ask questions or propose a scope.'});
});
export const answerSchema = z.record(z.string().max(64), z.union([z.string().max(4000), z.array(z.string().max(160)).max(8)]));
export type Interview = z.infer<typeof interviewSchema>;
export type DesignScope = z.infer<typeof scopeSchema>;
export type DesignBrief = {
  projectId: string;
  revision: number;
  request: string;
  status: 'interview' | 'ready' | 'approved';
  message: string;
  questions: Interview['questions'];
  answers: z.infer<typeof answerSchema>;
  scope: DesignScope | null;
  approvedAt: string | null;
  updatedAt: string;
};
