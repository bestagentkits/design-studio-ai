import { useCommunityJob } from './community-client';
export function CommunityJobStatus({ operationId }: { operationId: string }) {
  const { job, error, retry } = useCommunityJob(operationId);
  return <section className="community-job" aria-label="Community operation status"><p role="status">{error || (job ? `${job.status === 'succeeded' ? 'Complete' : job.status === 'failed' ? 'Failed' : 'Working'} · ${job.stage}` : 'Checking your operation…')}</p>
    {job?.error && <p role="alert">{job.error.message}</p>}
    {error && <button className="button" onClick={retry}>Check status again</button>}
    {job?.status === 'succeeded' && job.listingId && !job.projectId && <a className="button primary" href={`/community/designs/${job.listingId}`}>View published design</a>}
    {job?.status === 'succeeded' && job.projectId && <a className="button primary" href={`/?project=${encodeURIComponent(job.projectId)}`}>Open your private design</a>}
    <details><summary>Recovery details</summary><small>Operation {operationId}. You can close this page and return to check the receipt.</small></details>
  </section>;
}
