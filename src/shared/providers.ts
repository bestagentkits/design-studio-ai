import { z } from 'zod';

export const builtInProviderSchema = z.enum(['openai', 'anthropic', 'gemini', 'openrouter', 'fal', 'deepseek', 'leonardo', 'grok']);
export const customProviderSchema = z.string().regex(/^custom-[a-z0-9][a-z0-9-]{0,55}$/, 'Use custom- followed by a lowercase slug.');
export const providerIdSchema = z.union([builtInProviderSchema, customProviderSchema]);
export const textProviderSchema = z.union([z.enum(['openai', 'anthropic', 'gemini', 'openrouter', 'deepseek']), customProviderSchema]);
export const mediaProviderSchema = z.union([z.enum(['openai', 'gemini', 'fal', 'leonardo', 'grok']), customProviderSchema]);
export const protocolSchema = z.enum(['openai', 'anthropic', 'gemini']);
export const authMethodSchema = z.enum(['bearer', 'api-key', 'basic', 'none']);
export type ProviderProtocol = z.infer<typeof protocolSchema>;
export type AuthMethod = z.infer<typeof authMethodSchema>;
export const isCustomProvider = (provider: string) => customProviderSchema.safeParse(provider).success;
export const isTextProvider = (provider: string) => textProviderSchema.safeParse(provider).success;

export const providerCatalog = {
  openai: { name: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', detail: 'Designs, images & speech', protocol: 'openai' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', detail: 'Design generation with Claude', protocol: 'anthropic' },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', detail: 'Designs & images', protocol: 'gemini' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1', detail: 'Your choice of language model', protocol: 'openai' },
  fal: { name: 'fal.ai', baseUrl: 'https://queue.fal.run', model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', detail: 'Images, video, music & effects', protocol: 'openai' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', detail: 'Design generation with the official DeepSeek API', protocol: 'openai' },
  leonardo: { name: 'LeonardoAI', baseUrl: 'https://cloud.leonardo.ai/api/rest/v1', model: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3', detail: 'Image generation with background jobs', protocol: 'openai' },
  grok: { name: 'Grok (xAI)', baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', detail: 'Image generation', protocol: 'openai' },
} satisfies Record<z.infer<typeof builtInProviderSchema>, { name: string; baseUrl: string; model: string; detail: string; protocol: ProviderProtocol }>;
export const builtInProviders = Object.entries(providerCatalog).map(([id, config]) => ({ id, ...config }));
export const providerDefaults = (provider: string) => builtInProviderSchema.safeParse(provider).success ? providerCatalog[provider as keyof typeof providerCatalog] : undefined;

// A credential header must not change routing, framing, cookies or content negotiation.
export const authHeaderSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/).refine(value =>
  !/^(host|cookie|set-cookie|content-.*|accept.*|connection|transfer-encoding|te|trailer|upgrade|origin|referer|proxy-.*|sec-.*|x-forwarded-.*|forwarded|anthropic-version)$/i.test(value), 'Choose a dedicated authentication header such as X-API-Key.');
export const providerSettingsSchema = z.object({
  apiKey: z.string().min(1).max(4096).regex(/^[^\r\n\x00-\x1f\x7f]+$/, 'Credential must not contain control characters.').optional(),
  baseUrl: z.string().url().max(2048).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  protocol: protocolSchema.optional(),
  authMethod: authMethodSchema.optional(),
  authHeader: authHeaderSchema.optional(),
}).strict();
export type ProviderMetadata = {
  provider: string; name: string; baseUrl: string; model: string; protocol: ProviderProtocol;
  authMethod: AuthMethod; authHeader?: string; configured: boolean; apiKey: string;
};
