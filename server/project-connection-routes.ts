import { Hono, type Context } from 'hono';
import type { Env } from './types';
import { owner, fail } from './security';
import { projectRow } from './projects';
import { connectorIdSchema } from '../src/shared/connector-values';
import { connectionBindingRemoveSchema } from '../src/shared/connector-management';
import { projectConnectionBindingSchema, connectorSelectionSchema } from '../src/shared/connectors';
import { authorizeConnectorBinding, ownedBinding, requestConnectorPrincipal } from './connection-policy';
import { createProjectConnectionBinding, grantConnectionAccess, revokeConnectionAccess, removeProjectConnectionBinding } from './connection-bindings';

async function scopedBinding(c: Context<Env>) {
  const { env: bindings } = c;
  const row = await ownedBinding(bindings, owner(c), connectorIdSchema.parse(c.req.param('bindingId')));
  if (row.project_id !== c.req.param('id')) fail(404, 'binding_not_found', 'Project connection not found.');
  return row;
}
export const projectConnectionRoutes = new Hono<Env>();
projectConnectionRoutes.get('/:id/connections', async c => {
  const { env: bindings } = c, project = await projectRow(c, c.req.param('id'));
  const principal = requestConnectorPrincipal(c, project.id);
  const rows = await bindings.DB.prepare('SELECT id FROM project_connection_bindings WHERE user_id=? AND project_id=? AND disabled_at IS NULL ORDER BY id LIMIT 100').bind(owner(c), project.id).all<{id:string}>();
  const connections = [];
  for (const row of rows.results) {
    try {
      if (principal.kind === 'session') {
        const binding = await ownedBinding(bindings, principal.userId, row.id);
        connections.push(projectConnectionBindingSchema.parse({id:row.id,projectId:project.id,connectionId:binding.connection_id,role:binding.role,policyRevision:binding.policy_revision,selection:connectorSelectionSchema.parse(JSON.parse(binding.selection_json))}));
        continue;
      }
      const authorized = await authorizeConnectorBinding(bindings, principal, row.id, 'discover');
      connections.push(projectConnectionBindingSchema.parse({id:row.id,projectId:project.id,connectionId:authorized.connection.id,role:authorized.binding.role,policyRevision:authorized.binding.policy_revision,selection:authorized.selection}));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && ['missing_grant','needs_reauthorization','connection_revoked'].includes(String(error.code)))) throw error;
    }
  }
  return c.json({connections});
});
projectConnectionRoutes.post('/:id/connections', async c => c.json({binding:await createProjectConnectionBinding(c,connectorIdSchema.parse(c.req.param('id')),await c.req.json())},201));
projectConnectionRoutes.delete('/:id/connections/:bindingId', async c => {
  const row=await scopedBinding(c), body=connectionBindingRemoveSchema.parse(await c.req.json());
  await removeProjectConnectionBinding(c,row.id,body.expectedPolicyRevision); return c.json({ok:true});
});
projectConnectionRoutes.post('/:id/connections/:bindingId/grants', async c => {
  const row=await scopedBinding(c); return c.json({grant:await grantConnectionAccess(c,row.id,await c.req.json())},201);
});
projectConnectionRoutes.delete('/:id/connections/:bindingId/grants/:grantId', async c => {
  const row=await scopedBinding(c); await revokeConnectionAccess(c,row.id,connectorIdSchema.parse(c.req.param('grantId'))); return c.json({ok:true});
});
