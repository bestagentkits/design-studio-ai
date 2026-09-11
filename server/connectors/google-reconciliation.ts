import { z } from 'zod';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { readConnectorOperation } from '../connector-operation-reads';
import { ownedOperation } from '../connector-operation-versions';
import { connectorOperationMetadata } from '../connector-operations';
import { googleBindingAuthority } from './google-drive';
import { googleUploadArguments,readExportArtifact } from './google-export-artifacts';
import { nativeJson,nativeRequest } from './native-transport';
import { limitedBytes } from '../providers';
import { fail,now } from '../security';
/** Reconciliation only reads the reserved file; it never creates or changes a remote artifact. */
export async function reconcileGoogleUpload(env:Bindings,principal:ConnectorPrincipal,projectId:string,operationId:string,revision:number){
  const detail=await readConnectorOperation(env,principal,operationId),row=await ownedOperation(env,principal.userId,operationId);
  if(row.project_id!==projectId)fail(404,'operation_not_found','Operation not found.');
  if(row.revision!==revision||row.status!=='outcome_unknown'||row.action!=='upload_drive_export'||!detail.payloadAvailable)fail(409,'revision_conflict','Only an uncertain retained Drive upload can be reconciled.');
  const args=googleUploadArguments.parse(detail.arguments),auth=await googleBindingAuthority(env,principal,row.binding_id,'prepare_write',projectId);
  if(auth.selection.adapter!=='google-drive'||auth.selection.destinationFolderId!==args.folderId)fail(403,'missing_grant','The upload destination is no longer authorized.');
  const {artifact}=await readExportArtifact(env,row.id),headers={Authorization:`Bearer ${auth.credential!.accessToken}`};
  await auth.recheck();
  const file=z.object({id:z.string(),name:z.string(),mimeType:z.string(),parents:z.array(z.string()),trashed:z.boolean().optional(),appProperties:z.record(z.string(),z.string())}).parse(await nativeJson(env,`https://www.googleapis.com/drive/v3/files/${artifact.remote_id}?fields=id,name,mimeType,parents,trashed,appProperties&supportsAllDrives=true`,{headers}));
  if(file.id!==artifact.remote_id||file.trashed||file.name!==args.filename||file.mimeType!==artifact.mime_type||!file.parents.includes(args.folderId)||file.appProperties.studioOperationId!==row.id||file.appProperties.studioContentHash!==artifact.content_hash)fail(409,'outcome_unknown','The remote file does not match the approved export. No upload was retried.');
  await auth.recheck();
  const bytes=await limitedBytes(await nativeRequest(env,`https://www.googleapis.com/drive/v3/files/${artifact.remote_id}?alt=media&supportsAllDrives=true`,{headers}),20971520);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==artifact.bytes||digest!==artifact.content_hash)fail(409,'outcome_unknown','The remote file bytes differ from the prepared export. No upload was retried.');
  await auth.recheck();
  const updated=await env.DB.prepare(`UPDATE connector_operations SET status='succeeded',revision=revision+1,error_code=NULL,remote_ids_json=?,updated_at=? WHERE id=? AND user_id=? AND revision=? AND status='outcome_unknown' AND encrypted_arguments=? AND (${auth.guard.sql})`)
    .bind(JSON.stringify([artifact.remote_id]),now(),row.id,principal.userId,revision,row.encrypted_arguments,...auth.guard.values).run();
  if(updated.meta.changes!==1)fail(409,'revision_conflict','Operation or authorization changed while reconciling.');
  return connectorOperationMetadata(await ownedOperation(env,principal.userId,row.id));
}
