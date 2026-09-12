import { useEffect, useState } from 'react';
import type { Project } from '../shared/schema';
import { communityPreflightSchema, communityPublishSchema, type CommunityListing, type CommunityPreflight, type CommunityProfile, type CommunityFormat, type CommunityJob } from '../shared/community';
import { CommunityCoverReview } from './community-cover-review';
import { api, post, message } from './api';
import { Modal, Field } from './ui';
import { CommunityProfileForm } from './community-profile';
import { CommunityJobStatus } from './community-job-status';
import { fileSize, formatLabel, useCommunityResource } from './community-client';
import './community.css';
export function CommunityPublishDialog({ project, accountId, listing, onClose }: { project: Project; accountId?: string; listing?: CommunityListing; onClose: () => void }) {
  const [coverTime, setCoverTime] = useState(0), [coverReady, setCoverReady] = useState(false), [availableFormats, setAvailableFormats] = useState<CommunityFormat[]>([]);
  const profileResource = useCommunityResource<{ profile: CommunityProfile | null }>('/api/community/me/profile');
  const [profile, setProfile] = useState<CommunityProfile | null>(null), [title, setTitle] = useState(listing?.title || project.name), [description, setDescription] = useState(listing?.description || ''), [tags, setTags] = useState(listing?.tags.join(', ') || ''), [formats, setFormats] = useState<CommunityFormat[]>(listing?.formats.filter(format => format !== 'package') || []), [pageIndex, setPageIndex] = useState(0), [focalX, setFocalX] = useState(.5), [focalY, setFocalY] = useState(.5), [preflight, setPreflight] = useState<CommunityPreflight | null>(null), [license, setLicense] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [current, setCurrent] = useState(project), [existing, setExisting] = useState(listing);
  const storageKey = `design-studio:community-build:${accountId || 'current'}:${project.id}`;
  const [operation, setOperation] = useState<string | null>(() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } });
  useEffect(() => { if (profileResource.data) setProfile(profileResource.data.profile); }, [profileResource.data]);
  useEffect(() => { if (!listing) void api<{ listings: CommunityListing[] }>('/api/community/me/listings').then(data => setExisting(data.listings.find(item => item.sourceProjectId === project.id))).catch(error => setError(message(error))); }, [listing, project.id]);
  const metadata = () => communityPreflightSchema.parse({ projectId: current.id, expectedProjectRevision: current.revision, title, description, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), formats: formats.filter(format => format !== 'package').map(format => ({ format, pageIndex })), cover: { pageIndex, time: coverTime, focalX, focalY } });
  const invalidate = () => { setPreflight(null); setConfirm(false); setLicense(false); };
  async function check(refresh = false) {
    setBusy(true); setError(''); setPreflight(null); setConfirm(false); setLicense(false);
    try {
      if (refresh) { const { project: fresh } = await api<{ project: Project }>(`/api/projects/${project.id}`); setCurrent(fresh); setError(`Saved revision ${fresh.revision} loaded. Your draft text was kept. Review it, then run preflight again.`); return; }
      const result = await post<{ preflight: CommunityPreflight }>('/api/community/preflight', metadata()); setPreflight(result.preflight); setAvailableFormats(result.preflight.availableFormats);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function publish() {
    if (!preflight || !license || !confirm || !coverReady) return;
    setBusy(true); setError('');
    try {
      const input = communityPublishSchema.parse({ ...metadata(), digest: preflight.digest, operationId: crypto.randomUUID(), license: 'CC-BY-4.0', acceptLicense: license, confirmPublic: confirm, ...(existing ? { expectedListingRevision: existing.revision } : {}) });
      setOperation(input.operationId); try { sessionStorage.setItem(storageKey, input.operationId); } catch { /* The ID remains visible for recovery. */ }
      const { job } = await post<{ job: CommunityJob }>(existing ? `/api/community/listings/${existing.id}/releases` : '/api/community/listings', input);
      setOperation(job.operationId); try { sessionStorage.setItem(storageKey, job.operationId); } catch { /* Receipt also remains on the server. */ }
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <Modal title={existing ? 'Update Community design' : 'Publish to Community'} onClose={onClose} wide><div className="modal-body community-publish">
    {profileResource.loading && <p role="status">Checking your public profile…</p>}{profileResource.error && <p role="alert">{profileResource.error}</p>}
    {!profileResource.loading && !profile && !profileResource.error && <CommunityProfileForm profile={null} onSaved={setProfile}/>}
    {profile && <><p>Publishing as <strong>{profile.displayName}</strong> · Saved project revision {current.revision}. Your existing Share link remains independent.</p>
      {existing?.state === 'hidden' && <p role="alert">A moderator has hidden this listing. {existing.moderationReason} Publishing an update cannot restore public access.</p>}
      <div className="community-publish-fields"><div><Field label="Title"><input required maxLength={200} value={title} onChange={event => { setTitle(event.target.value); invalidate(); }}/></Field><Field label="Description"><textarea maxLength={4000} value={description} onChange={event => { setDescription(event.target.value); invalidate(); }}/></Field><Field label="Tags" hint="Up to 8 tags, separated by commas."><input value={tags} maxLength={270} onChange={event => { setTags(event.target.value); invalidate(); }}/></Field>
      <Field label="Cover page / screen"><select value={pageIndex} onChange={event => { setPageIndex(Number(event.target.value)); invalidate(); }}>{current.document.pages.map((page,index) => <option key={page.id} value={index}>{index + 1}. {page.name}</option>)}</select></Field>{current.document.timeline && <Field label="Cover frame time (seconds)"><input type="number" min="0" max={current.document.timeline.duration} step="0.1" value={coverTime} onChange={event => { setCoverTime(Number(event.target.value)); invalidate(); }}/></Field>}<Field label="Cover horizontal focus"><input type="range" min="0" max="1" step="0.05" value={focalX} onChange={event => { setFocalX(Number(event.target.value)); invalidate(); }}/></Field><Field label="Cover vertical focus"><input type="range" min="0" max="1" step="0.05" value={focalY} onChange={event => { setFocalY(Number(event.target.value)); invalidate(); }}/></Field>
      {availableFormats.length > 0 && <fieldset><legend>Download formats</legend><label><input type="checkbox" checked disabled/> Studio project package (.zip), required</label>{availableFormats.filter(format => format !== 'package').map(format => <label key={format}><input type="checkbox" checked={formats.includes(format)} onChange={event => { setFormats(values => event.target.checked ? [...values, format] : values.filter(value => value !== format)); invalidate(); }}/>{formatLabel(format)}</label>)}</fieldset>}<button className="button" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Review public preflight'}</button></div>
      <div className="community-public-review">{preflight ? <><h3>What will be shared</h3><CommunityCoverReview document={preflight.document} pageIndex={pageIndex} time={coverTime} focalX={focalX} focalY={focalY} onReady={setCoverReady}/><p>{preflight.pageCount} visible pages · {fileSize(preflight.assetBytes)} of assets</p><p>Hidden content, notes and unused private assets are excluded. Painting is a visible composite. Review the details before accepting.</p><details><summary>Projection and editability details</summary><pre>{JSON.stringify(preflight.disclosure, null, 2)}</pre></details><details><summary>Included assets</summary><ul>{preflight.document.assets.map(asset => <li key={asset.id}>{asset.name}</li>)}</ul></details>
      
      {!!preflight.issues.length && <div role="alert">{preflight.issues.map((issue,index) => <p key={index}>{issue.message}</p>)}</div>}
      <label className="community-consent"><input type="checkbox" disabled={!coverReady} checked={license} onChange={event => setLicense(event.target.checked)}/><span>I have the rights to share this design and its assets. I license this version under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, allowing downloads and remix with attribution.</span></label><label className="community-consent"><input type="checkbox" disabled={!coverReady} checked={confirm} onChange={event => setConfirm(event.target.checked)}/><span>I reviewed the public content and explicitly confirm publication of this version.</span></label><button className="button primary" disabled={busy || !license || !confirm || !coverReady || !!preflight.issues.length} onClick={() => void publish()}>{existing ? 'Publish updated version' : 'Confirm and publish'}</button></> : <><h3>Review before publishing</h3><p>Preflight checks the saved revision, visible source, asset permissions and supported exports. Nothing becomes public until you confirm and every selected artifact finishes building.</p>{formats.length > 0 && <p>Selected: {formats.map(formatLabel).join(', ')}. Run preflight again after changes.</p>}</>}</div></div>
      {error && <div role="alert"><p>{error}</p><button className="button" disabled={busy} onClick={() => void check(true)}>Load current saved revision</button></div>}
      {operation && <><CommunityJobStatus operationId={operation}/><button className="button small" onClick={() => { setOperation(null); try { sessionStorage.removeItem(storageKey); } catch { /* Optional local receipt. */ } }}>Dismiss local status</button><p>Closing this dialog does not cancel an accepted build. A failed build leaves the last live version unchanged; correct the issue and submit a new reviewed request.</p></>}
    </>}
  </div></Modal>;
}
