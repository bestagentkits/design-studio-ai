import { useState } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { builtInProviders, isCustomProvider, providerDefaults, type AuthMethod, type ProviderProtocol } from '../shared/providers';
import { api, put, message, type Provider } from './api';
import { Busy, Field } from './ui';
import { ModelPicker } from './model-picker';
import { navigateButtonGroup } from './keyboard-navigation';

export function ProviderSettings({ providers, onChanged }: { providers: Provider[]; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState('openai');
  const [key, setKey] = useState(''), [model, setModel] = useState(''), [baseUrl, setBaseUrl] = useState('');
  const [name, setName] = useState(''), [slug, setSlug] = useState('');
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai'), [authMethod, setAuthMethod] = useState<AuthMethod>('bearer'), [authHeader, setAuthHeader] = useState('X-API-Key');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [refresh, setRefresh] = useState(0);
  const creating = selected === 'new-custom', custom = creating || isCustomProvider(selected);
  const saved = providers.find(p => p.provider === selected);
  const current = providerDefaults(selected);
  const options = [...builtInProviders, ...providers.filter(p => isCustomProvider(p.provider)).map(p => ({ id: p.provider, name: p.name || p.provider, detail: 'Custom API connection' }))];
  function select(id: string) {
    const connection = providers.find(p => p.provider === id);
    setSelected(id); setKey(''); setModel(connection?.model ?? ''); setBaseUrl(connection?.baseUrl ?? '');
    setName(connection?.name ?? ''); setSlug(''); setProtocol(connection?.protocol ?? 'openai');
    setAuthMethod(connection?.authMethod ?? 'bearer'); setAuthHeader(connection?.authHeader ?? 'X-API-Key');
    setError(''); setSuccess('');
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function save() {
    const id = creating ? `custom-${slug}` : selected;
    if (creating && providers.some(p => p.provider === id)) throw new Error('This provider ID already exists. Select its connection to edit it, or choose another ID.');
    await put(`/api/providers/${encodeURIComponent(id)}`, {
      ...(key && (!custom || authMethod !== 'none') ? { apiKey: key } : {}), ...(model.trim() ? { model: model.trim() } : {}),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(custom ? { name: name.trim(), protocol, authMethod, ...(authMethod === 'api-key' ? { authHeader } : {}) } : {}),
    });
    setKey(''); await onChanged(); setSelected(id); setRefresh(value => value + 1); setSuccess(`${custom ? name : current?.name} connected.`);
  }
  return <>
    <h3>Your keys. Your choice.</h3>
    <p className="modal-description">Connect a provider to generate designs and media. Credentials are encrypted on the server and never included in designs. OpenAI uses an API key; a ChatGPT subscription does not supply API access.</p>
    <div className="provider-list" onKeyDown={event => navigateButtonGroup(event, ':scope > button', 'vertical')}>
      {options.map(item => <button key={item.id} disabled={busy} className={selected === item.id ? 'selected' : ''} aria-pressed={selected === item.id} onClick={() => select(item.id)}>
        <span className="provider-letter">{item.name[0]}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span>
        {providers.some(p => p.provider === item.id && p.configured) ? <span className="configured"><Check size={14} /> Connected</span> : <ChevronRight size={16} />}
      </button>)}
      <button disabled={busy} aria-pressed={creating} onClick={() => select('new-custom')}><Plus size={18} /><span><strong>Add custom provider</strong><small>Choose your endpoint and authentication</small></span></button>
    </div>
    <form className="provider-form" onSubmit={event => { event.preventDefault(); void perform(save); }}>
      <h4>{creating ? 'Create custom provider' : `Connect ${saved?.name ?? current?.name ?? selected}`}</h4>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {custom && <>
          <Field label="Provider name"><input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></Field>
          {creating && <Field label="Provider ID" hint="Lowercase letters, numbers and hyphens. Saved with the custom- prefix."><input value={slug} onChange={event => setSlug(event.target.value)} pattern="[a-z0-9][a-z0-9-]{0,55}" placeholder="my-provider" required /></Field>}
          <Field label="API format" hint="The endpoint must implement this request and response format."><select value={protocol} onChange={event => setProtocol(event.target.value as ProviderProtocol)}>
            <option value="openai">OpenAI compatible — text and images</option><option value="anthropic">Anthropic compatible — text</option><option value="gemini">Gemini compatible — text and images</option>
          </select></Field>
        </>}
        <Field label="Base URL" hint={custom ? 'HTTPS API root, including version path (e.g. /v1). Its origin must be in the server PROVIDER_ALLOWED_ORIGINS allowlist.' : 'Optional. Alternative origins require server allowlisting.'}>
          <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={current?.baseUrl ?? 'https://api.example.com/v1'} required={custom} />
        </Field>
        {custom && <Field label="Authentication method"><select value={authMethod} onChange={event => { setAuthMethod(event.target.value as AuthMethod); setKey(''); }}>
          <option value="bearer">Bearer token</option><option value="api-key">API key in header</option><option value="basic">HTTP Basic</option><option value="none">No authentication</option>
        </select></Field>}
        {custom && authMethod === 'api-key' && <Field label="Authentication header"><input value={authHeader} onChange={event => setAuthHeader(event.target.value)} placeholder="X-API-Key" required /></Field>}
        {(!custom || authMethod !== 'none') && <Field label={custom && authMethod === 'basic' ? 'Credential (username:password)' : 'API key'} hint={saved ? 'Leave blank to retain it. Re-enter when changing endpoint or authentication.' : undefined}>
          <input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Paste your provider credential" required={!saved} />
        </Field>}
        <Field label="Default model" hint={custom ? 'Required. For images, use an image model here or override it in the editor.' : ['openai', 'gemini'].includes(selected) ? 'Default text model. Images use their operation default or the media model override.' : 'Optional. Leave blank to use the server default.'}>
          <ModelPicker provider={creating ? 'custom-new' : selected} label="Default model" value={model} onChange={setModel} placeholder={current?.model ?? 'Your model ID'} disabled={busy} refreshKey={refresh} />
        </Field>
        <div className="button-row"><button className="button primary" disabled={busy || (custom && !model.trim())}>{busy ? <Busy /> : 'Save connection'}</button>
          {saved && <button type="button" className="button" disabled={busy} onClick={() => void perform(async () => { await api(`/api/providers/${selected}`, { method: 'DELETE' }); await onChanged(); select('openai'); setSuccess('Provider disconnected.'); })}>Disconnect</button>}
        </div>
      </fieldset>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {success && <p className="inline-success" role="status"><Check size={16} />{success}</p>}
  </>;
}
