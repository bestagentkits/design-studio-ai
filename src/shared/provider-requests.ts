import { z } from 'zod';
import { mediaProviderSchema, textProviderSchema } from './providers';

export const mediaInputSchema = z.object({
  kind: z.enum(["image", "audio", "video"]),
  prompt: z.string().trim().min(1).max(4000),
  provider: mediaProviderSchema,
  model: z.string().min(1).max(200).optional(),
  voice: z.enum(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]).optional(),
  sourceAssetId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(120).optional(),
  durationSeconds: z.number().int().min(1).max(190).optional(),
  strength: z.number().min(0).max(1).optional(),
});

export const generationInputSchema = z.object({ prompt: z.string().trim().min(1).max(12000), provider: textProviderSchema, model: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().positive() });
export const providerInterviewSchema = z.object({ provider: textProviderSchema, model: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().min(0) }).strict();
