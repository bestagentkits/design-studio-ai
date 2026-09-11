import { z } from 'zod';

// Reusable generation-prompt gallery. Entries are validated data (id, kind, prompt body,
// target provider/model, aspect ratio, attribution) so the brief/media composer and every
// agent surface can offer one-click prefill without executing anything. Seed prompts are
// original to Design Studio AI; they do not bundle third-party prompt catalogs verbatim.

export const promptTemplateSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, digits, underscores or hyphens'),
  kind: z.enum(['image', 'motion']),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(400),
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.string().regex(/^\d+:\d+$/, 'Aspect ratio like 16:9'),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  attribution: z.string().max(400).optional(),
});
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

export const promptTemplates: PromptTemplate[] = [
  {
    id: 'editorial-city-food-map', kind: 'image', title: 'Illustrated city food map',
    description: 'A hand-drawn editorial travel poster mapping a city through its food.',
    prompt: 'A hand-drawn editorial travel poster of a city food map: streets rendered as loose ink lines, landmarks as small vignettes, food stalls and dishes illustrated with warm gouache texture, a restrained two-color palette with one warm accent, generous white margin, title set in a classic serif. Flat composition, no photography.',
    aspectRatio: '3:4', provider: 'openai', model: 'gpt-image-1', attribution: 'Original seed prompt for Design Studio AI.',
  },
  {
    id: 'cinematic-product-still', kind: 'image', title: 'Cinematic product still',
    description: 'A single-frame editorial product shot with hard side light.',
    prompt: 'A cinematic still-life of a single everyday object on a raw concrete plinth, one hard side light with soft falloff, deep shadow, muted desaturated background, film grain, editorial magazine composition with negative space for a headline. No text, no logos.',
    aspectRatio: '16:9', provider: 'gemini', model: 'gemini-3.1-flash-image', attribution: 'Original seed prompt for Design Studio AI.',
  },
  {
    id: 'neon-portrait-avatar', kind: 'image', title: 'Neon portrait avatar',
    description: 'A profile avatar with neon edge light and cyberpunk color.',
    prompt: 'A profile portrait avatar with strong neon edge lighting in magenta and cyan, dark background, shallow depth of field, clean centered head-and-shoulders composition, subtle film grain. Suitable as a square social avatar. No text.',
    aspectRatio: '1:1', provider: 'fal', model: 'fal-ai/flux/dev', attribution: 'Original seed prompt for Design Studio AI.',
  },
  {
    id: 'stone-infographic', kind: 'image', title: 'Hewn-stone infographic',
    description: 'A 3D-rendered data story carved from stone blocks.',
    prompt: 'A 3D infographic of carved stone steps and blocks arranged as a rising bar chart, warm directional light, shallow depth of field, soft shadow, neutral editorial background. Data labels are blank placeholders to be filled in. No other text.',
    aspectRatio: '4:3', provider: 'fal', model: 'fal-ai/flux/dev', attribution: 'Original seed prompt for Design Studio AI.',
  },
  {
    id: 'saas-product-promo', kind: 'motion', title: '30s SaaS product promo',
    description: 'A short UI-driven product reveal for a software announcement.',
    prompt: 'A 30-second SaaS product promo: three interface screens revealed in sequence with smooth scale and parallax, a short headline over each, one accent color, subtle kinetic type, closing on the product logo. Keep motion fast and deliberate; no voiceover.',
    aspectRatio: '16:9', provider: 'fal', model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', attribution: 'Original seed prompt for Design Studio AI.',
  },
  {
    id: 'bar-chart-race', kind: 'motion', title: 'Bar chart race',
    description: 'A NYT-style animated ranking bar chart.',
    prompt: 'An animated bar chart race in the style of an editorial data piece: horizontal bars reorder smoothly over time, a large numeral ticks in the corner, clean sans-serif labels, restrained two-color palette. 16:9, silent, ends on the final ranking.',
    aspectRatio: '16:9', provider: 'fal', model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', attribution: 'Original seed prompt for Design Studio AI.',
  },
];
