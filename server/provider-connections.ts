import { Hono, type Context } from 'hono';
import type { Env } from './types';
import { decrypt, encrypt, fail, owner } from './security';
import { isBlockedHostname } from './ssrf';
import { authHeaderSchema, authMethodSchema, isCustomProvider, protocolSchema, providerDefaults, providerIdSchema, providerSettingsSchema, type AuthMethod, type ProviderProtocol } from '../src/shared/providers';

interface ProviderRow {
  provider: string; encrypted_key: string; base_url: string; model: string;
  display_name: string | null; protocol: ProviderProtocol | null; auth_method: AuthMethod | null; auth_header: string | null;
}
function connectionMetadata(row: ProviderRow) {
  const defaults = providerDefaults(row.provider);
  return { provider: row.provider, name: row.display_name ?? defaults?.name ?? row.provider,
    baseUrl: row.base_url, model: row.model, protocol: row.protocol ?? defaults?.protocol ?? 'openai',
    authMethod: row.auth_method ?? (['anthropic', 'gemini'].includes(row.provider) ? 'api-key' : 'bearer'),
    authHeader: row.auth_header ?? (row.provider === 'anthropic' ? 'x-api-key' : row.provider === 'gemini' ? 'x-goog-api-key' : undefined),
    configured: true, apiKey: '••••••••' };
}
export function allowedProviderBase(provider: string, base: string, allowlist = '') {
  const defaults = providerDefaults(provider);
  if (!defaults && !isCustomProvider(provider)) fail(400, 'unsupported_provider', 'Unknown provider.');
  let url: URL;
  try { url = new URL(base); } catch { fail(400, 'invalid_provider_url', 'Enter a valid HTTPS base URL.'); }
  if (isBlockedHostname(url.hostname)) fail(400, 'invalid_provider_url', 'Provider URL must not point at a loopback, private, link-local, CGNAT or reserved address.');
  const allowed = [defaults ? new URL(defaults.baseUrl).origin : '', ...allowlist.split(',').map(value => value.trim()).filter(Boolean)];
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !allowed.includes(url.origin)) {
    fail(400, 'invalid_provider_url', 'Provider base URL must use an operator-allowlisted HTTPS origin. Ask the administrator to add its origin to PROVIDER_ALLOWED_ORIGINS.');
  }
  return url.href.replace(/\/+$/, '');
}
export async function providerConfig(c: Context<Env>, provider: string) {
  providerIdSchema.parse(provider);
  const row = await c.env.DB.prepare('SELECT * FROM providers WHERE user_id=? AND provider=?').bind(owner(c), provider).first<ProviderRow>();
  if (!row) fail(400, 'provider_unconfigured', 'Add your provider connection in Settings first.');
  allowedProviderBase(provider, row.base_url, c.env.PROVIDER_ALLOWED_ORIGINS);
  const metadata = connectionMetadata(row);
  protocolSchema.parse(metadata.protocol); authMethodSchema.parse(metadata.authMethod);
  if (metadata.authMethod === 'api-key') authHeaderSchema.parse(metadata.authHeader);
  return { ...row, ...metadata, key: metadata.authMethod === 'none' ? '' : await decrypt(c.env, row.encrypted_key) };
}
export function providerHeaders(config: { provider: string; key: string; authMethod: AuthMethod; authHeader?: string }): Record<string, string> {
  if (config.authMethod === 'none') return {};
  if (config.authMethod === 'api-key') return { [authHeaderSchema.parse(config.authHeader)]: config.key };
  if (config.authMethod === 'basic') {
    const bytes = new TextEncoder().encode(config.key);
    return { Authorization: `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}` };
  }
  return { Authorization: `${config.provider === 'fal' ? 'Key' : 'Bearer'} ${config.key}` };
}
export const providerRoutes = new Hono<Env>();
providerRoutes.get('/', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM providers WHERE user_id=?').bind(owner(c)).all<ProviderRow>();
  return c.json({ providers: rows.results.map(connectionMetadata) });
});
providerRoutes.put('/:provider', async c => {
  const provider = providerIdSchema.parse(c.req.param('provider'));
  const body = providerSettingsSchema.parse(await c.req.json());
  const existing = await c.env.DB.prepare('SELECT * FROM providers WHERE user_id=? AND provider=?').bind(owner(c), provider).first<ProviderRow>();
  const defaults = providerDefaults(provider), custom = isCustomProvider(provider);
  if (!custom && (body.protocol || body.authMethod || body.authHeader || body.name)) fail(400, 'unsupported_option', 'Authentication and API format are fixed for official providers. Create a custom provider to change them.');
  const base = body.baseUrl ?? existing?.base_url ?? defaults?.baseUrl;
  const model = body.model ?? existing?.model ?? defaults?.model;
  const name = body.name ?? existing?.display_name ?? defaults?.name;
  if (!base || !model || !name) fail(400, 'provider_details_required', 'Custom providers require a name, base URL and default model.');
  const baseUrl = allowedProviderBase(provider, base, c.env.PROVIDER_ALLOWED_ORIGINS);
  const protocol = body.protocol ?? existing?.protocol ?? defaults?.protocol ?? 'openai';
  const authMethod = body.authMethod ?? existing?.auth_method ?? (['anthropic', 'gemini'].includes(provider) ? 'api-key' : 'bearer');
  const authHeader = authMethod === 'api-key' ? authHeaderSchema.parse(body.authHeader ?? existing?.auth_header ?? (protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key')) : null;
  const previous = existing && connectionMetadata(existing);
  const credentialTargetChanged = existing && (baseUrl !== existing.base_url || authMethod !== previous!.authMethod || (authHeader ?? undefined) !== previous!.authHeader);
  // A saved credential is not silently sent to a new endpoint or under a different auth contract.
  if (authMethod !== 'none' && !body.apiKey && (!existing || credentialTargetChanged || previous?.authMethod === 'none')) fail(400, 'provider_key_required', 'Enter a credential for this connection. Re-enter it when changing the endpoint or authentication.');
  if (authMethod === 'basic' && body.apiKey && !/^[^:]+:.+$/.test(body.apiKey)) fail(400, 'invalid_credentials', 'Basic authentication requires username:password in the credential field.');
  const encryptedKey = authMethod === 'none' ? await encrypt(c.env, '') : body.apiKey ? await encrypt(c.env, body.apiKey) : existing!.encrypted_key;
  const statement = existing
    ? c.env.DB.prepare('UPDATE providers SET encrypted_key=?,base_url=?,model=?,display_name=?,protocol=?,auth_method=?,auth_header=? WHERE user_id=? AND provider=? AND encrypted_key=? AND base_url=? AND model=? AND display_name IS ? AND protocol IS ? AND auth_method IS ? AND auth_header IS ?')
      .bind(encryptedKey, baseUrl, model, name, protocol, authMethod, authHeader, owner(c), provider, existing.encrypted_key, existing.base_url, existing.model, existing.display_name, existing.protocol, existing.auth_method, existing.auth_header)
    : c.env.DB.prepare('INSERT INTO providers(user_id,provider,encrypted_key,base_url,model,display_name,protocol,auth_method,auth_header) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO NOTHING')
      .bind(owner(c), provider, encryptedKey, baseUrl, model, name, protocol, authMethod, authHeader);
  // Metadata-only edits must not restore a credential that another request just rotated.
  if (!(await statement.run()).meta.changes) fail(409, 'provider_conflict', 'This connection changed while saving. Reload Settings and review it before retrying.');
  return c.json(connectionMetadata({ provider, encrypted_key: encryptedKey, base_url: baseUrl, model, display_name: name, protocol, auth_method: authMethod, auth_header: authHeader }));
});
providerRoutes.delete('/:provider', async c => {
  const provider = providerIdSchema.parse(c.req.param('provider'));
  await c.env.DB.prepare('DELETE FROM providers WHERE user_id=? AND provider=?').bind(owner(c), provider).run();
  return c.json({ ok: true });
});
