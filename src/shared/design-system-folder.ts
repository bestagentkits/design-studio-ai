import { z } from 'zod';
import { designSystemSchema, type DesignSystemDefinition } from './design-systems';

// Portable design-system package authoring: a folder carrying DESIGN.md (agent-facing
// prose), tokens.css (compiled custom properties) and manifest.json (catalog metadata).
// It compiles into the same immutable versioned DesignSystemDefinition the REST/MCP/CLI
// surfaces already consume, so the folder is an ingest surface rather than a second truth.

const slug = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, digits, underscores or hyphens');

export const folderManifestSchema = z.object({
  schemaVersion: z.literal('od-design-system-project/v1').default('od-design-system-project/v1'),
  id: slug,
  name: z.string().trim().min(1).max(120),
  category: z.string().max(120).optional(),
  description: z.string().max(2000).default(''),
  system: z.enum(['antd', 'shadcn']).default('shadcn'),
  source: z.object({ type: z.enum(['bundled', 'local', 'github', 'shadcn']), origin: z.string().max(2000).optional() }).optional(),
});

export const folderImportSchema = z.object({
  manifest: folderManifestSchema,
  designMd: z.string().max(200000),
  tokensCss: z.string().max(200000),
});

export type FolderManifest = z.infer<typeof folderManifestSchema>;
export type FolderManifestInput = z.input<typeof folderManifestSchema>;
export interface FolderPackage { manifest: FolderManifestInput; designMd: string; tokensCss: string; }
export interface FolderFinding { level: 'error' | 'warning'; message: string; }

export function parseTokensCss(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    const value = match[2].split('!')[0].trim().replace(/^['"]|['"]$/g, '');
    if (value) tokens[`--${match[1]}`] = value;
  }
  return tokens;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  const px = /^([\d.]+)px$/.exec(v); if (px) return Number(px[1]);
  const rem = /^([\d.]+)rem$/.exec(v); if (rem) return Number(rem[1]) * 16;
  const bare = /^([\d.]+)$/.exec(v); if (bare) return Number(bare[1]);
  return null;
}

function fontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return first || undefined;
}

const COLOR_SLOTS: ReadonlyArray<{ keys: string[]; color: string }> = [
  { keys: ['--bg', '--background'], color: 'background' },
  { keys: ['--surface'], color: 'surface' },
  { keys: ['--fg', '--text', '--foreground'], color: 'text' },
  { keys: ['--muted'], color: 'muted' },
  { keys: ['--accent'], color: 'accent' },
  { keys: ['--primary'], color: 'primary' },
  { keys: ['--secondary'], color: 'secondary' },
  { keys: ['--border'], color: 'border' },
];

const REQUIRED_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '--bg', label: 'background' },
  { token: '--fg', label: 'text/foreground' },
  { token: '--accent', label: 'accent' },
  { token: '--font-display', label: 'heading font' },
  { token: '--font-body', label: 'body font' },
];

const PROSE_CONCEPTS: ReadonlyArray<{ word: RegExp; label: string; resolve: (theme: DesignSystemDefinition['theme']) => unknown }> = [
  { word: /\baccent\b/i, label: 'accent', resolve: t => t.colors.accent },
  { word: /\bprimary\b/i, label: 'primary', resolve: t => t.colors.primary },
  { word: /\bsurface\b/i, label: 'surface', resolve: t => t.colors.surface },
  { word: /\bborder\b/i, label: 'border', resolve: t => t.colors.border },
  { word: /\bmuted\b/i, label: 'muted', resolve: t => t.colors.muted },
  { word: /\bheading\b/i, label: 'heading font', resolve: t => t.fonts.heading },
  { word: /\bradius\b/i, label: 'radius', resolve: t => t.radius },
  { word: /\bspacing\b/i, label: 'spacing', resolve: t => (t.spacing.length ? t.spacing : undefined) },
];

export interface FolderCompileResult { definition: DesignSystemDefinition; findings: FolderFinding[]; warnings: string[] }

export function compileFolderPackage(pkg: FolderPackage): FolderCompileResult {
  const manifest = folderManifestSchema.parse(pkg.manifest);
  const tokens = parseTokensCss(pkg.tokensCss);
  const findings: FolderFinding[] = [];
  const warnings: string[] = [];

  for (const { token, label } of REQUIRED_TOKENS) {
    if (!tokens[token]) findings.push({ level: 'error', message: `tokens.css is missing ${token} (${label}).` });
  }

  const colors: Record<string, string> = {};
  for (const slot of COLOR_SLOTS) {
    const value = slot.keys.map(k => tokens[k]).find(v => v !== undefined);
    if (value) colors[slot.color] = value;
  }
  if (!colors.primary && colors.accent) { colors.primary = colors.accent; warnings.push('primary fell back to accent.'); }
  if (colors.primary && !colors.accent) colors.accent = colors.primary;

  const heading = fontFamily(tokens['--font-display']) ?? fontFamily(tokens['--font-heading']) ?? fontFamily(tokens['--font-family']) ?? 'Inter';
  const body = fontFamily(tokens['--font-body']) ?? fontFamily(tokens['--font-sans']) ?? fontFamily(tokens['--font-family']) ?? 'Inter';
  if (!tokens['--font-display'] && !tokens['--font-heading']) warnings.push('heading font defaulted to Inter.');
  if (!tokens['--font-body'] && !tokens['--font-sans']) warnings.push('body font defaulted to Inter.');

  const spacingEntries: Array<[number, number]> = [];
  for (const [name, value] of Object.entries(tokens)) {
    const match = /^--(?:space|spacing)-(\d+)$/.exec(name);
    if (!match) continue;
    const number = toNumber(value);
    if (number !== null) spacingEntries.push([Number(match[1]), number]);
  }
  spacingEntries.sort((a, b) => a[0] - b[0]);
  const spacing = spacingEntries.slice(0, 32).map(([, value]) => value);

  const radius = toNumber(tokens['--radius']);
  const theme: DesignSystemDefinition['theme'] = {
    id: manifest.id,
    name: manifest.name,
    colors,
    fonts: { heading, body },
    spacing: spacing.length ? spacing : [4, 8, 16, 24, 32, 48],
    radius: radius ?? 8,
  };
  if (radius === null) warnings.push('radius defaulted to 8.');

  for (const { word, label, resolve } of PROSE_CONCEPTS) {
    if (word.test(pkg.designMd) && resolve(theme) === undefined) findings.push({ level: 'error', message: `DESIGN.md mentions ${label}, but the compiled theme has no matching value.` });
  }

  const definition = designSystemSchema.parse({
    name: manifest.name,
    description: manifest.description,
    system: manifest.system,
    theme,
    components: [],
    compositions: [],
  });

  return { definition, findings, warnings };
}

const COLOR_TOKENS: ReadonlyArray<{ color: string; token: string }> = [
  { color: 'background', token: '--bg' },
  { color: 'surface', token: '--surface' },
  { color: 'text', token: '--fg' },
  { color: 'muted', token: '--muted' },
  { color: 'accent', token: '--accent' },
  { color: 'primary', token: '--primary' },
  { color: 'secondary', token: '--secondary' },
  { color: 'border', token: '--border' },
];

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'design-system';
}

export function decompileFolderPackage(definition: DesignSystemDefinition, id: string): FolderPackage {
  const theme = definition.theme;
  const custom: string[] = [];
  for (const { color, token } of COLOR_TOKENS) if (theme.colors[color]) custom.push(`  ${token}: ${theme.colors[color]};`);
  custom.push(`  --font-display: "${theme.fonts.heading}";`);
  custom.push(`  --font-body: "${theme.fonts.body}";`);
  theme.spacing.forEach((value, index) => custom.push(`  --space-${index + 1}: ${value}px;`));
  custom.push(`  --radius: ${theme.radius}px;`);

  const tokensCss = `:root {\n${custom.join('\n')}\n}\n`;
  const manifest = folderManifestSchema.parse({ id: slugify(id || definition.name), name: definition.name, description: definition.description, system: definition.system, source: { type: 'local' } });
  const designMd = `# ${definition.name}\n\n## Visual theme\n${definition.description || 'A generated design-system package.'}\n\n## Color roles\n- Accent: \`${theme.colors.accent ?? theme.colors.primary ?? 'n/a'}\`\n- Text: \`${theme.colors.text ?? 'n/a'}\` on \`${theme.colors.background ?? 'n/a'}\`\n\n## Typography\n- Heading: ${theme.fonts.heading}\n- Body: ${theme.fonts.body}\n\n## Spacing and radius\n- Spacing scale: ${theme.spacing.join(', ')}px\n- Radius: ${theme.radius}px\n\n## Anti-patterns\n- Do not invent colors absent from \`tokens.css\`.\n`;
  return { manifest, designMd, tokensCss };
}
