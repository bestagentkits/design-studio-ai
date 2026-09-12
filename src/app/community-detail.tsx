import { useState } from 'react';
import { Bookmark, Download, Flag, Play, X } from 'lucide-react';
import type { CommunityJob, CommunityListing, CommunityFile } from '../shared/community';
import type { CommunityDisclosure } from '../shared/community-projection';
import { api, post, message } from './api';
import { Modal, Field } from './ui';
import { communitySignIn } from './community-navigation';
import { fileSize, formatLabel, kindLabel } from './community-client';
import { CommunityJobStatus } from './community-job-status';
import { useCommunityBookmarks } from './community-bookmarks';
function exportScope(file: CommunityFile) {
  if (!file.options || ['package', 'json', 'html', 'react', 'motion', 'pdf', 'pptx'].includes(file.format || '')) return 'All included pages / screens';
  const options = file.options;
  return `Page / screen ${options.pageIndex + 1}${['mp4','webm','png-sequence','spritesheet'].includes(file.format || '') ? ` · ${options.start}s–${options.end === undefined ? 'end' : `${options.end}s`} · ${options.fps} fps` : ''}`;
}
function Disclosure({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<CommunityDisclosure>;
  const changes = [[report.removedNodes, 'hidden layers excluded'], [report.removedBoardElements, 'hidden board elements excluded'], [report.removedNotes, 'notes excluded'], [report.removedAssets, 'unused assets excluded'], [report.flattenedPaintings, 'paintings shared as visible composites']] as const;
  return <section className="community-disclosure"><h2>What you can edit</h2><ul>{report.editability?.map((text,index) => <li key={index}>{text}</li>)}</ul>{changes.some(([count]) => !!count) && <details><summary>Public content changes</summary><ul>{changes.filter(([count]) => !!count).map(([count,label]) => <li key={label}>{count} {label}</li>)}</ul></details>}</section>;
}
export function CommunitySave({ listing, signedIn, initiallySaved = false }: { listing: CommunityListing; signedIn: boolean; initiallySaved?: boolean }) {
  const bookmarks = useCommunityBookmarks();
  const [changed, setChanged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saved = bookmarks.ids.has(listing.id) || (!changed && initiallySaved);
  const setSaved = (value: boolean) => { setChanged(true); bookmarks.update(listing.id, value); };
  return <><button className={`button small ${saved ? 'selected' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${listing.title}`} aria-pressed={saved} disabled={busy} onClick={() => {
    if (!signedIn) { communitySignIn(`/community/designs/${listing.id}`); return; }
    const next = !saved; setSaved(next); setBusy(true); setError('');
    void api(`/api/community/listings/${listing.id}/bookmark`, { method: next ? 'PUT' : 'DELETE' }).catch(error => { setSaved(!next); setError(message(error)); }).finally(() => setBusy(false));
  }}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button>{error && <small role="alert">{error}</small>}</>;
}
export function CommunityCard({ listing, signedIn, saved }: { listing: CommunityListing; signedIn: boolean; saved?: boolean }) {
  return <article className="community-card"><a className="community-cover" href={`/community/designs/${listing.id}`} aria-label={`Open ${listing.title}`}>{listing.coverUrl ? <img src={listing.coverUrl} alt={listing.title} loading="lazy" /> : <span>Preview unavailable</span>}</a><div className="community-card-body"><small>{kindLabel(listing.kind)}</small><h2><a href={`/community/designs/${listing.id}`}>{listing.title}</a></h2><a className="community-byline" href={`/community/creators/${listing.creator.handle}`}>{listing.creator.displayName}</a><div className="community-card-footer"><span title="Unique people with a successful private remix">{listing.remixes} people used</span><CommunitySave listing={listing} signedIn={signedIn} initiallySaved={saved} /></div></div></article>;
}
export function CommunityDetail({ listing, signedIn }: { listing: CommunityListing; signedIn: boolean }) {
  const [preview, setPreview] = useState(false), [previewKey, setPreviewKey] = useState(0), [report, setReport] = useState(false), [reason, setReason] = useState('spam'), [reportMessage, setReportMessage] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [operation, setOperation] = useState<string | null>(new URL(location.href).searchParams.get('operation'));
  const useDesign = async () => {
    if (!signedIn) { communitySignIn(); return; }
    setBusy(true); setError('');
    try { const operationId = crypto.randomUUID(); const { job } = await post<{ job: CommunityJob }>(`/api/community/listings/${listing.id}/remix`, { version: listing.version, operationId }); setOperation(job.operationId); const url = new URL(location.href); url.searchParams.set('operation', job.operationId); history.replaceState(null, '', url.pathname + url.search); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const copyLink = async () => { try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(`${location.origin}/community/designs/${listing.id}`); setNotice('Link copied.'); } catch { setError('Clipboard unavailable. Copy the address from your browser.'); } };
  return <><header className="community-detail-title"><small>{kindLabel(listing.kind)} · Version {listing.version}</small><h1>{listing.title}</h1><a className="community-byline" href={`/community/creators/${listing.creator.handle}`}>By {listing.creator.displayName} · @{listing.creator.handle}</a></header><div className="community-detail-grid"><section className="community-preview-area"><div className="community-preview">
    {preview && listing.previewUrl ? <iframe key={previewKey} title={`Interactive preview of ${listing.title}`} sandbox="allow-scripts" allow="fullscreen" src={listing.previewUrl} /> : listing.coverUrl ? <img src={listing.coverUrl} alt={listing.title} /> : <p>Preview unavailable.</p>}
    </div><div className="button-row">{listing.previewUrl && <button className="button" onClick={() => setPreview(!preview)}>{preview ? <X size={16}/> : <Play size={16}/>} {preview ? 'Stop preview' : 'Start interactive preview'}</button>}{preview && <button className="button" onClick={() => setPreviewKey(value => value + 1)}>Reload preview</button>}</div><details className="community-preview-help"><summary>About this preview</summary><p>Preview starts only when requested. If it cannot load, try reloading or download a ready file below.</p></details>
  </section><aside className="community-detail-info"><button className="button primary" disabled={busy} onClick={() => void useDesign()}>{busy ? 'Starting your copy…' : 'Use this design'}</button><p className="community-muted">Creates an independent private project in your workspace.</p><div className="button-row"><a className="button" href="#downloads"><Download size={16}/> Download</a><CommunitySave listing={listing} signedIn={signedIn}/></div><p className="community-description">{listing.description}</p><div className="community-tags">{listing.tags.map(tag => <a key={tag} href={`/community?tags=${encodeURIComponent(tag)}`}>{tag}</a>)}</div><p>{listing.pageCount} pages / screens · {listing.remixes} unique people used · {listing.downloads} unique downloaders</p><h2>License & attribution</h2><p><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Download, adapt and remix with attribution.</p><Disclosure value={listing.disclosure}/>
    {listing.attribution && <p>Remixed from {!listing.attribution.originalUnavailable && listing.attribution.url ? <a href={listing.attribution.url}>{listing.attribution.title}</a> : <strong>{listing.attribution.originalUnavailable ? 'Original unavailable' : listing.attribution.title}</strong>} by {listing.attribution.creator.displayName}{!listing.attribution.verified && ' (declared attribution)'}</p>}
    <div className="button-row"><button className="button small" onClick={() => void copyLink()}>Copy link</button><button className="button small" onClick={() => signedIn ? setReport(true) : communitySignIn()}><Flag size={14}/> Report</button></div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}{operation && <CommunityJobStatus operationId={operation}/>}</aside></div>
    <section className="community-downloads" id="downloads"><h2>Download this version</h2><p>Built for version {listing.version}. The Studio package includes the editable structure and required assets.</p>{listing.files?.filter(file => file.role === 'download').map(file => <article key={file.id} className="community-file"><a href={file.url} download><Download size={19}/><span><strong>{formatLabel(file.format || file.filename)}</strong><small>{fileSize(file.size)} · {file.mimeType}</small><small>{exportScope(file)}</small></span></a><details><summary>File checksum</summary><small className="community-checksum">SHA-256 {file.checksum}</small></details></article>)}</section>
    {!!listing.remixListings?.length && <section><h2>Public remixes</h2><div className="community-grid">{listing.remixListings.map(item => <CommunityCard key={item.id} listing={item} signedIn={signedIn}/>)}</div></section>}
    {report && <Modal title="Report this design" onClose={() => setReport(false)}><form className="modal-body" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void post(`/api/community/listings/${listing.id}/reports`, { operationId: crypto.randomUUID(), version: listing.version, reason, message: reportMessage }).then(() => { setReport(false); setNotice('Report submitted privately to the moderation team.'); }).catch(error => setError(message(error))).finally(() => setBusy(false)); }}><p>Your identity and report are private to moderators.</p><Field label="Reason"><select value={reason} onChange={event => setReason(event.target.value)}>{[['spam','Spam'],['harmful','Harmful content'],['ownership','Ownership or licensing'],['privacy','Private information'],['other','Other']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="What should the moderator know?"><textarea required maxLength={2000} value={reportMessage} onChange={event => setReportMessage(event.target.value)}/></Field>{error && <p role="alert">{error}</p>}<button className="button primary" disabled={busy}>Submit report</button></form></Modal>}
  </>;
}
