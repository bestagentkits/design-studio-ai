import { useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { CommunityJob } from '../shared/community';
import { useCommunityJob } from './community-client';
export function CommunityJobStatus({ operationId, onPublished, onFailed }: { operationId: string; onPublished?: (job: CommunityJob) => void; onFailed?: (job: CommunityJob) => void }) {
  const { job, error, retry } = useCommunityJob(operationId);
  const working = !error && (!job || job.status === 'queued' || job.status === 'running');
  useEffect(() => { if (job?.status === 'succeeded' && job.kind === 'publish' && job.listingId) onPublished?.(job); }, [job, onPublished]);
  useEffect(() => { if (job?.status === 'failed') onFailed?.(job); }, [job, onFailed]);
  return <section className="community-job" aria-label="Community operation status"><p className="community-job-progress" role="status">{working && <LoaderCircle size={20} className="spinner" aria-hidden="true"/>}<span>{error || (job ? `${job.status === 'succeeded' ? 'Complete' : job.status === 'failed' ? 'Failed' : 'Working'} · ${job.stage}` : 'Checking your operation…')}</span></p>
    {job?.error && <p role="alert">{job.error.message}</p>}
    {error && <button className="button" onClick={retry}>Check status again</button>}
    {job?.status === 'succeeded' && job.listingId && !job.projectId && <a className="button primary" href={`/community/designs/${job.listingId}`}>View published design</a>}
    {job?.status === 'succeeded' && job.projectId && <a className="button primary" href={`/?project=${encodeURIComponent(job.projectId)}`}>Open your private design</a>}
    <details><summary>Recovery details</summary><small>Operation {operationId}. You can close this page and return to check the receipt.</small></details>
  </section>;
}
