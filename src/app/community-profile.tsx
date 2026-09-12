import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { communityProfileSchema, communityProfileSuggestionSchema, type CommunityProfile, type CommunityProfileSuggestion } from '../shared/community';
import { isTextProvider } from '../shared/providers';
import { api, put, message, type Provider } from './api';
import { Field } from './ui';

type ProfileDraft = { suggestion: CommunityProfileSuggestion; source: CommunityProfileSuggestion; providerName: string };

export function CommunityProfileForm({ profile, onSaved }: { profile: CommunityProfile | null; onSaved: (profile: CommunityProfile) => void }) {
  const [name, setName] = useState(profile?.displayName || ''), [handle, setHandle] = useState(profile?.handle || ''), [bio, setBio] = useState(profile?.bio || '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]), [provider, setProvider] = useState('');
  const [providersLoading, setProvidersLoading] = useState(true), [providerError, setProviderError] = useState(''), [providerRefresh, setProviderRefresh] = useState(0);
  const [prompt, setPrompt] = useState(''), [generating, setGenerating] = useState(false), [generationError, setGenerationError] = useState('');
  const [draft, setDraft] = useState<ProfileDraft | null>(null), [notice, setNotice] = useState('');
  const generation = useRef<AbortController | null>(null);
  const connected = providers.filter(item => item.configured && isTextProvider(item.provider));
  const draftIsStale = !!draft && (draft.source.displayName !== name || draft.source.handle !== handle || draft.source.bio !== bio);

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

  async function generate() {
    if (generation.current || busy || providersLoading || providerError || !provider) return;
    const controller = new AbortController();
    generation.current = controller;
    const source = { displayName: name, handle, bio };
    const providerName = connected.find(item => item.provider === provider)?.name || provider;
    setGenerating(true);
    setGenerationError('');
    setNotice('');
    try {
      const result = await api<{ suggestion: CommunityProfileSuggestion; provider: string }>('/api/community/me/profile/generate', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ provider, ...source, prompt }),
      });
      if (controller.signal.aborted) return;
      const suggestion = communityProfileSuggestionSchema.parse(result.suggestion);
      setDraft({ suggestion, source, providerName });
      setNotice('AI suggestion ready. Review it before using it.');
    } catch (error) {
      if (!controller.signal.aborted) setGenerationError(message(error));
    } finally {
      if (!controller.signal.aborted) {
        generation.current = null;
        setGenerating(false);
      }
    }
  }

  function useSuggestion() {
    if (!draft || draftIsStale || busy || generating) return;
    setName(draft.suggestion.displayName);
    setHandle(draft.suggestion.handle);
    setBio(draft.suggestion.bio);
    setDraft(null);
    setError('');
    setNotice('Suggestion applied. Edit the fields below, then save your public profile.');
  }

  return <form className="community-profile-form" onSubmit={event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const body = communityProfileSchema.parse({ displayName: name, handle, bio, expectedProfileRevision: profile?.revision || 0 });
        const result = await put<{ profile: CommunityProfile }>('/api/community/me/profile', body);
        generation.current?.abort();
        generation.current = null;
        setGenerating(false);
        setDraft(null);
        setNotice('Public profile saved.');
        onSaved(result.profile);
      } catch (error) { setError(message(error)); }
      finally { setBusy(false); }
    })();
  }}>
    <h2>{profile ? 'Your public profile' : 'Choose your public identity'}</h2>
    <p>Only the name, handle and bio you choose here will be public. Your email and private projects stay private.</p>
    <section className="community-profile-ai" aria-label="AI profile suggestions">
      <h3><Sparkles size={16} aria-hidden="true" /> Draft your public identity</h3>
      <p>Generate a name, handle and bio, then review before saving. You can also write your own below.</p>
      {providersLoading && <p role="status">Loading your AI providers…</p>}
      {providerError && <div><p role="alert">Could not load your providers. {providerError}</p><button className="button" type="button" onClick={() => setProviderRefresh(value => value + 1)}>Retry providers</button></div>}
      {!providersLoading && !providerError && !connected.length && <p>No text provider connected. Connect one in Settings to generate a profile.</p>}
      {!!connected.length && <Field label="Profile AI provider"><select value={provider} disabled={generating || busy || providersLoading} onChange={event => { setProvider(event.target.value); setGenerationError(''); }}>
        {connected.map(item => <option key={item.provider} value={item.provider}>{item.name || item.provider}</option>)}
      </select></Field>}
      <Field label="Writing instructions (optional)" hint="Describe your interests or preferred tone. Avoid private information."><textarea maxLength={1000} rows={3} value={prompt} disabled={generating || busy} onChange={event => setPrompt(event.target.value)} placeholder="A playful name and a short bio about my love of typography" /></Field>
      <p className="community-profile-ai-disclosure">Uses your provider connection and may incur charges. Only these profile fields and writing instructions are sent to the provider.</p>
      <div className="community-profile-actions">
        <button type="button" className="button" disabled={generating || busy || providersLoading || !!providerError || !provider} onClick={() => { void generate(); }}><Sparkles size={16} aria-hidden="true" />{generating ? 'Generating profile…' : generationError ? 'Retry generation' : 'Generate with AI'}</button>
        <a className="button" href="/?settings=providers" target="_blank" rel="noopener noreferrer">Provider Settings (new tab)</a>
      </div>
      {generating && <p role="status">Generating a suggestion. Your profile fields stay editable.</p>}
      {generationError && <p role="alert">{generationError}</p>}
      {draft && <div className="community-profile-suggestion">
        <h4>Review AI suggestion</h4>
        <p>Draft from {draft.providerName}. Nothing has been saved.</p>
        <dl><dt>Display name</dt><dd>{draft.suggestion.displayName}</dd><dt>Handle</dt><dd>@{draft.suggestion.handle}</dd><dt>Bio</dt><dd>{draft.suggestion.bio || 'No bio'}</dd></dl>
        <p>Use this suggestion to edit it in your profile fields. Handle availability is checked again when you save.</p>
        {draftIsStale && <p role="status">You edited your profile after generation started. Your edits are preserved. Generate again using your current fields, or discard this suggestion.</p>}
        <div className="community-profile-actions"><button type="button" className="button" disabled={draftIsStale || busy || generating} onClick={useSuggestion}>Use suggestion</button><button type="button" className="button" disabled={busy || generating} onClick={() => { setDraft(null); setNotice('Suggestion discarded. Your profile fields are unchanged.'); }}>Discard</button></div>
      </div>}
    </section>
    {notice && <p role="status">{notice}</p>}
    <Field label="Public display name"><input required maxLength={100} disabled={busy} value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="Public handle" hint="3–40 lowercase letters, numbers or single hyphens."><input required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={busy} value={handle} onChange={event => setHandle(event.target.value.toLowerCase())} /></Field>
    <Field label="Bio"><textarea maxLength={500} disabled={busy} value={bio} onChange={event => setBio(event.target.value)} /></Field>
    <div className="community-profile-preview"><span className="avatar">{name.trim().slice(0, 1).toUpperCase() || '?'}</span><div><strong>{name || 'Your display name'}</strong><p>@{handle || 'your-handle'}</p><p>{bio}</p></div></div>
    {error && <p role="alert">{error}</p>}<button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving profile…' : 'Save public profile'}</button>
  </form>;
}
