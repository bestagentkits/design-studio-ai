import { useState } from 'react';
import { api,post,message } from './api';
import { Field } from './ui';
import type { ConnectionMetadata,ProjectConnectionBinding } from '../shared/connectors';
export function GithubSourceSelection({projectId,connection,onSaved}:{projectId:string;connection:ConnectionMetadata;onSaved:()=>Promise<void>}){
  const [repositoryId,setRepositoryId]=useState(''),[commit,setCommit]=useState(''),[paths,setPaths]=useState('README.md');
  const [repositories,setRepositories]=useState<{repositoryId:string;name:string;defaultBranch:string}[]>([]),[nextPage,setNextPage]=useState<number|null>(1),[ref,setRef]=useState('main');
  const [role,setRole]=useState<'source'|'destination'>('source');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  return <details><summary>{connection.displayName}: select repository access</summary><form className="connector-form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const selected=[...new Set(paths.split('\n').map(path=>path.trim()).filter(Boolean))];
      const {binding}=await post<{binding:ProjectConnectionBinding}>(`/api/projects/${projectId}/connections`,{connectionId:connection.id,role,selection:{adapter:'github',repositoryId,commit,paths:selected}});
      if(role==='destination'){await onSaved();setNotice('Destination saved. Inspect its capabilities to choose the base branch and review a React export.');return;}
      let imported=0;const failures:string[]=[];
      for(const path of selected){try{await post(`/api/projects/${projectId}/connections/${binding.id}/sources`,{path});imported++;}catch(error){failures.push(`${path}: ${message(error)}`);}}
      await onSaved();setNotice(`${imported} of ${selected.length} files imported at commit ${commit}.`);setError(failures.join(' · '));
    }catch(error){setError(message(error));}finally{setBusy(false);}
  }}>
    <p>{connection.remoteIdentity}. Studio verifies that this GitHub account and App installation both have access. Sources stay pinned to the commit you choose.</p>
    <Field label="Use repository for"><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="source">Read selected source files</option><option value="destination">Export React pull requests</option></select></Field>
    <button type="button" className="button" disabled={busy||nextPage===null} onClick={async()=>{setBusy(true);setError('');try{const result=await api<{repositories:typeof repositories;nextPage:number|null}>(`/api/connectors/github/repositories?connectionId=${encodeURIComponent(connection.id)}&page=${nextPage}`);setRepositories(previous=>[...previous,...result.repositories]);setNextPage(result.nextPage);}catch(error){setError(message(error));}finally{setBusy(false);}}}>List accessible repositories</button>
    {repositories.length>0&&<Field label="Repository"><select value={repositoryId} onChange={e=>{setRepositoryId(e.target.value);setRef(repositories.find(repo=>repo.repositoryId===e.target.value)?.defaultBranch??'main');setCommit('');}}><option value="">Choose repository</option>{repositories.map(repo=><option key={repo.repositoryId} value={repo.repositoryId}>{repo.name}</option>)}</select></Field>}
    <Field label="Repository numeric ID"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={repositoryId} onChange={e=>setRepositoryId(e.target.value)}/></Field>
    <Field label="Branch or tag"><input value={ref} maxLength={200} onChange={e=>{setRef(e.target.value);setCommit('');}}/></Field>
    <button type="button" className="button" disabled={busy||!repositoryId||!ref} onClick={async()=>{setBusy(true);setError('');try{const result=await post<{commit:string}>('/api/connectors/github/resolve',{connectionId:connection.id,repositoryId,ref});setCommit(result.commit);}catch(error){setError(message(error));}finally{setBusy(false);}}}>Resolve to immutable commit</button>
    <Field label="Full commit SHA"><input required pattern="[a-f0-9]{40}" minLength={40} maxLength={40} value={commit} onChange={e=>setCommit(e.target.value.toLowerCase())}/></Field>
    <Field label={role==='source'?'File paths (one per line)':'Allowed export directories (one per line)'}><textarea required rows={4} value={paths} onChange={e=>setPaths(e.target.value)}/></Field>
    <p>{role==='source'?'Choose explicit UTF-8 files. Secret files, symlinks and submodules are not imported.':'The GitHub App needs contents and pull request write permission. Studio creates a new branch and PR only after you approve the exact export.'}</p>
    {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <button className="button primary" disabled={busy}>{busy?'Saving selection…':role==='source'?'Select and import sources':'Save export destination'}</button>
  </form></details>;
}
