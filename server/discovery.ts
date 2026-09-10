import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './types';
import { fail, hash, owner, rateLimit } from './security';
import { limitedBytes, providerConfig, upstream } from './providers';
import { discoveryProviderSchema, fallbackFonts, fallbackModels, fontOptionSchema, modelOptionSchema, type DiscoveryProvider, type FontCatalog, type ModelCatalog, type ModelOption } from '../src/shared/discovery';

import { builtInProviders, isCustomProvider } from '../src/shared/providers';
const bases: Record<string, string> = Object.fromEntries(builtInProviders.map(p => [p.id, p.baseUrl]));
export class DiscoveryCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private ttl: number, private capacity: number) {}
  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expires > now) return entry.value;
    this.entries.delete(key);
  }
  set(key: string, value: T, now = Date.now()) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: now + this.ttl });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
const modelsCache = new DiscoveryCache<ModelCatalog>(10 * 60_000, 64);
const fontsCache = new DiscoveryCache<FontCatalog>(24 * 60 * 60_000, 4);

function catalogQuery(value = '') {
  if (value.length > 200) fail(400, 'invalid_query', 'Catalog search must be at most 200 characters.');
  return value.trim();
}
export function filterModelCatalog(catalog: ModelCatalog, query: string): ModelCatalog {
  const search = catalogQuery(query).toLowerCase();
  return { ...catalog, models: catalog.models.filter(model => [model.id, model.name, model.category ?? ''].some(value => value.toLowerCase().includes(search))) };
}
export function filterFontCatalog(catalog: FontCatalog, query: string): FontCatalog {
  const search = catalogQuery(query).toLowerCase();
  return { ...catalog, fonts: catalog.fonts.filter(font => [font.family, font.category].some(value => value.toLowerCase().includes(search))) };
}

export function modelDiscoveryRequest(provider: DiscoveryProvider, key: string, cursor?: string) {
  if (isCustomProvider(provider)) fail(400, 'unsupported_provider', 'Enter custom model IDs manually.');
  const url = new URL(provider === 'leonardo' ? `${bases[provider]}/platformModels` : provider === 'grok' ? `${bases[provider]}/image-generation-models` : provider === 'fal' ? 'https://api.fal.ai/v1/models' : `${bases[provider]}/models`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; url.searchParams.set('limit', '1000'); }
  else if (provider === 'gemini') { headers['x-goog-api-key'] = key; url.searchParams.set('pageSize', '1000'); }
  else { headers.Authorization = `${provider === 'fal' ? 'Key' : 'Bearer'} ${key}`; }
  if (provider === 'fal') { url.searchParams.set('limit', '100'); url.searchParams.set('status', 'active'); }
  if (cursor) url.searchParams.set(provider === 'anthropic' ? 'after_id' : provider === 'gemini' ? 'pageToken' : 'cursor', cursor);
  return { url: url.href, init: { method: 'GET', headers, redirect: 'manual' as const } };
}
const record = z.record(z.string(), z.unknown());
export function parseModelPage(provider: DiscoveryProvider, input: unknown): { models: ModelOption[]; cursor?: string } {
  const body = record.parse(input);
  const rows = z.array(record).max(10000).parse(body[provider === 'leonardo' ? 'custom_models' : provider === 'gemini' || provider === 'fal' || provider === 'grok' ? 'models' : 'data']);
  const models: ModelOption[] = [];
  for (const item of rows) {
    if (provider === 'gemini' && (!Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent'))) continue;
    const metadata = provider === 'fal' ? record.safeParse(item.metadata) : null;
    const details = metadata?.success ? metadata.data : {};
    const rawId = provider === 'fal' ? item.endpoint_id : provider === 'gemini' ? item.name : item.id;
    const id = typeof rawId === 'string' ? rawId.replace(provider === 'gemini' ? /^models\// : /^$/, '') : rawId;
    const parsed = modelOptionSchema.safeParse({ id, name: item.display_name ?? item.displayName ?? item.name ?? details.display_name ?? id, ...(details.category === undefined ? {} : { category: details.category }) });
    if (parsed.success) models.push(parsed.data);
  }
  const rawCursor = provider === 'gemini' ? body.nextPageToken : body.has_more === true ? (provider === 'anthropic' ? body.last_id : body.next_cursor) : undefined;
  return { models, ...(typeof rawCursor === 'string' && rawCursor.length <= 2000 && rawCursor ? { cursor: rawCursor } : {}) };
}
export function parseGoogleFonts(input: unknown): FontCatalog['fonts'] {
  const body = record.parse(input);
  const rows = z.array(record).max(10000).parse(body.items);
  return rows.flatMap(row => { const parsed = fontOptionSchema.safeParse(row); return parsed.success ? [parsed.data] : []; }).slice(0, 5000);
}
async function readJson(url: string, init: RequestInit) {
  const response = await upstream(url, init, 10000);
  return JSON.parse(new TextDecoder().decode(await limitedBytes(response, 4 * 1024 * 1024))) as unknown;
}
export const discoveryRoutes = new Hono<Env>();
discoveryRoutes.get('/providers/:provider/models', async c => {
  const userId = owner(c);
  if (c.get('tokenKind') === 'oauth') fail(403, 'insufficient_scope', 'MCP authorization does not grant provider credential access.');
  c.header('Cache-Control', 'private, no-store');
  const query = catalogQuery(c.req.query('q'));
  const respond = (catalog: ModelCatalog) => c.json(filterModelCatalog(catalog, query));
  const parsed = discoveryProviderSchema.safeParse(c.req.param('provider'));
  if (!parsed.success) fail(400, 'unsupported_provider', 'Unknown provider.');
  const provider = parsed.data;
  const { env: bindings } = c;
  const saved = await bindings.DB.prepare('SELECT model FROM providers WHERE user_id=? AND provider=?').bind(userId, provider).first<{ model: string }>();
  if (!saved) return respond(fallbackModels(provider));
  const fallback = (message: string) => {
    const result = fallbackModels(provider, message);
    if (saved.model && !result.models.some(item => item.id === saved.model)) result.models.unshift({ id: saved.model, name: saved.model });
    return result;
  };
  try {
    const config = await providerConfig(c, provider);
    if (isCustomProvider(provider)) return respond(fallback('Custom endpoint: enter its model ID manually. No official catalog is queried.'));
    // A proxy credential must never be forwarded to an official provider origin.
    if (config.base_url.replace(/\/+$/, '') !== bases[provider]) return respond(fallback('Custom endpoint: enter a model ID. Starter suggestions are not verified.'));
    const cacheKey = await hash(`${userId}:${provider}:${config.encrypted_key}:${config.base_url}`);
    const cached = modelsCache.get(cacheKey);
    if (cached) return respond({ ...cached, source: cached.source === 'fallback' ? 'fallback' : 'cache' });
    await rateLimit(c, `model-discovery:${userId}:${provider}`, 30);
    const models = new Map<string, ModelOption>();
    const seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const request = modelDiscoveryRequest(provider, config.key, cursor);
      const result = parseModelPage(provider, await readJson(request.url, request.init));
      result.models.forEach(model => { if (models.size < 3000) models.set(model.id, model); });
      cursor = result.cursor;
      if (!cursor || seen.has(cursor) || models.size >= 3000) break;
      seen.add(cursor);
    }
    const result: ModelCatalog = { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), source: 'live', fetchedAt: new Date().toISOString(), truncated: !!cursor, message: cursor ? 'Provider catalog is partial. Enter any model ID manually.' : 'Provider catalog. Model access and task support depend on your account.' };
    modelsCache.set(cacheKey, result);
    return respond(result);
  } catch {
    return respond(fallback('Live discovery unavailable. Check the saved connection or retry later; starter suggestions are not verified.'));
  }
});
discoveryRoutes.get('/fonts', async c => {
  owner(c);
  const query = catalogQuery(c.req.query('q'));
  const respond = (catalog: FontCatalog) => c.json(filterFontCatalog(catalog, query));
  const { env: bindings } = c;
  const key = (bindings as typeof bindings & { GOOGLE_FONTS_API_KEY?: string }).GOOGLE_FONTS_API_KEY;
  if (!key) return respond(fallbackFonts());
  const cacheKey = await hash(key);
  const cached = fontsCache.get(cacheKey);
  if (cached) return respond({ ...cached, source: 'cache' });
  await rateLimit(c, 'font-discovery', 30);
  try {
    const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts');
    url.searchParams.set('key', key); url.searchParams.set('sort', 'alpha');
    url.searchParams.set('fields', 'items(family,category,variants)');
    const fonts = parseGoogleFonts(await readJson(url.href, { method: 'GET' }));
    if (!fonts.length) throw new Error('Empty font catalog');
    const result: FontCatalog = { fonts, source: 'live', message: 'Google Fonts catalog.', fetchedAt: new Date().toISOString() };
    fontsCache.set(cacheKey, result);
    return respond(result);
  } catch {
    return respond(fallbackFonts('Google Fonts catalog unavailable. Showing curated Google Fonts starter families.'));
  }
});
