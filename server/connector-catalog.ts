import { discoverGithubCatalog } from './connectors/github-catalog';
import { googleSlidesTool,googleUploadTool } from './connectors/google-tools';
import type { Bindings } from './types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { authorizeConnectorBinding } from './connection-policy';
import { discoverBindingMcpCatalog } from './connectors/mcp-resources';
import { googleBindingAuthority, googleFileMetadata } from './connectors/google-drive';
import { connectorVersionPinsSchema } from '../src/shared/connector-operations';
import { connectorFingerprint } from './connector-fingerprints';
import { fail } from './security';

/** Catalog reads never widen the binding or an agent's selected file set. */
export async function discoverConnectorCatalog(env:Bindings,principal:ConnectorPrincipal,bindingId:string){
  const selected=await authorizeConnectorBinding(env,principal,bindingId,'discover');
  if(selected.selection.adapter==='mcp')return discoverBindingMcpCatalog(env,principal,bindingId);
  if(selected.selection.adapter==='github')return discoverGithubCatalog(env,principal,bindingId);
  if(selected.selection.adapter!=='google-drive')fail(400,'unsupported_protocol','This adapter does not expose a catalog yet.');
  const auth=await googleBindingAuthority(env,principal,bindingId,'discover',selected.binding.project_id);
  if(auth.selection.adapter!=='google-drive')fail(409,'revision_conflict','Connection selection changed.');
  const resources=[];
  for(const fileId of auth.selection.fileIds){
    await auth.recheck();
    const file=await googleFileMetadata(env,auth.credential!.accessToken,fileId);
    resources.push({uri:file.id,fileId:file.id,name:file.name,mimeType:file.mimeType});
  }
  const project=await env.DB.prepare('SELECT revision FROM projects WHERE id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  const brief=await env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  const credential=await env.DB.prepare('SELECT credential_version FROM connection_credentials WHERE connection_id=? AND user_id=?').bind(auth.connection.id,principal.userId).first<{credential_version:number}>();
  await auth.recheck();
  const tools=auth.selection.destinationFolderId&&auth.binding.role==='destination'?await Promise.all([googleSlidesTool,googleUploadTool].map(async create=>({...await create(auth.connection.id),id:create.name,schemaSupported:true}))):[];
  const catalog={tools,resources,templates:[]};
  return {...catalog,versions:connectorVersionPinsSchema.parse({connectionRevision:auth.connection.revision,credentialVersion:credential?.credential_version,policyRevision:auth.binding.policy_revision,documentRevision:project?.revision,briefRevision:brief?.revision??0,sourceSnapshotIds:[]}),fingerprint:await connectorFingerprint(catalog)};
}
