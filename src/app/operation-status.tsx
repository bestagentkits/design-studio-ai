import {Modal} from './ui';
import {ListChecks} from 'lucide-react';
import {useEffect,useState} from 'react';
import {api} from './api';
import {operationPath,pendingOperation} from './operation-client';
import type {OperationJob} from '../shared/operation-jobs';
export function OperationStatus({projectId}:{projectId:string}){
 const [open,setOpen]=useState(false);
 const [id,setId]=useState(pendingOperation(projectId)??''),[job,setJob]=useState<OperationJob|null>(null),[error,setError]=useState('');
 useEffect(()=>{const update=()=>setId(pendingOperation(projectId)??'');window.addEventListener('studio-operation',update);update();return()=>window.removeEventListener('studio-operation',update);},[projectId]);
 const check=async()=>{try{const data=await api<{operation:OperationJob}>(operationPath(projectId,id));setJob(data.operation);setError('');}catch(e){setError((e as Error).message);}};
 return <><button className="button small operations-button" aria-label="Operations" title="Operations" onClick={()=>setOpen(true)}><ListChecks size={16}/><span>Operations</span></button>{open&&<Modal title="Operations" onClose={()=>setOpen(false)}><div className="modal-body"><label>Operation ID<input value={id} onChange={e=>{setId(e.target.value);setJob(null);}}/></label><button disabled={!id} onClick={check}>Check saved operation</button>{job&&<p>{job.kind}: {job.status} · {job.stage}{job.revision?` · revision ${job.revision}`:''}{job.error?.message}</p>}{job?.resultUrl&&<a href={job.resultUrl} download>Download result / save receipt</a>}{error&&<p role="alert">{error}</p>}<p>A disconnected client does not cancel a queued job. Check the receipt before reloading or saving again.</p></div></Modal>}</>;
}
