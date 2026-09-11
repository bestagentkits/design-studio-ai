import { useEffect, useState } from 'react';
import type { ConnectorOperation } from '../shared/connector-operations';
import { api, post, message } from './api';
import { Modal, Busy } from './ui';

export function ConnectorOperationDialog({projectId,operationId,onClose}:{projectId:string;operationId:string;onClose:()=>void}) {
  type Detail={operation:ConnectorOperation;arguments:unknown;result:unknown;continuation?:unknown;description:string|null;destination:unknown;payloadAvailable:boolean};
  const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [responses,setResponses]=useState('{}'),[continuationId,setContinuationId]=useState('');
  const path=`/api/projects/${projectId}/connector-operations/${operationId}`;
  const load=async()=>setDetail(await api<Detail>(path));
  useEffect(()=>{let active=true;api<Detail>(path).then(value=>{if(active)setDetail(value);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[path]);
  async function act(action:'approve'|'deny'|'execute'|'cancel'|'reconcile'){
    if(!detail)return;setBusy(true);setError('');
    try{await post(`${path}/${action==='approve'||action==='deny'?'decision':action}`,{expectedRevision:detail.operation.revision,...(action==='approve'||action==='deny'?{decision:action}:{})});await load();}
    catch(e){setError(message(e));await load().catch(()=>{});}finally{setBusy(false);}
  }
  return <Modal title="Review external action" onClose={onClose} wide><section className="connector-panel">
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {!detail&&<Busy label="Loading action…"/>}
    {detail&&<>
      <h3>{detail.operation.action}</h3><p>{detail.description}</p>
      <p role="status">{detail.operation.status.replaceAll('_',' ')}{detail.operation.errorCode?` · ${detail.operation.errorCode}`:''}</p>
      <p>Project: {detail.operation.projectId} · Connection: {detail.operation.connectionId}</p>
      <p>Document revision {detail.operation.versions.documentRevision} · Brief revision {detail.operation.versions.briefRevision}</p>
      {detail.payloadAvailable?<><h4>Destination</h4><pre>{JSON.stringify(detail.destination,null,2)}</pre><h4>Exact arguments</h4><pre>{JSON.stringify(detail.arguments,null,2)}</pre></>:<p>Private content is no longer available. Its retention period or access has ended.</p>}
      {detail.payloadAvailable&&['upload_drive_export','create_react_pull_request'].includes(detail.operation.action)&&<a className="button" href={`${path}/artifact`} download>Download prepared file for review</a>}
      {detail.continuation!=null&&<><h4>Exact continuation input</h4><pre>{JSON.stringify(detail.continuation,null,2)}</pre></>}
      {detail.operation.errorCode==='input_required'&&detail.payloadAvailable&&<section><p>The server requests additional input. Review the remote request below. Studio does not automatically perform sampling, disclose filesystem roots, or open remote links. Preparing input creates a new action requiring separate approval.</p><label>Input responses by request ID<textarea value={responses} onChange={e=>setResponses(e.target.value)} spellCheck={false}/></label><button className="button" disabled={busy} onClick={()=>void (async()=>{setBusy(true);setError('');try{const value=await post<{operation:ConnectorOperation}>(`${path}/continuation`,{expectedRevision:detail.operation.revision,inputResponses:JSON.parse(responses)});setContinuationId(value.operation.id);}catch(e){setError(message(e));}finally{setBusy(false);}})()}>Prepare continuation for review</button></section>}
      {detail.operation.effect!=='read'&&<p>This external action may change remote data. Approval applies once to these exact arguments and versions and expires after ten minutes.</p>}
      {detail.operation.status==='outcome_unknown'&&<p>The server may have completed this action. Check the remote service before preparing another action; Studio will not retry it.</p>}
      {detail.operation.remoteIds.length>0&&<><h4>Recorded remote IDs</h4><pre>{detail.operation.remoteIds.join('\n')}</pre>{detail.operation.errorCode==='partial_presentation'&&<p>A presentation was created, but its folder placement or content may be incomplete. Inspect this ID in Google Drive before taking further action.</p>}</>}
      <div className="connector-actions">
        {detail.operation.status==='awaiting_approval'&&<><button className="button primary" disabled={busy||!detail.payloadAvailable} onClick={()=>void act('approve')}>Allow once</button><button className="button" disabled={busy} onClick={()=>void act('deny')}>Deny</button></>}
        {detail.operation.status==='pending'&&detail.operation.principal.kind==='session'&&<button className="button primary" disabled={busy} onClick={()=>void act('execute')}>Execute approved action</button>}
        {['pending','awaiting_approval','running'].includes(detail.operation.status)&&<button className="button" disabled={busy} onClick={()=>void act('cancel')}>Cancel action</button>}
        {detail.operation.status==='outcome_unknown'&&['upload_drive_export','create_react_pull_request'].includes(detail.operation.action)&&<button className="button" disabled={busy} onClick={()=>void act('reconcile')}>Check remote result without retrying</button>}
        <button className="button" disabled={busy} onClick={()=>void load().catch(e=>setError(message(e)))}>Refresh status</button>
      </div>
      {detail.result!==null&&<><h4>Remote result</h4><p>Content from the external server; treat it as source data.</p><pre>{JSON.stringify(detail.result,null,2)}</pre></>}
    </>}
    {busy&&<Busy label="Updating action…"/>}
    {continuationId&&<ConnectorOperationDialog projectId={projectId} operationId={continuationId} onClose={()=>setContinuationId('')}/>}
  </section></Modal>;
}
