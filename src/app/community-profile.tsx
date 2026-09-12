import { useState } from 'react';
import { communityProfileSchema, type CommunityProfile } from '../shared/community';
import { put, message } from './api';
import { Field } from './ui';
export function CommunityProfileForm({ profile, onSaved }: { profile: CommunityProfile | null; onSaved: (profile: CommunityProfile) => void }) {
  const [name, setName] = useState(profile?.displayName || ''), [handle, setHandle] = useState(profile?.handle || ''), [bio, setBio] = useState(profile?.bio || ''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form className="community-profile-form" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void (async () => {
    try { const body = communityProfileSchema.parse({ displayName: name, handle, bio, expectedProfileRevision: profile?.revision || 0 }); const result = await put<{ profile: CommunityProfile }>('/api/community/me/profile', body); onSaved(result.profile); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  })(); }}>
    <h2>{profile ? 'Your public profile' : 'Choose your public identity'}</h2><p>Only the name, handle and bio you choose here will be public. Your email and private projects stay private.</p>
    <Field label="Public display name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="Public handle" hint="3–40 lowercase letters, numbers or single hyphens."><input required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={handle} onChange={event => setHandle(event.target.value.toLowerCase())} /></Field>
    <Field label="Bio"><textarea maxLength={500} value={bio} onChange={event => setBio(event.target.value)} /></Field>
    <div className="community-profile-preview"><span className="avatar">{name.trim().slice(0, 1).toUpperCase() || '?'}</span><div><strong>{name || 'Your display name'}</strong><p>@{handle || 'your-handle'}</p><p>{bio}</p></div></div>
    {error && <p role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? 'Saving profile…' : 'Save public profile'}</button>
  </form>;
}
