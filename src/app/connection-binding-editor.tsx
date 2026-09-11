import { useState } from 'react';
import type { ProjectConnectionBinding } from '../shared/connectors';
import { api,message } from './api';
import { Field } from './ui';
import { GoogleDrivePicker } from './google-drive-picker';
export function ConnectionBindingEditor({binding,onSaved}:{binding:ProjectConnectionBinding;onSaved:()=>Promise<void>}){
  const [selection,setSelection]=useState(binding.selection),[role,setRole]=useState(binding.role),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [toolText,setToolText]=useState(binding.selection.adapter==='mcp'?binding.selection.tools.join('\n'):''),[resourceText,setResourceText]=useState(binding.selection.adapter==='mcp'?binding.selection.resources.join('\n'):''),[pathText,setPathText]=useState(binding.selection.adapter==='github'?binding.selection.paths.join('\n'):'');
  const lines=(value:string)=>[...new Set(value.split('\n').map(item=>item.trim()).filter(Boolean))];
  return <details><summary>Edit project selection</summary><form className="connector-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api(`/api/projects/${binding.projectId}/connections/${binding.id}`,{method:'PUT',body:JSON.stringify({expectedPolicyRevision:binding.policyRevision,role,selection:selection.adapter==='mcp'?{...selection,tools:lines(toolText),resources:lines(resourceText)}:selection.adapter==='github'?{...selection,paths:lines(pathText)}:selection})});await onSaved();}catch(error){setError(message(error));}finally{setBusy(false);}}}>
    <p>Saving revokes existing agent grants and stops dependent work. Imported snapshots remain as disconnected copies. Grant access again after reviewing the new selection.</p>
    <Field label="Project access"><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="source">Source files</option><option value="tool">Tools</option><option value="destination">Export destination</option></select></Field>
    {selection.adapter==='mcp'&&<><Field label="Enabled tool names (one per line)"><textarea value={toolText} onChange={e=>setToolText(e.target.value)}/></Field><Field label="Selected resource URIs (one per line)"><textarea value={resourceText} onChange={e=>setResourceText(e.target.value)}/></Field></>}
    {selection.adapter==='github'&&<><Field label="Selected repository ID"><input value={selection.repositoryId} onChange={e=>setSelection({...selection,repositoryId:e.target.value})} required pattern="[1-9][0-9]*"/></Field><Field label="Pinned commit SHA"><input value={selection.commit} onChange={e=>setSelection({...selection,commit:e.target.value})} required pattern="[a-f0-9]{40}"/></Field><Field label={role==='destination'?'Allowed export directories':'Selected file paths'}><textarea value={pathText} onChange={e=>setPathText(e.target.value)} required/></Field></>}
    {selection.adapter==='google-drive'&&<><p>{selection.fileIds.length} files selected{selection.destinationFolderId?` · destination ${selection.destinationFolderId}`:''}</p><GoogleDrivePicker connectionId={binding.connectionId} folders={role==='destination'} onSelect={async ids=>setSelection(role==='destination'?{adapter:'google-drive',fileIds:[],destinationFolderId:ids[0]}:{adapter:'google-drive',fileIds:ids})}/></>}
    {error&&<p role="alert" className="inline-error">{error}</p>}<button className="button" disabled={busy}>Save selection and revoke old grants</button>
  </form></details>;
}
