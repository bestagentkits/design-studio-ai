import { extractSourcePdf } from './google-content';
import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { authorizeConnectorBinding,type ConnectorCapability } from '../connection-policy';
import { connectorBindingAuthority } from '../connector-binding-authority';
import { googleCredential } from './google-auth';
import { nativeJson,nativeRequest } from './native-transport';
import { importProjectSource } from '../project-sources';
import { limitedBytes } from '../providers';
import { fail } from '../security';
const fileId=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const metadataSchema=z.object({id:fileId,name:z.string().max(1024),mimeType:z.string().max(120),version:z.string().regex(/^\d+$/),size:z.string().regex(/^\d+$/).optional(),trashed:z.boolean().optional(),capabilities:z.object({canDownload:z.boolean().optional(),canAddChildren:z.boolean().optional()}).optional()});
export async function googleBindingAuthority(env:Bindings,principal:ConnectorPrincipal,bindingId:string,capability:ConnectorCapability,projectId:string,selectedFileId?:string){
  const initial=await authorizeConnectorBinding(env,principal,bindingId,capability);
  if(initial.binding.project_id!==projectId||initial.connection.adapter!=='google-drive')fail(403,'missing_grant','Select an authorized Google project binding.');
  if(selectedFileId&&(initial.selection.adapter!=='google-drive'||!initial.selection.fileIds.includes(selectedFileId)))fail(403,'missing_grant','This Drive file is not selected for this agent.');
  await googleCredential(env,principal.userId,initial.connection.id);
  return connectorBindingAuthority(env,principal,bindingId,capability,undefined,projectId,'google-drive');
}
export async function googleFileMetadata(env:Bindings,accessToken:string,id:string){
  const value=metadataSchema.parse(await nativeJson(env,`https://www.googleapis.com/drive/v3/files/${fileId.parse(id)}?fields=id,name,mimeType,version,size,trashed,capabilities&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${accessToken}`}}));
  if(value.id!==id||value.trashed)fail(409,'source_unavailable','The selected Drive file is unavailable.');
  return value;
}
export async function importGoogleSource(env:Bindings,principal:ConnectorPrincipal,projectId:string,bindingId:string,id:string){
  fileId.parse(id);
  const auth=await googleBindingAuthority(env,principal,bindingId,'read_source',projectId,id);
  if(auth.selection.adapter!=='google-drive'||!auth.selection.fileIds.includes(id))fail(403,'missing_grant','This Drive file is not selected for this agent.');
  const token=auth.credential!.accessToken,metadata=await googleFileMetadata(env,token,id);
  if(metadata.capabilities?.canDownload===false)fail(403,'source_unavailable','This file cannot be downloaded.');
  const docs=metadata.mimeType==='application/vnd.google-apps.document';
  const text=['text/plain','text/markdown','application/json'].includes(metadata.mimeType);
  const image=['image/png','image/jpeg','image/webp','image/gif'].includes(metadata.mimeType);
  const pdf=metadata.mimeType==='application/pdf';
  if(!docs&&!text&&!image&&!pdf)fail(422,'unsupported_content','Select Google Docs, UTF-8 text, Markdown, JSON, a text-based PDF or a supported image.');
  if(metadata.size&&Number(metadata.size)>20971520)fail(413,'limit_exceeded','Drive source exceeds 20 MiB.');
  await auth.recheck();
  const url=`https://www.googleapis.com/drive/v3/files/${id}`+(docs?'/export?mimeType=text%2Fplain':'?alt=media&supportsAllDrives=true');
  let bytes=new Uint8Array(await limitedBytes(await nativeRequest(env,url,{headers:{Authorization:`Bearer ${token}`}}),image?20971520:2097152));
  if(pdf)bytes=await extractSourcePdf(bytes);
  if(!image){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(422,'unsupported_content','This file is not valid UTF-8 text.');}}
  const after=await googleFileMetadata(env,token,id);
  if(after.version!==metadata.version)fail(409,'source_changed','The file changed during import. Select its latest version.');
  await auth.recheck();
  return importProjectSource(env,principal,projectId,bindingId,{selection:{adapter:'google-drive',fileIds:[id]},remoteIdentity:id,remoteVersion:metadata.version,mimeType:docs||pdf?'text/plain':metadata.mimeType,extractionVersion:pdf?'unpdf-text-v1':docs?'google-docs-text-v1':image?'image-bytes-v1':'utf8-v1',bytes},auth.guard);
}
