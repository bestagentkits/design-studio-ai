import { useEffect, useRef, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Project } from '../shared/schema';
import { communityPreflightSchema, communityPublishSchema, type CommunityListing, type CommunityPreflight, type CommunityProfile, type CommunityFormat, type CommunityJob } from '../shared/community';
import { CommunityCoverReview } from './community-cover-review';
import { api, post, message } from './api';
import { Modal, Field } from './ui';
import { CommunityProfileForm } from './community-profile';
import { CommunityMetadataGeneration } from './community-metadata-generation';
import { CommunityJobStatus } from './community-job-status';
import { fileSize, formatLabel, useCommunityResource } from './community-client';
import { frameExportBudget } from '../shared/frame-export-budget';
import './community.css';
import './community-publish.css';
export function CommunityPublishDialog({ project, accountId, listing, onClose }: { project: Project; accountId?: string; listing?: CommunityListing; onClose: () => void }) {
  const [coverTime, setCoverTime] = useState(0), [coverReady, setCoverReady] = useState(false), [availableFormats, setAvailableFormats] = useState<CommunityFormat[]>([]);
  const profileResource = useCommunityResource<{ profile: CommunityProfile | null }>('/api/community/me/profile');
  const [profile, setProfile] = useState<CommunityProfile | null>(null), [title, setTitle] = useState(listing?.title || project.name), [description, setDescription] = useState(listing?.description || ''), [tags, setTags] = useState(listing?.tags.join(', ') || ''), [formats, setFormats] = useState<CommunityFormat[]>(listing?.formats.filter(format => format !== 'package') || []), [pageIndex, setPageIndex] = useState(0), [focalX, setFocalX] = useState(.5), [focalY, setFocalY] = useState(.5), [preflight, setPreflight] = useState<CommunityPreflight | null>(null), [license, setLicense] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [current, setCurrent] = useState(project), [existing, setExisting] = useState(listing);
  const storageKey = `design-studio:community-build:${accountId || 'current'}:${project.id}`;
  const [operation, setOperation] = useState<string | null>(() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } });
  const [published, setPublished] = useState<CommunityJob | null>(null), [failedJob, setFailedJob] = useState<CommunityJob | null>(null), [frameFps, setFrameFps] = useState<number | null>(null);
  const allFormatsRef = useRef<HTMLInputElement>(null);
  const coverPage = current.document.pages[pageIndex] ?? current.document.pages[0], duration = current.document.timeline?.duration ?? 2;
  const frameInput = { width: coverPage.width, height: coverPage.height, start: 0, end: duration, fps: frameFps ?? 30 };
  const sequenceBudget = frameExportBudget({ ...frameInput, format: 'png-sequence' }), sheetBudget = frameExportBudget({ ...frameInput, format: 'spritesheet' });
  const frameBudget = formats.includes('spritesheet') ? sheetBudget : sequenceBudget;
  const recommendedFps = Math.max(1, Math.min(30, frameBudget.maxFps)), archiveFps = frameFps ?? recommendedFps;
  const isFrameArchive = (format: CommunityFormat) => format === 'png-sequence' || format === 'spritesheet';
  const frameFormatAvailable = (format: CommunityFormat) => format === 'spritesheet' ? sheetBudget.maxFps >= 1 : format === 'png-sequence' ? sequenceBudget.maxFps >= 1 : true;
  const selectableFormats = availableFormats.filter(format => format !== 'package' && frameFormatAvailable(format));
  const allFormatsSelected = selectableFormats.length > 0 && selectableFormats.every(format => formats.includes(format));
  useEffect(() => { if (allFormatsRef.current) allFormatsRef.current.indeterminate = !allFormatsSelected && selectableFormats.some(format => formats.includes(format)); }, [allFormatsSelected, selectableFormats, formats]);
  useEffect(() => { if (profileResource.data) setProfile(profileResource.data.profile); }, [profileResource.data]);
  useEffect(() => { if (!listing) void api<{ listings: CommunityListing[] }>('/api/community/me/listings').then(data => setExisting(data.listings.find(item => item.sourceProjectId === project.id))).catch(error => setError(message(error))); }, [listing, project.id]);
  const metadata = () => communityPreflightSchema.parse({ projectId: current.id, expectedProjectRevision: current.revision, title, description, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), formats: formats.filter(format => format !== 'package').map(format => ({ format, pageIndex, ...(isFrameArchive(format) ? { fps: archiveFps } : {}) })), cover: { pageIndex, time: coverTime, focalX, focalY } });
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
    setBusy(true); setError(''); setFailedJob(null);
    try {
      const input = communityPublishSchema.parse({ ...metadata(), digest: preflight.digest, operationId: crypto.randomUUID(), license: 'CC-BY-4.0', acceptLicense: license, confirmPublic: confirm, ...(existing ? { expectedListingRevision: existing.revision } : {}) });
      setOperation(input.operationId); try { sessionStorage.setItem(storageKey, input.operationId); } catch { /* The ID remains visible for recovery. */ }
      const { job } = await post<{ job: CommunityJob }>(existing ? `/api/community/listings/${existing.id}/releases` : '/api/community/listings', input);
      setOperation(job.operationId); try { sessionStorage.setItem(storageKey, job.operationId); } catch { /* Receipt also remains on the server. */ }
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const clearReceipt = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Optional local receipt. */ } };
  async function returnToDetails() {
    setBusy(true); setError('');
    try {
      // Even a failed first build has created a revision-checked draft listing.
      const { listings } = await api<{ listings: CommunityListing[] }>('/api/community/me/listings');
      setExisting(listings.find(item => item.sourceProjectId === project.id));
      invalidate(); setOperation(null); setFailedJob(null); clearReceipt();
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  if (published?.listingId) return <CommunityPublishSuccess listingId={published.listingId} onClose={() => { clearReceipt(); onClose(); }} onVisit={clearReceipt}/>;
  if (operation) return <Modal title="Publishing to Community" onClose={onClose} className="community-publish-modal community-publish-status-modal"><div className="modal-body community-publish">
    <p>Your design will go live when all selected downloads are ready.</p>
    <CommunityJobStatus operationId={operation} onPublished={setPublished} onFailed={setFailedJob}/>
    {error && <p role="alert">{error}</p>}
    <p className="community-muted">You can close this dialog while the build continues. If it fails, your last published version stays available.</p>
    {(failedJob || error) && <button className="button" disabled={busy} onClick={() => { void returnToDetails(); }}>Back to details</button>}
  </div></Modal>;
  return <Modal title={existing ? 'Update Community design' : 'Publish to Community'} onClose={onClose} wide className="community-publish-modal"><div className="modal-body community-publish">
    {profileResource.loading && <p role="status">Checking your public profile…</p>}{profileResource.error && <p role="alert">{profileResource.error}</p>}
    {!profileResource.loading && !profile && !profileResource.error && <CommunityProfileForm profile={null} onSaved={setProfile}/>}
    {profile && <><div className="community-publish-intro"><p>Publishing as <strong>{profile.displayName}</strong></p><p>Saved revision {current.revision}. Your existing Share link remains independent.</p></div>
      {existing?.state === 'hidden' && <p role="alert">A moderator has hidden this listing. {existing.moderationReason} Publishing an update cannot restore public access.</p>}
      <div className="community-publish-fields"><div><CommunityMetadataGeneration projectId={current.id} revision={current.revision} title={title} description={description} tags={tags} busy={busy} onRefreshRevision={() => { void check(true); }} onApply={suggestion => { setTitle(suggestion.title); setDescription(suggestion.description); setTags(suggestion.tags.join(', ')); invalidate(); }}/><Field label="Title"><input required maxLength={200} value={title} onChange={event => { setTitle(event.target.value); invalidate(); }}/></Field><Field label="Description"><textarea maxLength={4000} value={description} onChange={event => { setDescription(event.target.value); invalidate(); }}/></Field><Field label="Tags" hint="Up to 8 tags, separated by commas."><input value={tags} maxLength={270} onChange={event => { setTags(event.target.value); invalidate(); }}/></Field>
      <section className="community-cover-settings" aria-labelledby="community-cover-heading"><h3 id="community-cover-heading">Cover</h3>
      <Field label="Cover page / screen"><select value={pageIndex} onChange={event => { setPageIndex(Number(event.target.value)); invalidate(); }}>{current.document.pages.map((page,index) => <option key={page.id} value={index}>{index + 1}. {page.name}</option>)}</select></Field>{current.document.timeline && <Field label="Cover frame time (seconds)"><input type="number" min="0" max={current.document.timeline.duration} step="0.1" value={coverTime} onChange={event => { setCoverTime(Number(event.target.value)); invalidate(); }}/></Field>}<div className="community-cover-focus"><Field label="Cover horizontal focus"><input type="range" min="0" max="1" step="0.05" value={focalX} onChange={event => { setFocalX(Number(event.target.value)); invalidate(); }}/></Field><Field label="Cover vertical focus"><input type="range" min="0" max="1" step="0.05" value={focalY} onChange={event => { setFocalY(Number(event.target.value)); invalidate(); }}/></Field></div></section>
      {availableFormats.length > 0 && <fieldset className="community-download-options"><legend>Download formats</legend><div className="community-format-options">
        <label className="community-select-all"><input ref={allFormatsRef} type="checkbox" checked={allFormatsSelected} disabled={!selectableFormats.length} onChange={event => { setFormats(event.target.checked ? selectableFormats : []); invalidate(); }}/><span>All</span></label>
        <label className="community-required-format"><input type="checkbox" checked disabled/><span>Studio project package (.zip)<small>Always included</small></span></label>{availableFormats.filter(format => format !== 'package').map(format => <label key={format}><input type="checkbox" checked={formats.includes(format)} disabled={!frameFormatAvailable(format)} onChange={event => { setFormats(values => event.target.checked ? [...values, format] : values.filter(value => value !== format)); invalidate(); }}/><span>{formatLabel(format)}</span></label>)}</div>
        {formats.some(isFrameArchive) && <Field label="Frame archive FPS" hint={`Recommended: ${recommendedFps} fps for the full ${duration}s at ${coverPage.width} × ${coverPage.height}. Applies to PNG sequence and spritesheet; video downloads stay at 30 fps.`}><input type="number" min="1" max="60" step="1" value={archiveFps} onChange={event => { setFrameFps(Number(event.target.value)); invalidate(); }}/></Field>}
        {availableFormats.some(format => !frameFormatAvailable(format)) && <p className="community-muted">Unavailable frame archives need a smaller page or a shorter animation, even at 1 fps. Other downloads are available.</p>}
      </fieldset>}<button className="button community-preflight-action" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Review public preflight'}</button></div>
      <div className="community-public-review">{preflight ? <><h3>What will be shared</h3><CommunityCoverReview document={preflight.document} pageIndex={pageIndex} time={coverTime} focalX={focalX} focalY={focalY} onReady={setCoverReady}/><p>{preflight.pageCount} visible pages · {fileSize(preflight.assetBytes)} of assets</p><p>Hidden content, notes and unused private assets are excluded. Painting is a visible composite. Review the details before accepting.</p><details><summary>Projection and editability details</summary><pre>{JSON.stringify(preflight.disclosure, null, 2)}</pre></details><details><summary>Included assets</summary><ul>{preflight.document.assets.map(asset => <li key={asset.id}>{asset.name}</li>)}</ul></details>
      
      {!!preflight.issues.length && <div role="alert">{preflight.issues.map((issue,index) => <p key={index}>{issue.message}</p>)}</div>}
      <label className="community-consent"><input type="checkbox" disabled={!coverReady} checked={license} onChange={event => setLicense(event.target.checked)}/><span>I have the rights to share this design and its assets. I license this version under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, allowing downloads and remix with attribution.</span></label><label className="community-consent"><input type="checkbox" disabled={!coverReady} checked={confirm} onChange={event => setConfirm(event.target.checked)}/><span>I reviewed the public content and explicitly confirm publication of this version.</span></label><button className="button primary" disabled={busy || !license || !confirm || !coverReady || !!preflight.issues.length} onClick={() => void publish()}>{existing ? 'Publish updated version' : 'Confirm and publish'}</button></> : <><h3>Review before publishing</h3><p>Preflight checks the saved revision, visible source, asset permissions and supported exports. Nothing becomes public until you confirm and every selected artifact finishes building.</p>{formats.length > 0 && <p>Selected: {formats.map(formatLabel).join(', ')}. Run preflight again after changes.</p>}</>}</div></div>
      {error && <div role="alert"><p>{error}</p><button className="button" disabled={busy} onClick={() => void check(true)}>Load current saved revision</button></div>}
    </>}
  </div></Modal>;
}

function CommunityPublishSuccess({ listingId, onClose, onVisit }: { listingId: string; onClose: () => void; onVisit: () => void }) {
  return <Modal title="Published to Community" onClose={onClose} className="community-publish-modal community-publish-status-modal"><div className="modal-body community-publish community-publish-success">
    <CircleCheck size={48} strokeWidth={1.5} aria-hidden="true"/>
    <h3>Congratulations!</h3><p>Your design is live. The community can now explore it, download it and make it their own.</p>
    <a className="button primary" href={`/community/designs/${listingId}`} onClick={onVisit}>View published design</a>
    <button className="button" onClick={onClose}>Done</button>
  </div></Modal>;
}
