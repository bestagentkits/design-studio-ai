import { connectorBindingAuthority } from './connector-binding-authority';
import { storeAsset } from './projects';
import { limitedBytes } from './providers';
import { importGithubSource } from './connectors/github';
import { importGoogleSource } from './connectors/google-drive';
import { Hono } from 'hono';
import type { Env } from './types';
import { connectorIdSchema } from '../src/shared/connector-values';
import { assertActiveConnectorPrincipal, authorizeConnectorBinding, interactiveConnectionOwner, requestConnectorPrincipal } from './connection-policy';
import { listProjectSources, getProjectSource, removeProjectSource } from './project-sources';
import { importMcpResource } from './connectors/mcp-resources';
import { ApiError, fail, owner } from './security';
import type { SourceSnapshot } from '../src/shared/connectors';

export const projectSourceRoutes = new Hono<Env>();
projectSourceRoutes.get('/:id/sources',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),actor=requestConnectorPrincipal(c,projectId);
  const sources=await listProjectSources(c.env,actor.userId,projectId),visible:SourceSnapshot[]=[];
  for(const source of sources){
    if(actor.kind==='session'){visible.push(source);continue;}
    if(!source.bindingId||source.status!=='available')continue;
    try{await authorizeConnectorBinding(c.env,actor,source.bindingId,'read_source',source.remoteIdentity);visible.push(source);}
    catch(error){if(!(error instanceof ApiError&&[403,404,409].includes(error.status)))throw error;}
  }
  return c.json({sources:visible});
});
projectSourceRoutes.get('/:id/sources/:sourceId',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),sourceId=connectorIdSchema.parse(c.req.param('sourceId')),actor=requestConnectorPrincipal(c,projectId);
  const sources=await listProjectSources(c.env,actor.userId,projectId),source=sources.find(s=>s.id===sourceId);
  if(!source)fail(404,'not_found','Source not found.');
  const authorize=async()=>{
    await assertActiveConnectorPrincipal(c.env,actor);
    const current=(await listProjectSources(c.env,actor.userId,projectId)).find(item=>item.id===sourceId);
    if(!current)fail(404,'not_found','Source was removed.');
    if(actor.kind==='session')return;
    if(current.status!=='available'||current.bindingId!==source.bindingId)fail(403,'missing_grant','Source is no longer available.');
    if(!source.bindingId||source.status!=='available')fail(403,'missing_grant','Source is disconnected.');
    await authorizeConnectorBinding(c.env,actor,source.bindingId,'read_source',source.remoteIdentity);
  };
  await authorize();const result=await getProjectSource(c.env,actor.userId,projectId,sourceId);await authorize();
  // Always download data rather than execute remote HTML/SVG in the application origin.
  return new Response(result.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="source-${source.id}.bin"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
});
projectSourceRoutes.delete('/:id/sources/:sourceId',async c=>{
  const userId=interactiveConnectionOwner(c);
  await removeProjectSource(c.env,userId,connectorIdSchema.parse(c.req.param('id')),connectorIdSchema.parse(c.req.param('sourceId')));
  return c.json({ok:true});
});
projectSourceRoutes.post('/:id/sources/:sourceId/refresh',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),sourceId=connectorIdSchema.parse(c.req.param('sourceId')),actor=requestConnectorPrincipal(c,projectId);
  const sources=await listProjectSources(c.env,owner(c),projectId),source=sources.find(s=>s.id===sourceId);
  if(!source)fail(404,'not_found','Source not found.');
  if(!source.bindingId||source.status!=='available')fail(409,'connection_revoked','Reconnect and select this source before importing a new snapshot.');
  if(source.adapter==='github')return c.json({source:await importGithubSource(c.env,actor,projectId,source.bindingId,source.remoteIdentity)},201);
  if(source.adapter==='google-drive')return c.json({source:await importGoogleSource(c.env,actor,projectId,source.bindingId,source.remoteIdentity)},201);
  if(source.adapter!=='mcp')fail(400,'unsupported_protocol','This adapter does not support source refresh yet.');
  return c.json({source:await importMcpResource(c.env,actor,projectId,source.bindingId,source.remoteIdentity)},201);
});

projectSourceRoutes.post('/:id/sources/:sourceId/asset',async c=>{
  const projectId=connectorIdSchema.parse(c.req.param('id')),sourceId=connectorIdSchema.parse(c.req.param('sourceId')),actor=requestConnectorPrincipal(c,projectId);
  const source=(await listProjectSources(c.env,actor.userId,projectId)).find(item=>item.id===sourceId);
  if(!source||!source.bindingId||source.status!=='available')fail(409,'connection_revoked','Select an available connected source before importing an asset.');
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(source.mimeType))fail(422,'unsupported_content','Only supported image snapshots can become project assets.');
  const auth=await connectorBindingAuthority(c.env,actor,source.bindingId,'read_source',source.remoteIdentity,projectId,source.adapter);
  const content=await getProjectSource(c.env,actor.userId,projectId,sourceId),bytes=await limitedBytes(new Response(content.body),20971520);
  const sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  if(sha!==source.contentHash)fail(409,'source_unavailable','Snapshot integrity check failed.');
  await auth.recheck();
  const guard={sql:`(${auth.guard.sql}) AND EXISTS(SELECT 1 FROM project_source_snapshots WHERE id=? AND user_id=? AND project_id=? AND binding_id=? AND status='available' AND content_hash=?)`,values:[...auth.guard.values,sourceId,actor.userId,projectId,source.bindingId,source.contentHash]};
  return c.json({asset:await storeAsset(c,projectId,`Source ${source.remoteIdentity}`.slice(0,200),source.mimeType,bytes,guard),sourceId},201);
});
