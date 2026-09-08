import { z } from 'zod';

export const discoveryProviderSchema = z.enum(['openai', 'anthropic', 'gemini', 'openrouter', 'fal']);
export type DiscoveryProvider = z.infer<typeof discoveryProviderSchema>;
export const modelOptionSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(200), category: z.string().max(100).optional() });
export type ModelOption = z.infer<typeof modelOptionSchema>;
const provenance = { source: z.enum(['live', 'cache', 'fallback']), message: z.string(), fetchedAt: z.string().optional(), truncated: z.boolean().optional() };
export const modelCatalogSchema = z.object({ ...provenance, models: z.array(modelOptionSchema).max(3000) });
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export const fontOptionSchema = z.object({ family: z.string().min(1).max(200), category: z.string().max(100), variants: z.array(z.string().max(30)).max(100).optional() });
export type FontOption = z.infer<typeof fontOptionSchema>;
export const fontCatalogSchema = z.object({ ...provenance, fonts: z.array(fontOptionSchema).max(5000) });
export type FontCatalog = z.infer<typeof fontCatalogSchema>;

const starterModels: Record<DiscoveryProvider, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-mini'], anthropic: ['claude-sonnet-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'], openrouter: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4'],
  fal: ['fal-ai/flux/schnell', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'],
};
export function fallbackModels(provider: string, message = 'Starter suggestions; availability is not verified. Save a provider key to discover models.'): ModelCatalog {
  const parsed = discoveryProviderSchema.safeParse(provider);
  return { source: 'fallback', message, models: (parsed.success ? starterModels[parsed.data] : []).map(id => ({ id, name: id })) };
}
export const curatedFonts: FontOption[] = [
  ...['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Source Sans 3', 'Work Sans', 'DM Sans', 'Noto Sans', 'Be Vietnam Pro'].map(family => ({ family, category: 'sans-serif' })),
  ...['Lora', 'Merriweather', 'Playfair Display', 'Libre Baskerville', 'Source Serif 4', 'Noto Serif'].map(family => ({ family, category: 'serif' })),
  ...['Roboto Mono', 'JetBrains Mono', 'IBM Plex Mono'].map(family => ({ family, category: 'monospace' })),
  { family: 'Bebas Neue', category: 'display' }, { family: 'Dancing Script', category: 'handwriting' },
];
export function fallbackFonts(message = 'Curated Google Fonts starter catalog. Full catalog requires a server Google Fonts API key.'): FontCatalog {
  return { source: 'fallback', message, fonts: curatedFonts };
}
