import { reconcileGithubExport } from './connectors/github-reconciliation';
import { reconcileGoogleUpload } from './connectors/google-reconciliation';
import { readExportArtifact } from './connectors/google-export-artifacts';
import { prepareMcpContinuation } from './connectors/mcp-continuation';
import { Hono, type Context } from 'hono';
import type { Env } from './types';
import { connectorIdSchema } from '../src/shared/connector-values';
import { connectorOperationExecuteSchema, connectorOperationDecisionSchema } from '../src/shared/connector-operations';
import { projectRow } from './projects';
import { requestConnectorPrincipal } from './connection-policy';
import { cancelConnectorOperation, decideConnectorOperation } from './connector-operations';
import { readConnectorOperation, listConnectorOperations } from './connector-operation-reads';
import { prepareConnectorAction, executeConnectorAction } from './connector-action-dispatch';
import { ownedOperation } from './connector-operation-versions';
import { fail, owner } from './security';
async function context(c:Context<Env>, operation = false) {
  const project = await projectRow(c,connectorIdSchema.parse(c.req.param('id')));
  const principal = requestConnectorPrincipal(c,project.id);
  const operationId = operation ? connectorIdSchema.parse(c.req.param('operationId')) : '';
  if (operation && (await ownedOperation(c.env,owner(c),operationId)).project_id !== project.id) fail(404,'operation_not_found','Operation not found in this project.');
  return {projectId:project.id,principal,operationId};
}
export const connectorOperationRoutes = new Hono<Env>();
connectorOperationRoutes.get('/:id/connector-operations',async c=>{
  const a=await context(c);return c.json(await listConnectorOperations(c.env,a.principal,a.projectId));
});
connectorOperationRoutes.post('/:id/connector-operations',async c=>{
  const a=await context(c);return c.json({operation:await prepareConnectorAction(c.env,a.principal,a.projectId,await c.req.json(),c)},201);
});
connectorOperationRoutes.get('/:id/connector-operations/:operationId',async c=>{
  const a=await context(c,true);return c.json(await readConnectorOperation(c.env,a.principal,a.operationId));
});
connectorOperationRoutes.post('/:id/connector-operations/:operationId/execute',async c=>{
  const a=await context(c,true),body=connectorOperationExecuteSchema.parse(await c.req.json());
  return c.json({operation:await executeConnectorAction(c.env,a.principal,a.projectId,a.operationId,body.expectedRevision)});
});
connectorOperationRoutes.post('/:id/connector-operations/:operationId/decision',async c=>{
  const a=await context(c,true),body=connectorOperationDecisionSchema.parse(await c.req.json());
  return c.json({operation:await decideConnectorOperation(c,a.operationId,body.expectedRevision,body.decision)});
});
connectorOperationRoutes.post('/:id/connector-operations/:operationId/cancel',async c=>{
  const a=await context(c,true),body=connectorOperationExecuteSchema.parse(await c.req.json());
  return c.json({operation:await cancelConnectorOperation(c.env,a.principal,a.operationId,body.expectedRevision)});
});

connectorOperationRoutes.post('/:id/connector-operations/:operationId/continuation',async c=>{
  const a=await context(c,true);return c.json({operation:await prepareMcpContinuation(c,a.projectId,a.operationId,await c.req.json())},201);
});

connectorOperationRoutes.get('/:id/connector-operations/:operationId/artifact',async c=>{
  const a=await context(c,true),before=await readConnectorOperation(c.env,a.principal,a.operationId);
  if(!before.payloadAvailable||!['upload_drive_export','create_react_pull_request'].includes(before.operation.action))fail(404,'export_not_ready','Prepared export is unavailable.');
  const {artifact,bytes}=await readExportArtifact(c.env,a.operationId);
  const after=await readConnectorOperation(c.env,a.principal,a.operationId);
  if(!after.payloadAvailable||after.operation.revision!==before.operation.revision)fail(409,'revision_conflict','Export access changed while reading.');
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':artifact.mime_type,'Content-Disposition':`attachment; filename="prepared-${a.operationId}.${artifact.mime_type==='application/zip'?'zip':artifact.mime_type==='application/pdf'?'pdf':'pptx'}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
});

connectorOperationRoutes.post('/:id/connector-operations/:operationId/reconcile',async c=>{
  const a=await context(c,true),body=connectorOperationExecuteSchema.parse(await c.req.json());
  const action=(await ownedOperation(c.env,a.principal.userId,a.operationId)).action;
  return c.json({operation:await (action==='create_react_pull_request'?reconcileGithubExport:reconcileGoogleUpload)(c.env,a.principal,a.projectId,a.operationId,body.expectedRevision)});
});
