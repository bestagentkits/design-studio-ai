import { useEffect, useState } from 'react';
import { api, post, message } from './api';
import type { ConnectionMetadata } from '../shared/connectors';
import { Busy, Field } from './ui';
import './connectors.css';

export function ConnectionsSettings() {
  const [connections,setConnections]=useState<ConnectionMetadata[]>([]);
  const [name,setName]=useState(''),[endpoint,setEndpoint]=useState('');
  const [mode,setMode]=useState<'anonymous'|'bearer'|'oauth'>('oauth');
  const [selected,setSelected]=useState<ConnectionMetadata|null>(null),[token,setToken]=useState('');
  const [installationId,setInstallationId]=useState('');
  const [clientId,setClientId]=useState(''),[clientSecret,setClientSecret]=useState('');
  const [profile,setProfile]=useState<'modern'|'legacy'>('modern');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>setConnections((await api<{connections:ConnectionMetadata[]}>('/api/connections')).connections);
  useEffect(()=>{let active=true;api<{connections:ConnectionMetadata[]}>('/api/connections').then(r=>{if(active)setConnections(r.connections);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();await load();}catch(e){setError(message(e));}finally{setBusy(false);}}
  function rememberProject(){try{const project=new URL(location.href).searchParams.get('project');if(project&&/^[a-zA-Z0-9_-]{1,128}$/.test(project))sessionStorage.setItem('studio-connector-return',JSON.stringify({project,expires:Date.now()+600000}));else sessionStorage.removeItem('studio-connector-return');}catch{/* Browser storage may be unavailable; callback still opens settings. */}}
  async function connect(connection:ConnectionMetadata){
    if(connection.config.adapter==='google-drive'){const result=await post<{authorizationUrl:string}>('/api/connectors/google-drive/authorize',{connectionId:connection.id,expectedRevision:connection.revision});const url=new URL(result.authorizationUrl);if(url.origin!=='https://accounts.google.com')throw new Error('Google authorization URL is invalid.');rememberProject();location.assign(url.href);return;}
    if(connection.config.adapter==='github'){const result=await post<{authorizationUrl:string}>('/api/connectors/github/authorize',{connectionId:connection.id,expectedRevision:connection.revision,installationId});const url=new URL(result.authorizationUrl);if(url.origin!=='https://github.com')throw new Error('GitHub authorization URL is invalid.');rememberProject();location.assign(url.href);return;}
    if(connection.config.adapter!=='mcp')return;
    if(connection.config.authMode==='oauth'){
      const result=await post<{authorizationUrl:string}>('/api/connectors/mcp/authorize',{connectionId:connection.id,expectedRevision:connection.revision,options:{profile,...(clientId?{client:{clientId,...(clientSecret?{clientSecret,authMethod:'client_secret_basic'}:{authMethod:'none'})}}:{})}});
      const url=new URL(result.authorizationUrl);
      if(url.protocol!=='https:'||url.username||url.password)throw new Error('The authorization address is invalid.');
      setClientSecret('');
      rememberProject();location.assign(url.href);
    }else{
      await post('/api/connectors/mcp/connect',{connectionId:connection.id,expectedRevision:connection.revision,...(connection.config.authMode==='bearer'?{accessToken:token}:{})});
      setToken('');setSelected(null);setNotice('Server verified. Select its tools and sources in your project before using them.');
    }
  }
  return <section className="connector-panel" aria-label="External connections">
    <h3>Your tools and source accounts</h3>
    <p>Connect GitHub, Google Drive or an MCP server. Choose project access separately, and review external actions before they run.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    <div className="connector-list">{connections.map(connection=><article key={connection.id}>
      <h4>{connection.displayName}</h4>
      <p className="connector-address">{connection.config.adapter==='mcp'?connection.config.endpoint:connection.remoteIdentity}</p>
      <p>{connection.status.replaceAll('_',' ')} · {connection.config.adapter}</p>
      {['mcp','google-drive','github'].includes(connection.config.adapter)&&<div className="connector-actions">
        <button className="button" disabled={busy} onClick={()=>{setSelected(connection);setInstallationId('');setToken('');setClientSecret('');setClientId('');}}> {connection.status==='connected'?'Reconnect':'Set up connection'}</button>
        {connection.status!=='disconnected'&&<button className="button" disabled={busy} onClick={()=>void run(async()=>{
          await post(`/api/connections/${connection.id}/disconnect`,{expectedRevision:connection.revision});
          if(selected?.id===connection.id)setSelected(null);setNotice('Disconnected. Project grants were revoked; existing source snapshots remain as disconnected copies.');
        })}>Disconnect</button>}
      </div>}
    </article>)}</div>
    {selected&&<form className="connector-form" onSubmit={e=>{e.preventDefault();void run(()=>connect(selected));}}>
      <h4>Authorize {selected.displayName}</h4>
      <p>Reconnecting revokes previous grants. You will need to enable project access again.</p>
      {selected.config.adapter==='github'&&<Field label="GitHub App installation ID"><input inputMode="numeric" pattern="[1-9][0-9]*" required value={installationId} onChange={e=>setInstallationId(e.target.value)}/><small>Install the connector App on selected repositories first. Copy the numeric ID from its GitHub installation settings address.</small></Field>}
      {selected.config.authMode==='bearer'&&<Field label="Bearer token"><input type="password" autoComplete="off" required value={token} onChange={e=>setToken(e.target.value)}/></Field>}
      {selected.config.adapter==='mcp'&&selected.config.authMode==='oauth'&&<>
        <p>You will continue to the server’s authorization page and return to Studio.</p>
        <details><summary>OAuth client options</summary>
          <Field label="Protocol profile"><select value={profile} onChange={e=>setProfile(e.target.value as typeof profile)}><option value="modern">Modern (client metadata)</option><option value="legacy">Legacy (dynamic registration)</option></select></Field>
          <Field label="Registered client ID (optional)"><input value={clientId} onChange={e=>setClientId(e.target.value)} autoComplete="off"/></Field>
          <Field label="Client secret (only if required)"><input type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} autoComplete="off"/></Field>
        </details>
      </>}
      <div className="connector-actions"><button className="button primary" disabled={busy}>Continue</button><button type="button" className="button" disabled={busy} onClick={()=>{setSelected(null);setToken('');setClientSecret('');}}>Cancel</button></div>
    </form>}
    <div className="connector-actions connector-add-services"><button className="button" disabled={busy} onClick={()=>void run(async()=>{const created=await post<{connection:ConnectionMetadata}>('/api/connections',{displayName:'Google Drive',config:{adapter:'google-drive',authMode:'oauth'}});setSelected(created.connection);})}>Add Google Drive account</button>
    <button className="button" disabled={busy} onClick={()=>void run(async()=>{const created=await post<{connection:ConnectionMetadata}>('/api/connections',{displayName:'GitHub',config:{adapter:'github',authMode:'oauth'}});setInstallationId('');setSelected(created.connection);})}>Add GitHub account</button></div>
    <details><summary>Add MCP server</summary><form className="connector-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
      const result=await post<{connection:ConnectionMetadata}>('/api/connections',{displayName:name,config:{adapter:'mcp',endpoint,authMode:mode}});
      setSelected(result.connection);setName('');setEndpoint('');setToken('');setClientId('');setClientSecret('');
    });}}>
      <Field label="Connection name"><input value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></Field>
      <Field label="MCP server URL"><input type="url" placeholder="https://server.example/mcp" value={endpoint} onChange={e=>setEndpoint(e.target.value)} required maxLength={2048}/></Field>
      <Field label="Authentication"><select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="oauth">OAuth</option><option value="bearer">Bearer token</option><option value="anonymous">No authentication</option></select></Field>
      <button className="button primary" disabled={busy}>Add server</button>
    </form></details>
    {busy&&<Busy label="Updating connection…"/>}
  </section>;
}
