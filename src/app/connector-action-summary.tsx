import { FileCode2, GitPullRequest, ArrowUpRight } from 'lucide-react';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Present provider review data without losing the exact payload available in technical details. */
export function ConnectorActionSummary({ action, args, result }: { action: string; args: unknown; result: unknown }) {
  const input = record(args), output = record(result), review = record(output.review);
  if (action !== 'create_react_pull_request' || !text(review.repository)) return null;
  const files = Array.isArray(review.files) ? review.files.map(record) : [];
  return <section className="connector-export-review" aria-label="Export summary">
    <div className="connector-review-heading"><GitPullRequest size={24} aria-hidden="true"/><div><h3>{text(input.title) || 'React pull request'}</h3><p>{text(review.repository)}</p></div></div>
    <dl className="connector-facts">
      <div><dt>Base branch</dt><dd>{text(review.baseBranch)}</dd></div>
      <div><dt>Export directory</dt><dd>{text(review.directory)}</dd></div>
      <div><dt>Pinned commit</dt><dd><code title={text(review.baseCommit)}>{text(review.baseCommit).slice(0, 12)}</code></dd></div>
      <div><dt>Changes</dt><dd>{files.length} files · {Array.isArray(review.deletions) ? review.deletions.length : 0} deletions</dd></div>
    </dl>
    <div className="connector-file-heading"><h4>Files in this export</h4><span>New branch and pull request</span></div>
    <ul className="connector-file-list">{files.map((file, index) => <li key={text(file.path) || index}><FileCode2 size={16} aria-hidden="true"/><span>{text(file.path)}</span><small>{text(file.change)}{typeof file.bytes === 'number' ? ` · ${new Intl.NumberFormat('en').format(file.bytes)} B` : ''}</small></li>)}</ul>
    <p className="connector-note"><ArrowUpRight size={16} aria-hidden="true"/>The export opens a new pull request for review. It does not merge changes.</p>
  </section>;
}
