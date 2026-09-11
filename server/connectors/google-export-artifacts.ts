import type { Context } from 'hono';
import type { Env,Bindings } from '../types';
import type { ConnectorOperation } from '../../src/shared/connector-operations';
import { z } from 'zod';
import { renderProjectExport } from '../exports';
import { limitedBytes } from '../providers';
import { beginConnectorObjectUpload,abandonConnectorObjectUpload } from '../connector-object-cleanup';
import { inspectOperationVersions } from '../connector-operation-versions';
import { nativeJson } from './native-transport';
import { fail } from '../security';
export const googleUploadArguments=z.strictObject({filename:z.string().trim().min(1).max(200).refine(name=>!/[\x00-\x1f/\\]/.test(name)),folderId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),format:z.enum(['pdf','pptx'])});
interface Artifact {object_key:string;content_hash:string;mime_type:string;bytes:number;remote_id:string}
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function exportArtifact(env:Bindings,operationId:string){return env.DB.prepare('SELECT * FROM connector_export_artifacts WHERE operation_id=?').bind(operationId).first<Artifact>();}
export async function stageGoogleExport(c:Context<Env>,operation:ConnectorOperation,args:unknown,accessToken:string){
  if(await exportArtifact(c.env,operation.id))return;
  const value=googleUploadArguments.parse(args);
  const response=await renderProjectExport(c,operation.projectId,{format:value.format,expectedRevision:operation.versions.documentRevision});
  const bytes=new Uint8Array(await limitedBytes(response,20971520)),contentHash=await hash(bytes);
  const generated=z.object({ids:z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)).length(1)}).parse(await nativeJson(c.env,'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{headers:{Authorization:`Bearer ${accessToken}`}}));
  const upload=await beginConnectorObjectUpload(c.env);
  try{
    await c.env.ASSETS_BUCKET.put(upload.key,bytes);
    const row=await c.env.DB.prepare('SELECT binding_id FROM connector_operations WHERE id=? AND user_id=?').bind(operation.id,operation.principal.userId).first<{binding_id:string}>();
    if(!row)fail(409,'revision_conflict','Export action was removed.');
    const authority=await inspectOperationVersions(c.env,operation.principal,row.binding_id,operation.versions,'write',operation.action);
    const result=await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO connector_export_artifacts(operation_id,object_key,content_hash,mime_type,bytes,remote_id) SELECT ?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM connector_operations WHERE id=? AND user_id=? AND status IN('awaiting_approval','pending') AND encrypted_arguments IS NOT NULL)
        AND EXISTS(SELECT 1 FROM connector_object_cleanup WHERE object_key=? AND lease_id=? AND state='uploading' AND due_at>?) AND (${authority.guard.sql}) ON CONFLICT DO NOTHING`)
        .bind(operation.id,upload.key,contentHash,response.headers.get('content-type'),bytes.byteLength,generated.ids[0],operation.id,operation.principal.userId,upload.key,upload.lease,Date.now(),...authority.guard.values),
      c.env.DB.prepare('DELETE FROM connector_object_cleanup WHERE object_key=? AND lease_id=? AND EXISTS(SELECT 1 FROM connector_export_artifacts WHERE operation_id=? AND object_key=?)').bind(upload.key,upload.lease,operation.id,upload.key),
    ]) as {meta:{changes:number}}[];
    if(result[0].meta.changes!==1){await abandonConnectorObjectUpload(c.env,upload.key,upload.lease);if(!await exportArtifact(c.env,operation.id))fail(409,'revision_conflict','Project or export authority changed during rendering.');}
  }catch(error){try{await abandonConnectorObjectUpload(c.env,upload.key,upload.lease);}catch{}throw error;}
}
export async function readExportArtifact(env:Bindings,operationId:string){
  const artifact=await exportArtifact(env,operationId);if(!artifact)fail(409,'export_not_ready','Prepare this export again with the same request key to finish rendering.');
  const object=await env.ASSETS_BUCKET.get(artifact.object_key);if(!object)fail(409,'export_not_ready','The prepared export is unavailable.');
  const bytes=new Uint8Array(await limitedBytes(new Response(object.body),20971520));
  if(bytes.byteLength!==artifact.bytes||await hash(bytes)!==artifact.content_hash)fail(409,'export_not_ready','Prepared export integrity check failed.');
  return {artifact,bytes};
}
