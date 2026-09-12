import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { communityMetadataGenerationSchema, communityMetadataSuggestionSchema, type CommunityMetadataSuggestion } from '../shared/community';
import { isTextProvider } from '../shared/providers';
import { api, ApiError, message, type Provider } from './api';
import { Field } from './ui';

type MetadataSource = { projectId: string; revision: number; title: string; description: string; tags: string };
type MetadataDraft = { suggestion: CommunityMetadataSuggestion; source: MetadataSource; providerName: string };
type Props = MetadataSource & { busy: boolean; onApply: (suggestion: CommunityMetadataSuggestion) => void; onRefreshRevision: () => void };

export function CommunityMetadataGeneration({ projectId, revision, title, description, tags, busy, onApply, onRefreshRevision }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]), [provider, setProvider] = useState('');
  const [providersLoading, setProvidersLoading] = useState(true), [providerError, setProviderError] = useState(''), [providerRefresh, setProviderRefresh] = useState(0);
  const [prompt, setPrompt] = useState(''), [generating, setGenerating] = useState(false), [generationError, setGenerationError] = useState(''), [needsRefresh, setNeedsRefresh] = useState(false);
  const [draft, setDraft] = useState<MetadataDraft | null>(null), [notice, setNotice] = useState('');
  const generation = useRef<AbortController | null>(null);
  const connected = providers.filter(item => item.configured && isTextProvider(item.provider));
  const selectedName = connected.find(item => item.provider === provider)?.name || provider;
  const draftIsStale = !!draft && (draft.source.projectId !== projectId || draft.source.revision !== revision || draft.source.title !== title || draft.source.description !== description || draft.source.tags !== tags);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setProvidersLoading(true);
      setProviderError('');
      try {
        const result = await api<{ providers: Provider[] }>('/api/providers', { signal: request.signal });
        if (!active || request.signal.aborted) return;
        const available = result.providers.filter(item => item.configured && isTextProvider(item.provider));
        setProviders(result.providers);
        setProvider(current => available.some(item => item.provider === current) ? current : available[0]?.provider || '');
      } catch (error) {
        if (active && !request.signal.aborted) setProviderError(message(error));
      } finally {
        if (active && !request.signal.aborted) setProvidersLoading(false);
      }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('studio-providers-updated', refresh);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('studio-providers-updated', refresh);
    };
  }, [providerRefresh]);

  useEffect(() => () => { generation.current?.abort(); }, []);
  useEffect(() => { setGenerationError(''); setNeedsRefresh(false); }, [projectId, revision]);

  async function generate() {
    if (generation.current || busy || providersLoading || providerError || !provider) return;
    const controller = new AbortController();
    generation.current = controller;
    const source = { projectId, revision, title, description, tags };
    setGenerating(true);
    setGenerationError('');
    setNeedsRefresh(false);
    setNotice('');
    try {
      const body = communityMetadataGenerationSchema.parse({ projectId, expectedProjectRevision: revision, provider, title, description, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), prompt });
      const result = await api<{ suggestion: CommunityMetadataSuggestion; provider: string; projectRevision: number }>('/api/community/metadata/generate', {
        method: 'POST', signal: controller.signal, body: JSON.stringify(body),
      });
      if (controller.signal.aborted) return;
      if (result.projectRevision !== revision) throw new ApiError('The saved design changed. Load its current saved revision, review your fields, then generate again.', 409, 'revision_conflict');
      const suggestion = communityMetadataSuggestionSchema.parse(result.suggestion);
      const providerName = connected.find(item => item.provider === result.provider)?.name || result.provider;
      setDraft({ suggestion, source, providerName });
      setNotice('AI suggestion ready. Review the title, description and tags before using it.');
    } catch (error) {
      if (!controller.signal.aborted) {
        setGenerationError(message(error));
        const staleRevision = error instanceof ApiError && error.status === 409;
        setNeedsRefresh(staleRevision);
        if (staleRevision) setDraft(null);
      }
    } finally {
      if (!controller.signal.aborted) {
        generation.current = null;
        setGenerating(false);
      }
    }
  }

  function apply() {
    if (!draft || draftIsStale || busy || generating) return;
    onApply(draft.suggestion);
    setDraft(null);
    setGenerationError('');
    setNeedsRefresh(false);
    setNotice('Suggestion applied. Edit the fields below, then review public preflight again before publishing.');
  }

  return <section className="community-profile-ai community-metadata-ai" aria-label="AI listing suggestions">
    <h3><Sparkles size={16} aria-hidden="true" /> Draft listing details with AI</h3>
    <p>Generate a title, description and tags from your saved design, then review before using them.</p>
    {providersLoading && <p role="status">Loading your AI providers…</p>}
    {providerError && <div><p role="alert">Could not load your providers. {providerError}</p><button type="button" className="button" onClick={() => setProviderRefresh(value => value + 1)}>Retry providers</button></div>}
    {!providersLoading && !providerError && !connected.length && <p>No text provider connected. Connect one in Settings, or write your listing details below.</p>}
    <details className="community-metadata-options"><summary>Writing options{selectedName ? ` · ${selectedName}` : ''}</summary>
      {!!connected.length && <Field label="Listing AI provider"><select value={provider} disabled={generating || busy || providersLoading} onChange={event => { setProvider(event.target.value); setGenerationError(''); setNeedsRefresh(false); }}>
        {connected.map(item => <option key={item.provider} value={item.provider}>{item.name || item.provider}</option>)}
      </select></Field>}
      <Field label="Writing instructions (optional)" hint="Describe your preferred tone or audience. Avoid private information."><textarea maxLength={1000} rows={2} value={prompt} disabled={generating || busy} onChange={event => setPrompt(event.target.value)} placeholder="A concise, friendly description for fellow designers" /></Field>
    </details>
    <p className="community-profile-ai-disclosure">Sends visible text and structure from the saved design, these listing fields and your instructions to your provider. Hidden content, notes and assets are excluded. Uses your saved model and may incur charges.</p>
    <div className="community-profile-actions">
      <button type="button" className="button" disabled={generating || busy || providersLoading || !!providerError || !provider} onClick={() => { void generate(); }}><Sparkles size={16} aria-hidden="true" />{generating ? 'Generating listing…' : generationError ? 'Retry generation' : 'Generate with AI'}</button>
      <a className="button" href="/?settings=providers" target="_blank" rel="noopener noreferrer">Provider Settings (new tab)</a>
    </div>
    {generating && <p role="status">Generating a suggestion. Your listing fields stay editable.</p>}
    {generationError && <p role="alert">{generationError}</p>}
    {needsRefresh && <button type="button" className="button" disabled={busy || generating} onClick={onRefreshRevision}>Load current saved revision</button>}
    {draft && <div className="community-profile-suggestion">
      <h4>Review AI suggestion</h4>
      <p>Draft from {draft.providerName}. Nothing has been saved or published.</p>
      <dl><dt>Title</dt><dd>{draft.suggestion.title}</dd><dt>Description</dt><dd>{draft.suggestion.description || 'No description'}</dd><dt>Tags</dt><dd>{draft.suggestion.tags.join(', ') || 'No tags'}</dd></dl>
      {draftIsStale && <p role="status">Your fields or saved revision changed after generation started. Your edits are preserved. Generate again using your current fields, or discard this suggestion.</p>}
      <div className="community-profile-actions"><button type="button" className="button" disabled={draftIsStale || busy || generating} onClick={apply}>Use suggestion</button><button type="button" className="button" disabled={busy || generating} onClick={() => { setDraft(null); setNotice('Suggestion discarded. Your listing fields are unchanged.'); }}>Discard</button></div>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
