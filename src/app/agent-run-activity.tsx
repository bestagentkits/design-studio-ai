import { useEffect, useState } from 'react';
import type { AgentRun } from '../shared/agent-runs';
import type { DesignDocument } from '../shared/schema';
import type { ProjectConnectionBinding, SourceSnapshot } from '../shared/connectors';
import { api, post, message, uid } from './api';
import { Busy } from './ui';
import { ConnectorOperationDialog } from './connector-operation-dialog';
import './connectors.css';
type Detail={run:AgentRun;steps:{id:string;sequence:number;kind:string;status:string}[];proposal:DesignDocument|null;usage:unknown[];errorCode:string|null;payloadAvailable:boolean};
interface Props {projectId:string;documentRevision:number;briefRevision:number;prompt:string;provider:string;model:string;disabled:boolean;onProposal:(document:DesignDocument,run:AgentRun)=>Promise<void>;onStarted:()=>void}
export function AgentRunActivity(props:Props){
  const base=`/api/projects/${props.projectId}`,path=`${base}/runs`;
  const [bindings,setBindings]=useState<ProjectConnectionBinding[]>([]),[sources,setSources]=useState<SourceSnapshot[]>([]),[runs,setRuns]=useState<AgentRun[]>([]);
  const [bindingIds,setBindingIds]=useState<string[]>([]),[sourceIds,setSourceIds]=useState<string[]>([]);
  const [detail,setDetail]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[operationId,setOperationId]=useState('');
  const inspect=async(id:string)=>setDetail(await api<Detail>(`${path}/${id}`));
  const load=async()=>{
    const [b,s,r]=await Promise.all([api<{connections:ProjectConnectionBinding[]}>(`${base}/connections`),api<{sources:SourceSnapshot[]}>(`${base}/sources`),api<{runs:AgentRun[]}>(path)]);
    setBindings(b.connections);setSources(s.sources);setRuns(r.runs);
  };
  useEffect(()=>{let active=true;Promise.all([api<{connections:ProjectConnectionBinding[]}>(`${base}/connections`),api<{sources:SourceSnapshot[]}>(`${base}/sources`),api<{runs:AgentRun[]}>(path)]).then(([b,s,r])=>{if(active){setBindings(b.connections);setSources(s.sources);setRuns(r.runs);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[base,path]);
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await load();}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <details className="connector-panel"><summary>Use project tools in this conversation</summary>
    <p>Select tools and source copies for a bounded run. Only selected content goes to {props.provider}. Each external action requires review. Provider usage may incur charges.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <button className="button small" disabled={busy} onClick={()=>void run(load)}>Refresh available connections</button>
    <div className="connector-choices">{bindings.map(binding=><label key={binding.id}><input type="checkbox" checked={bindingIds.includes(binding.id)} onChange={()=>setBindingIds(ids=>ids.includes(binding.id)?ids.filter(id=>id!==binding.id):[...ids,binding.id])}/><span>{binding.role}: {binding.selection.adapter==='mcp'?[...binding.selection.tools,...binding.selection.resources].join(', '):binding.connectionId}</span></label>)}</div>
    <div className="connector-choices">{sources.filter(s=>s.status==='available'&&s.bindingId&&bindingIds.includes(s.bindingId)).map(source=><label key={source.id}><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={()=>setSourceIds(ids=>ids.includes(source.id)?ids.filter(id=>id!==source.id):[...ids,source.id])}/><span>{source.remoteIdentity}<small>{new Date(source.fetchedAt).toLocaleString()}</small></span></label>)}</div>
    <button className="button primary" disabled={busy||props.disabled||!props.prompt.trim()||!bindingIds.length} onClick={()=>void run(async()=>{
      const result=await post<{run:AgentRun}>(path,{prompt:props.prompt,provider:props.provider,...(props.model?{model:props.model}:{}),bindingIds,sourceSnapshotIds:sourceIds.filter(id=>sources.some(s=>s.id===id&&s.bindingId&&bindingIds.includes(s.bindingId))),expectedDocumentRevision:props.documentRevision,expectedBriefRevision:props.briefRevision,idempotencyKey:uid()});
      props.onStarted();await inspect(result.run.id);
    })}>Start tool-assisted proposal</button>
    {props.disabled&&<p>Save your current edits and approve the brief before starting a run.</p>}
    {runs.length>0&&<label>Saved runs<select aria-label="Saved tool runs" value={detail?.run.id??''} onChange={e=>{if(e.target.value)void run(()=>inspect(e.target.value));}}><option value="">Choose a run</option>{runs.map(r=><option value={r.id} key={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.status.replaceAll('_',' ')}</option>)}</select></label>}
    {detail&&<section aria-label="Tool run activity">
      <p role="status">{detail.run.status.replaceAll('_',' ')} · {detail.run.modelTurns}/8 model turns · {detail.run.toolCalls}/12 tool calls</p>
      <ol>{detail.steps.map(step=><li key={step.id}>{step.kind} · {step.status.replaceAll('_',' ')}</li>)}</ol>
      {detail.errorCode&&<p>{detail.errorCode==='input_required'?'The external server needs human input. Open the action to inspect its request. This run is paused and will not replay the tool.':detail.errorCode}</p>}
      {detail.run.status==='outcome_unknown'&&<p>A request may have completed without a saved response. Inspect the remote service before starting another run. This run will not retry it.</p>}
      <div className="connector-actions">
        {['ready_to_continue','awaiting_approval'].includes(detail.run.status)&&<button className="button" disabled={busy} onClick={()=>void run(async()=>{await post(`${path}/${detail.run.id}/advance`,{expectedRevision:detail.run.revision});await inspect(detail.run.id);})}>Continue one step</button>}
        {detail.run.pendingOperationId&&<button className="button" onClick={()=>setOperationId(detail.run.pendingOperationId!)}>Review external action</button>}
        <button className="button" disabled={busy} onClick={()=>void run(()=>inspect(detail.run.id))}>Reload run</button>
        {['ready_to_continue','awaiting_approval','running','needs_reauthorization'].includes(detail.run.status)&&<button className="button" disabled={busy} onClick={()=>void run(async()=>{await post(`${path}/${detail.run.id}/cancel`,{expectedRevision:detail.run.revision});await inspect(detail.run.id);})}>Cancel run</button>}
        {detail.proposal&&<button className="button primary" disabled={busy||props.disabled} onClick={()=>void run(()=>props.onProposal(detail.proposal!,detail.run))}>Preview proposal</button>}
      </div>
      <details><summary>Reported usage</summary><p>Provider-reported usage; monetary cost is unknown.</p><pre>{JSON.stringify(detail.usage,null,2)}</pre></details>
    </section>}
    {busy&&<Busy label="Processing one run step…"/>}
    {operationId&&<ConnectorOperationDialog projectId={props.projectId} operationId={operationId} onClose={()=>{setOperationId('');if(detail)void run(()=>inspect(detail.run.id));}}/>}
  </details>;
}
