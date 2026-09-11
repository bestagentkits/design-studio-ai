import { ConnectionBindingEditor } from './connection-binding-editor';
import { GithubSourceSelection } from './github-source-selection';
import { GoogleDrivePicker } from './google-drive-picker';
import { ConnectorGrants } from './connector-grants';
import { ConnectorSources } from './connector-sources';
import { useEffect, useState } from 'react';
import { api, post, message, uid } from './api';
import { Modal, Busy, Field } from './ui';
import type { ConnectionMetadata, ProjectConnectionBinding, ConnectorTool } from '../shared/connectors';
import type { ConnectorOperation } from '../shared/connector-operations';
import { ConnectorOperationDialog } from './connector-operation-dialog';
import './connectors.css';

type Catalog={tools:(ConnectorTool&{schemaSupported:boolean})[];resources:{uri:string;name:string}[];versions:ConnectorOperation['versions']};
export function ProjectConnections({projectId,onClose}:{projectId:string;onClose:()=>void}) {
  const base=`/api/projects/${projectId}`;
  const [sourceRevision,setSourceRevision]=useState(0);
  const [connections,setConnections]=useState<ConnectionMetadata[]>([]),[bindings,setBindings]=useState<ProjectConnectionBinding[]>([]);
  const [catalog,setCatalog]=useState<Catalog|null>(null),[connectionId,setConnectionId]=useState('');
  const [tools,setTools]=useState<string[]>([]),[resources,setResources]=useState<string[]>([]);
  const [activeBinding,setActiveBinding]=useState<ProjectConnectionBinding|null>(null),[action,setAction]=useState(''),[args,setArgs]=useState('{}');
  const [operations,setOperations]=useState<ConnectorOperation[]>([]),[operationId,setOperationId]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{
    const [c,b,o]=await Promise.all([api<{connections:ConnectionMetadata[]}>('/api/connections'),api<{connections:ProjectConnectionBinding[]}>(`${base}/connections`),api<{operations:ConnectorOperation[]}>(`${base}/connector-operations`)]);
    setConnections(c.connections);setBindings(b.connections);setOperations(o.operations);setSourceRevision(value=>value+1);
  };
  useEffect(()=>{let active=true;Promise.all([api<{connections:ConnectionMetadata[]}>('/api/connections'),api<{connections:ProjectConnectionBinding[]}>(`${base}/connections`),api<{operations:ConnectorOperation[]}>(`${base}/connector-operations`)]).then(([c,b,o])=>{if(active){setConnections(c.connections);setBindings(b.connections);setOperations(o.operations);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[base]);
  async function run(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();await load();}catch(e){setError(message(e));}finally{setBusy(false);}}
  const toggle=(value:string,values:string[],set:(values:string[])=>void)=>set(values.includes(value)?values.filter(x=>x!==value):[...values,value]);
  return <><Modal title="Project tools and sources" onClose={onClose} wide><section className="connector-panel">
    <p>Choose the external data and actions available to this project. Agent access requires a separate explicit grant.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="connector-list">{bindings.map(binding=><article key={binding.id}>
      <h4>{connections.find(c=>c.id===binding.connectionId)?.displayName??binding.connectionId}</h4><p>{binding.role} · policy revision {binding.policyRevision}</p>
      {binding.selection.adapter==='mcp'&&<p>{[...binding.selection.tools,...binding.selection.resources].join(', ')||'No capabilities selected'}</p>}
      <div className="connector-actions"><button className="button" disabled={busy} onClick={()=>void run(async()=>{
        const result=await post<Catalog>(`${base}/connections/${binding.id}/capabilities`);setCatalog(result);setActiveBinding(binding);setAction('');
      })}>Inspect capabilities</button><button className="button" disabled={busy} onClick={()=>void run(async()=>{
        await api(`${base}/connections/${binding.id}`,{method:'DELETE',body:JSON.stringify({expectedPolicyRevision:binding.policyRevision})});setActiveBinding(null);setCatalog(null);
      })}>Remove binding and sources</button></div>
      <ConnectionBindingEditor key={`${binding.id}:${binding.policyRevision}`} binding={binding} onSaved={async()=>{setActiveBinding(null);setCatalog(null);await load();}}/>
      <ConnectorGrants key={`grants:${binding.id}:${binding.policyRevision}`} binding={binding}/>
    </article>)}</div>
    <Field label="Add a connected server"><select value={connectionId} onChange={e=>{setConnectionId(e.target.value);setCatalog(null);setActiveBinding(null);}}><option value="">Choose a connection</option>{connections.filter(c=>c.status==='connected'&&c.config.adapter==='mcp').map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></Field>
    <button className="button" disabled={busy||!connectionId} onClick={()=>void run(async()=>{setCatalog(await post<Catalog>(`/api/connections/${connectionId}/capabilities`));setActiveBinding(null);setTools([]);setResources([]);})}>Discover available capabilities</button>
    {catalog&&!activeBinding&&<>
      <h4>Choose tools</h4><p>Every custom MCP tool requires review before execution, including tools advertised as read-only by the server.</p>
      <div className="connector-choices">{catalog.tools.map(tool=><label key={tool.remoteName}><input type="checkbox" checked={tools.includes(tool.remoteName)} disabled={!tool.schemaSupported||busy} onChange={()=>toggle(tool.remoteName,tools,setTools)}/><span>{tool.remoteName}<small>{tool.schemaSupported?tool.description:'Unsupported input schema'}</small></span></label>)}</div>
      <div className="connector-choices">{catalog.resources.map(resource=><label key={resource.uri}><input type="checkbox" checked={resources.includes(resource.uri)} disabled={busy} onChange={()=>toggle(resource.uri,resources,setResources)}/><span>{resource.name}<small>{resource.uri}</small></span></label>)}</div>
      <button className="button primary" disabled={busy||(!tools.length&&!resources.length)} onClick={()=>void run(async()=>{
        if(tools.length){await post(`${base}/connections`,{connectionId,role:'tool',selection:{adapter:'mcp',tools,resources:[]}});setTools([]);}
        if(resources.length){await post(`${base}/connections`,{connectionId,role:'source',selection:{adapter:'mcp',tools:[],resources}});setResources([]);}
        setCatalog(null);setNotice('Selection saved. These capabilities are available to you; agents still need an explicit grant.');
      })}>Enable selected capabilities</button>
    </>}
    {catalog&&activeBinding&&<>
      {(activeBinding.role==='tool'||activeBinding.role==='destination')&&<form className="connector-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
        const result=await post<{operation:ConnectorOperation}>(`${base}/connector-operations`,{bindingId:activeBinding.id,action,arguments:JSON.parse(args),idempotencyKey:uid(),expectedVersions:catalog.versions});setOperationId(result.operation.id);
      });}}>
        <Field label="Tool"><select value={action} onChange={e=>{setAction(e.target.value);setArgs(JSON.stringify(activeBinding.selection.adapter==='google-drive'?e.target.value==='upload_drive_export'?{filename:'design.pdf',format:'pdf',folderId:activeBinding.selection.destinationFolderId}:{title:'Design presentation',folderId:activeBinding.selection.destinationFolderId}:activeBinding.selection.adapter==='github'?{baseBranch:'main',directory:activeBinding.selection.paths[0],title:'Update React design'}:{},null,2));}} required><option value="">Choose tool</option>{catalog.tools.filter(t=>t.schemaSupported).map(t=><option key={t.remoteName} value={t.remoteName}>{t.remoteName}</option>)}</select></Field>
        {action&&<details><summary>Arguments schema</summary><pre>{JSON.stringify(catalog.tools.find(t=>t.remoteName===action)?.inputSchema,null,2)}</pre></details>}
        <Field label="Arguments (JSON)"><textarea rows={5} value={args} onChange={e=>setArgs(e.target.value)} required/></Field>
        <button className="button primary" disabled={busy||!action}>Prepare for review</button>
      </form>}
      {activeBinding.role==='source'&&<div className="connector-list">{catalog.resources.map(resource=><article key={resource.uri}><h4>{resource.name}</h4><p>{resource.uri}</p><button className="button" disabled={busy} onClick={()=>void run(async()=>{await post(`${base}/connections/${activeBinding.id}/sources`,activeBinding.selection.adapter==='google-drive'?{fileId:resource.uri}:activeBinding.selection.adapter==='github'?{path:resource.uri}:{uri:resource.uri});setNotice('Immutable source snapshot imported. Your brief and document were not changed.');})}>Import snapshot</button></article>)}</div>}
    </>}
    {connections.filter(connection=>connection.status==='connected'&&connection.config.adapter==='google-drive').map(connection=><section key={connection.id}><h4>{connection.displayName} · {connection.remoteIdentity}</h4><GoogleDrivePicker connectionId={connection.id} onSelect={async ids=>{
      const created=await post<{binding:ProjectConnectionBinding}>(`${base}/connections`,{connectionId:connection.id,role:'source',selection:{adapter:'google-drive',fileIds:ids}});
      let imported=0;const failures:string[]=[];
      for(const fileId of ids){try{await post(`${base}/connections/${created.binding.id}/sources`,{fileId});imported++;}catch(error){failures.push(`${fileId}: ${message(error)}`);}}
      await load();setNotice(`${imported} of ${ids.length} selected Drive sources imported as immutable copies.`);
      if(failures.length)setError(failures.join(' · '));
    }}/><GoogleDrivePicker connectionId={connection.id} folders onSelect={async ids=>{
      await post(`${base}/connections`,{connectionId:connection.id,role:'destination',selection:{adapter:'google-drive',fileIds:[],destinationFolderId:ids[0]}});
      await load();setNotice('Drive destination selected. Inspect its capabilities to prepare an export for review.');
    }}/></section>)}
    {connections.filter(connection=>connection.status==='connected'&&connection.config.adapter==='github').map(connection=><GithubSourceSelection key={connection.id} projectId={projectId} connection={connection} onSaved={load}/>)}
    <ConnectorSources projectId={projectId} refreshKey={sourceRevision}/>
    <h4>Recent actions</h4><div className="connector-list">{operations.map(operation=><article key={operation.id}><strong>{operation.action}</strong><p>{operation.status.replaceAll('_',' ')}</p><button className="button" onClick={()=>setOperationId(operation.id)}>Inspect action</button></article>)}</div>
    {busy&&<Busy label="Updating project connections…"/>}
  </section></Modal>{operationId&&<ConnectorOperationDialog projectId={projectId} operationId={operationId} onClose={()=>{setOperationId('');void load().catch(e=>setError(message(e)));}}/>}</>;
}
