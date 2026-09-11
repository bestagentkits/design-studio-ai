import { useEffect, useState } from 'react';
import type { SourceSnapshot } from '../shared/connectors';
import { api, post, message } from './api';
import { Busy } from './ui';
export function ConnectorSources({projectId,refreshKey=0}:{projectId:string;refreshKey?:number}) {
  const path=`/api/projects/${projectId}/sources`;
  const [sources,setSources]=useState<SourceSnapshot[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>setSources((await api<{sources:SourceSnapshot[]}>(path)).sources);
  useEffect(()=>{let active=true;api<{sources:SourceSnapshot[]}>(path).then(r=>{if(active)setSources(r.sources);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[path,refreshKey]);
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await load();}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <section aria-label="Source snapshots"><h4>Source snapshots</h4><p>Snapshots are private, dated copies. Refresh creates a new copy; it does not change approved brief content. Only sources selected for an AI run are sent to that provider.</p>
    {notice&&<p role="status">{notice}</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
    <button className="button" disabled={busy} onClick={()=>void run(load)}>Reload sources</button>
    <div className="connector-list">{sources.map(source=><article key={source.id}>
      <h4>{source.remoteIdentity}</h4><p>{source.status} · {source.mimeType} · {source.bytes.toLocaleString()} bytes</p>
      <p>Fetched {new Date(source.fetchedAt).toLocaleString()}</p><details><summary>Source provenance</summary><p>{source.remoteVersion}</p><p>SHA-256: {source.contentHash}</p></details>
      <div className="connector-actions"><a className="button" href={`${path}/${source.id}`} download>Download snapshot</a>
        {source.mimeType.startsWith('image/')&&<button className="button" disabled={busy||source.status==='disconnected'} onClick={()=>void run(async()=>{await post(`${path}/${source.id}/asset`,{});setNotice('Image copied into project assets. Choose it from the editor asset library; your design was not changed.');})}>Copy image to project assets</button>}
        <button className="button" disabled={busy||source.status==='disconnected'} onClick={()=>void run(async()=>{await post(`${path}/${source.id}/refresh`);})}>Import latest copy</button>
        <button className="button" disabled={busy} onClick={()=>void run(async()=>{await api(`${path}/${source.id}`,{method:'DELETE'});})}>Remove snapshot</button>
      </div>
    </article>)}</div>{busy&&<Busy label="Updating sources…"/>}
  </section>;
}
