import { githubAuthRoutes } from './connectors/github-auth-routes';
import { googleAuthRoutes } from './connectors/google-auth-routes';
import { agentRunRoutes } from './agent-run-routes';
import { projectSourceRoutes } from './project-source-routes';
import { Hono } from 'hono';
import { connectorOperationRoutes } from './connector-operation-routes';
import { projectConnectionRoutes } from './project-connection-routes';
import type { Env } from './types';
import { connectionRoutes } from './connections';
import { mcpAuthRoutes } from './connectors/mcp-auth-routes';
import { maintainConnectorState } from './connector-retention';
import { cleanupConnectorObjects } from './connector-object-cleanup';
import { fail, owner } from './security';

export const connectorRoutes = new Hono<Env>();
for (const path of ['/projects/:id/runs', '/projects/:id/runs/*', '/projects/:id/sources', '/projects/:id/sources/*', '/connections', '/connections/*', '/connectors/*', '/projects/:id/connections', '/projects/:id/connections/*', '/projects/:id/connector-operations', '/projects/:id/connector-operations/*']) {
  connectorRoutes.use(path, async (c, next) => {
    const { env: bindings } = c;
    const recovery = (c.req.path.includes('/connector-operations') || /\/runs(?:\/|$)/.test(c.req.path)) && (c.req.method === 'GET' || c.req.path.endsWith('/cancel'));
    if (bindings.CONNECTORS_ENABLED !== 'true' && !recovery) fail(503, 'connector_unconfigured', 'Connector setup is not enabled on this server.');
    if (c.req.path !== '/api/connectors/mcp/client-metadata') {
      owner(c);
      await maintainConnectorState(bindings);
      await cleanupConnectorObjects(bindings);
    }
    await next();
  });
}
connectorRoutes.route('/connections', connectionRoutes);
connectorRoutes.route('/projects', projectConnectionRoutes);
connectorRoutes.route('/connectors/mcp', mcpAuthRoutes);

connectorRoutes.route('/projects', connectorOperationRoutes);

connectorRoutes.route('/projects', projectSourceRoutes);

connectorRoutes.route('/projects',agentRunRoutes);

connectorRoutes.route('/connectors/google-drive',googleAuthRoutes);

connectorRoutes.route('/connectors/github',githubAuthRoutes);
