import { useState } from 'react';
import { apiEndpoints } from '../shared/api-reference';
import { download } from './api';
export function ApiPlayground() {
  const [key, setKey] = useState(''), [endpoint, setEndpoint] = useState(0), [projectId, setProjectId] = useState(''), [body, setBody] = useState(''), [output, setOutput] = useState(''), [running, setRunning] = useState(false), [binary, setBinary] = useState<Blob | null>(null), [status, setStatus] = useState('');
  const selected = apiEndpoints[endpoint];
  const [query, setQuery] = useState(''), [file, setFile] = useState<File | null>(null);
  const upload = selected.method === 'POST' && selected.path.endsWith('/assets');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const path = selected.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(name === 'id' ? projectId : parameters[name] ?? ''));
  const suffix = new URLSearchParams(query.replace(/^\?/, '')).toString();
  const requestPath = path + (suffix ? `?${suffix}` : '');
  const requestUrl = new URL(requestPath, typeof window === 'undefined' ? 'https://studio.example' : window.location.origin).href;
  // Shell quoting keeps the displayed command safe even for user-entered query text.
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  async function execute() {
    setRunning(true); setBinary(null); setOutput(''); const started = performance.now();
    try {
      if (selected.path.includes('{id}') && !projectId.trim()) throw new Error(selected.path.includes('/design-systems') ? 'Enter a design system ID' : 'Enter a project ID');
      for (const match of selected.path.matchAll(/\{(\w+)\}/g)) if (match[1] !== 'id' && !parameters[match[1]]) throw new Error(`Enter ${match[1]}`);
      let payload: BodyInit | undefined = selected.body ? JSON.stringify(JSON.parse(body || JSON.stringify(selected.body))) : undefined;
      if (upload) { if (!file) throw new Error('Choose a file to upload'); const form = new FormData(); form.append('file', file); payload = form; }
      const response = await fetch(requestPath, { method: selected.method, credentials: key ? 'omit' : 'same-origin', headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(payload && !upload ? { 'Content-Type': 'application/json' } : {}) }, body: payload, redirect: 'error', signal: AbortSignal.timeout(180000) });
      setStatus(`${response.status} ${response.statusText} · ${Math.round(performance.now() - started)} ms`);
      if (/json|text|xml/.test(response.headers.get('Content-Type') ?? '')) { const text = await response.text(); try { setOutput(JSON.stringify(JSON.parse(text), null, 2)); } catch { setOutput(text); } }
      else { const blob = await response.blob(); setBinary(blob); setOutput(`${blob.type} · ${blob.size} bytes`); }
    } catch (error) { setOutput(error instanceof Error ? error.message : 'Request failed'); } finally { setRunning(false); }
  }
  return <section className="api-playground"><h2>Try the API</h2><p>Requests run against this studio. Writes change your real project. The key stays in this page’s memory and is cleared when you leave.</p>
    <label>API key <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder="Bearer key, or use your signed-in session"/></label><button onClick={() => setKey('')}>Clear key</button>
    <label>Endpoint <select value={endpoint} onChange={e => { const index = +e.target.value; setEndpoint(index); setBody(apiEndpoints[index].body ? JSON.stringify(apiEndpoints[index].body, null, 2) : ''); }}>{apiEndpoints.map((e, i) => <option key={`${e.method}:${e.path}`} value={i}>{e.method} {e.path} — {e.summary}</option>)}</select></label>
    {selected.path.includes('{id}') && <label>{selected.path.includes('/design-systems') ? 'Design system ID' : 'Project ID'} <input value={projectId} onChange={e => setProjectId(e.target.value)}/></label>}
    {[...selected.path.matchAll(/\{(\w+)\}/g)].filter(match => match[1] !== 'id').map(match => <label key={match[1]}>{match[1]}<input value={parameters[match[1]] ?? ''} onChange={e => setParameters(prev => ({ ...prev, [match[1]]: e.target.value }))}/></label>)}
    <label>Query parameters<input placeholder="q=Inter&version=1" value={query} onChange={e => setQuery(e.target.value)}/></label>
    {upload ? <label>File<input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)}/></label> : selected.body && <label>JSON body<textarea rows={12} value={body || JSON.stringify(selected.body, null, 2)} onChange={e => setBody(e.target.value)} spellCheck={false}/></label>}
    <div className="button-row"><button disabled={running} onClick={() => void execute()}>{running ? 'Running…' : `Execute ${selected.method}`}</button><a href="/api/openapi" target="_blank" rel="noreferrer">OpenAPI JSON</a></div><p aria-live="polite">{status}</p><pre tabIndex={0}>{output}</pre>{binary && <button onClick={() => download('studio-export', binary, binary.type)}>Download response</button>}
    <p>CLI equivalent uses your environment key; no secret is included here.</p><pre>{`curl -X ${selected.method} ${shellQuote(requestUrl)} -H "Authorization: Bearer $DESIGN_STUDIO_API_KEY"${upload ? " -F 'file=@/path/to/asset'" : selected.body ? " -H 'Content-Type: application/json' --data @request.json" : ''}`}</pre>
  </section>;
}
