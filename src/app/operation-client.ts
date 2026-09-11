import {api} from './api';
import type {OperationJob,OperationJobRequest} from '../shared/operation-jobs';
const pending=new Map<string,OperationJobRequest>();
export function operationPath(projectId:string,id:string){return `/api/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(id)}`;}
export function pendingOperation(projectId:string){try{return localStorage.getItem(`studio-operation:${projectId}`);}catch{return null;}}
function rememberOperation(projectId:string,id:string){try{localStorage.setItem(`studio-operation:${projectId}`,id);window.dispatchEvent(new Event('studio-operation'));}catch{/* Private browsing can disable storage. */}}
export async function startOperation(projectId:string,request:OperationJobRequest){rememberOperation(projectId,request.operationId);return api<{operation:OperationJob}>(`/api/projects/${projectId}/operations`,{method:'POST',body:JSON.stringify(request)});}
export async function waitOperation(projectId:string,id:string,progress?:(job:OperationJob)=>void){
 const deadline=Date.now()+20*60000;
 while(Date.now()<deadline){const {operation}=await api<{operation:OperationJob}>(`/api/projects/${projectId}/operations/${id}`);progress?.(operation);if(operation.status==='failed')throw new Error(`${operation.error?.message??'Operation failed'} (operation ${id})`);if(operation.status==='succeeded'){const response=await fetch(operation.resultUrl!,{credentials:'same-origin'});if(!response.ok)throw new Error(`Result unavailable for operation ${id}`);return response;}await new Promise(resolve=>setTimeout(resolve,1000));}
 throw new Error(`Operation ${id} is still pending. Check its status before starting another operation.`);
}
export async function runOperation(projectId:string,request:OperationJobRequest,progress?:(job:OperationJob)=>void){
 const previous=pending.get(projectId);if(previous&&previous.kind===request.kind&&JSON.stringify(previous.input)===JSON.stringify(request.input))request=previous;
 pending.set(projectId,request);
 try{await startOperation(projectId,request);}catch(e){throw new Error(`Could not confirm submission of operation ${request.operationId}. Read its status or retry the same ID and payload. ${e instanceof Error?e.message:''}`);}
 try{const response=await waitOperation(projectId,request.operationId,progress);pending.delete(projectId);return response;}catch(e){throw new Error(`Operation ${request.operationId}: ${e instanceof Error?e.message:'Status unavailable'}. Use Operations to recover.`);}
}
