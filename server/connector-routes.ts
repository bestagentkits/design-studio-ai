import { Hono } from 'hono';
import type { Env } from './types';
import { connectionRoutes } from './connections';
import { mcpAuthRoutes } from './connectors/mcp-auth-routes';
import { maintainConnectorState } from './connector-retention';
import { cleanupConnectorObjects } from './connector-object-cleanup';
import { fail, owner } from './security';

export const connectorRoutes = new Hono<Env>();
for (const path of ['/connections', '/connections/*', '/connectors/*']) {
  connectorRoutes.use(path, async (c, next) => {
    const { env: bindings } = c;
    if (bindings.CONNECTORS_ENABLED !== 'true') fail(503, 'connector_unconfigured', 'Connector setup is not enabled on this server.');
    if (c.req.path !== '/api/connectors/mcp/client-metadata') {
      owner(c);
      await maintainConnectorState(bindings);
      await cleanupConnectorObjects(bindings);
    }
    await next();
  });
}
connectorRoutes.route('/connections', connectionRoutes);
connectorRoutes.route('/connectors/mcp', mcpAuthRoutes);
