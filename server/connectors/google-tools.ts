import type { Context } from 'hono';
import type { Env } from '../types';
import { googleUploadArguments,stageGoogleExport,readExportArtifact } from './google-export-artifacts';
import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { connectorOperationPrepareSchema } from '../../src/shared/connector-operations';
import { connectorToolSchema } from '../../src/shared/connectors';
import { connectorFingerprint } from '../connector-fingerprints';
import { prepareConnectorOperation,claimConnectorOperation,finishConnectorOperation,markConnectorOperationUncertain } from '../connector-operations';
import { ownedOperation,inspectOperationVersions,operationClockSql } from '../connector-operation-versions';
import { googleBindingAuthority,googleFileMetadata } from './google-drive';
import { googleSlidesRequests } from '../google-slides-content';
import { documentSchema } from '../../src/shared/schema';
import { nativeJson } from './native-transport';
import { ApiError, fail } from '../security';
const argumentsSchema=z.strictObject({title:z.string().trim().min(1).max(200),folderId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)});
export async function googleSlidesTool(connectionId:string){
  const definition={remoteName:'create_google_slides',description:'Create a native Google Slides presentation from the exact saved design, then move it into the selected Drive folder. Unsupported nodes and private images are rejected. Partial results retain their presentation ID; never repeat an uncertain create.',inputSchema:z.toJSONSchema(argumentsSchema),effect:'write' as const};
  return connectorToolSchema.parse({...definition,connectionId,fingerprint:await connectorFingerprint(definition)});
}
export async function googleUploadTool(connectionId:string){
  const definition={remoteName:'upload_drive_export',description:'Upload the actual prepared PDF or PPTX bytes from the exact saved revision as a new file in the selected folder. Requires human approval; uncertain uploads retain a reserved file ID and are never replayed.',inputSchema:z.toJSONSchema(googleUploadArguments),effect:'write' as const};
  return connectorToolSchema.parse({...definition,connectionId,fingerprint:await connectorFingerprint(definition)});
}
async function content(env:Bindings,userId:string,projectId:string){
  const row=await env.DB.prepare('SELECT document FROM projects WHERE id=? AND user_id=?').bind(projectId,userId).first<{document:string}>();
  if(!row)fail(404,'not_found','Project not found.');
  return googleSlidesRequests(documentSchema.parse(JSON.parse(row.document)));
}
async function destination(env:Bindings,principal:ConnectorPrincipal,projectId:string,bindingId:string,args:unknown){
  const value=z.object({folderId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)}).parse(args),auth=await googleBindingAuthority(env,principal,bindingId,'prepare_write',projectId);
  if(auth.selection.adapter!=='google-drive'||auth.selection.destinationFolderId!==value.folderId)fail(403,'missing_grant','Choose the exact destination folder enabled for this binding.');
  const folder=await googleFileMetadata(env,auth.credential!.accessToken,value.folderId);
  if(folder.mimeType!=='application/vnd.google-apps.folder'||folder.capabilities?.canAddChildren!==true)fail(403,'destination_unavailable','This account cannot add files to the selected folder.');
  await auth.recheck();return {auth,value};
}
export async function prepareGoogleOperation(env:Bindings,principal:ConnectorPrincipal,projectId:string,input:unknown,c?:Context<Env>){
  const value=connectorOperationPrepareSchema.parse(input);
  if(!['create_google_slides','upload_drive_export'].includes(value.action))fail(400,'unsupported_action','Select a supported Google action.');
  const {auth}=await destination(env,principal,projectId,value.bindingId,value.arguments);
  const upload=value.action==='upload_drive_export';
  if(upload)googleUploadArguments.parse(value.arguments);else{argumentsSchema.parse(value.arguments);await content(env,principal.userId,projectId);}
  await auth.recheck();
  const operation=await prepareConnectorOperation(env,principal,value,await (upload?googleUploadTool:googleSlidesTool)(auth.connection.id));
  if(upload){if(!c)fail(503,'renderer_not_configured','Rendering context is unavailable.');await stageGoogleExport(c,operation,value.arguments,auth.credential!.accessToken);}
  return operation;
}
export async function executeGoogleOperation(env:Bindings,principal:ConnectorPrincipal,projectId:string,operationId:string,expectedRevision:number,trustedGuard?:{sql:string;values:unknown[]}){
  const row=await ownedOperation(env,principal.userId,operationId);
  if(row.project_id!==projectId)fail(404,'operation_not_found','Operation not found.');
  if(!['create_google_slides','upload_drive_export'].includes(row.action))fail(400,'unsupported_action','Select a supported Google action.');
  const auth=await googleBindingAuthority(env,principal,row.binding_id,'prepare_write',projectId);
  const upload=row.action==='upload_drive_export';
  const prepared=upload?await readExportArtifact(env,row.id):undefined;
  const descriptor=await (upload?googleUploadTool:googleSlidesTool)(auth.connection.id),requests=upload?[]:await content(env,principal.userId,projectId);
  const claimed=await claimConnectorOperation(env,principal,operationId,expectedRevision,descriptor);
  const lease=claimed.leaseId,revision=claimed.operation.revision;
  let presentationId:string|undefined,dispatched=false;
  try{
    const {value}=await destination(env,principal,projectId,row.binding_id,claimed.arguments);
    const args=upload?googleUploadArguments.parse(claimed.arguments):argumentsSchema.parse(claimed.arguments);
    const context=await inspectOperationVersions(env,principal,row.binding_id,claimed.operation.versions,descriptor.effect,descriptor.remoteName);
    const guard=async()=>{
      await auth.recheck();
      if(!await env.DB.prepare(`SELECT 1 FROM connector_operations WHERE id=? AND user_id=? AND revision=? AND status='running' AND lease_id=? AND lease_expires_at>${operationClockSql} AND (${context.guard.sql})${trustedGuard?` AND (${trustedGuard.sql})`:''}`)
        .bind(row.id,principal.userId,revision,lease,...context.guard.values,...(trustedGuard?.values??[])).first())fail(409,'revision_conflict','Action authority changed before the next remote request.');
    };
    const headers={'Content-Type':'application/json',Authorization:`Bearer ${auth.credential!.accessToken}`};
    await guard();
    if(prepared&&'filename' in args){
      presentationId=prepared.artifact.remote_id;
      await env.DB.prepare("UPDATE connector_operations SET remote_ids_json=? WHERE id=? AND user_id=? AND revision=? AND status='running'").bind(JSON.stringify([presentationId]),row.id,principal.userId,revision).run();
      const boundary=`studio_${crypto.randomUUID().replaceAll('-','')}`;
      const metadata={id:presentationId,name:args.filename,mimeType:prepared.artifact.mime_type,parents:[args.folderId],appProperties:{studioOperationId:row.id,studioContentHash:prepared.artifact.content_hash}};
      const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${prepared.artifact.mime_type}\r\n\r\n`,new Uint8Array(prepared.bytes),`\r\n--${boundary}--\r\n`]);
      await guard();dispatched=true;
      const response=await nativeJson(env,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',{method:'POST',headers:{...headers,'Content-Type':`multipart/related; boundary=${boundary}`},body});
      if(z.object({id:z.string()}).parse(response).id!==presentationId)fail(502,'invalid_provider_response','Provider returned a different export identity.');
      return await finishConnectorOperation(env,principal,row.id,revision,lease,{status:'succeeded',remoteIds:[presentationId],result:{fileId:presentationId,filename:args.filename,folderId:args.folderId,format:args.format,bytes:prepared.artifact.bytes,sha256:prepared.artifact.content_hash}});
    }
    dispatched=true;
    const created=await nativeJson(env,'https://slides.googleapis.com/v1/presentations?fields=presentationId',{method:'POST',headers,body:JSON.stringify({title:'title' in args?args.title:''})});
    presentationId=z.object({presentationId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)}).parse(created).presentationId;
    // Record the returned remote identity even if cancellation raced with the response.
    await env.DB.prepare("UPDATE connector_operations SET remote_ids_json=? WHERE id=? AND user_id=? AND remote_ids_json='[]'")
      .bind(JSON.stringify([presentationId]),row.id,principal.userId).run();
    await guard();
    await nativeJson(env,`https://www.googleapis.com/drive/v3/files/${presentationId}?addParents=${encodeURIComponent(value.folderId)}&fields=id&supportsAllDrives=true`,{method:'PATCH',headers,body:'{}'});
    await guard();
    await nativeJson(env,`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,{method:'POST',headers,body:JSON.stringify({requests})});
    return await finishConnectorOperation(env,principal,row.id,revision,lease,{status:'succeeded',remoteIds:[presentationId],result:{presentationId,url:`https://docs.google.com/presentation/d/${presentationId}/edit`,folderId:value.folderId}});
  }catch(error){
    console.warn(JSON.stringify({event:'google_connector_operation_failed',action:row.action,remoteIdentityRecorded:!!presentationId,reason:error instanceof ApiError?error.code:error instanceof z.ZodError?'invalid_provider_identity':'transport_or_runtime_error'}));
    try{return await finishConnectorOperation(env,principal,row.id,revision,lease,{status:dispatched?'outcome_unknown':'failed',remoteIds:presentationId?[presentationId]:[],errorCode:presentationId?(upload?'upload_outcome_unknown':'partial_presentation'):dispatched?'outcome_unknown':'destination_unavailable'});}
    catch{await markConnectorOperationUncertain(env,principal.userId,row.id,revision,lease);throw error;}
  }
}
