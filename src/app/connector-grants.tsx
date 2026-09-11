import { useEffect, useState } from 'react';
import type { ProjectConnectionBinding } from '../shared/connectors';
import { api, post, message } from './api';
import { Field, Busy } from './ui';
type Grant={id:string;kind:string;principalId:string;capabilities:string[];policyRevision:number;expiresAt:number;revokedAt:string|null};
export function ConnectorGrants({binding}:{binding:ProjectConnectionBinding}) {
  const path=`/api/projects/${binding.projectId}/connections/${binding.id}/grants`;
  const [grants,setGrants]=useState<Grant[]>([]),[tokens,setTokens]=useState<{id:string;name:string}[]>([]);
  const [oauth,setOauth]=useState<{clientId:string;familyId:string;name:string}[]>([]);
  const [recipient,setRecipient]=useState('webmcp'),[days,setDays]=useState(7),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [capabilities,setCapabilities]=useState<string[]>(['discover']);
  const allowed=binding.role==='source'?['discover','read_source','run']:binding.role==='destination'?['discover','prepare_write','run']:['discover','execute_read','prepare_write','run'];
  const load=async()=>setGrants((await api<{grants:Grant[]}>(path)).grants);
  useEffect(()=>{let active=true;Promise.all([api<{grants:Grant[]}>(path),api<{tokens:{id:string;name:string}[]}>('/api/tokens'),api<{oauth:typeof oauth}>('/api/connections/agent-recipients')]).then(([g,t,o])=>{if(active){setGrants(g.grants);setTokens(t.tokens);setOauth(o.oauth);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[path]);
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await load();}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <details><summary>Agent access</summary><p>Grants are limited to this binding’s selected capabilities. Preparing a write never permits the agent to approve it.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <form className="connector-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await post(path,{recipient:recipient==='webmcp'?{kind:'webmcp'}:recipient.startsWith('oauth:')?{kind:'oauth',clientId:oauth.find(item=>`oauth:${item.familyId}`===recipient)?.clientId,familyId:recipient.slice(6)}:{kind:'api',tokenId:recipient},expectedPolicyRevision:binding.policyRevision,capabilities,selection:binding.selection,expiresAt:new Date(Date.now()+days*86400000-1000).toISOString()});});}}>
      <Field label="Agent identity"><select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="webmcp">Browser agent (WebMCP)</option>{oauth.map(item=><option value={`oauth:${item.familyId}`} key={item.familyId}>{item.name} (OAuth · {item.familyId.slice(0,8)})</option>)}{tokens.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Expires in days"><input type="number" min={1} max={90} value={days} onChange={e=>setDays(Number(e.target.value))} required/></Field>
      <div className="connector-choices">{allowed.map(capability=><label key={capability}><input type="checkbox" checked={capabilities.includes(capability)} onChange={()=>setCapabilities(current=>current.includes(capability)?current.filter(c=>c!==capability):[...current,capability])}/>{capability.replaceAll('_',' ')}</label>)}</div>
      <button className="button" disabled={busy||!capabilities.length}>Grant selected access</button>
    </form>
    <div className="connector-list">{grants.map(grant=><article key={grant.id}><strong>{grant.kind} · {grant.principalId}</strong><p>{grant.capabilities.join(', ')}</p><p>{grant.revokedAt?'Revoked':grant.expiresAt<=Date.now()?'Expired':`Expires ${new Date(grant.expiresAt).toLocaleString()}`}</p>
      {grant.kind==='webmcp'&&!grant.revokedAt&&<p>Browser grant ID: <code>{grant.id}</code></p>}
      {!grant.revokedAt&&<button className="button" disabled={busy} onClick={()=>void run(async()=>{await api(`${path}/${grant.id}`,{method:'DELETE'});})}>Revoke grant</button>}
    </article>)}</div>{busy&&<Busy label="Updating agent access…"/>}
  </details>;
}
