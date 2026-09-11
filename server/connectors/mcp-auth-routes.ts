import { Hono, type Context } from 'hono';
import { mcpConnectionSetupSchema, mcpAuthorizationStartSchema } from '../../src/shared/connector-management';
import type { Env } from '../types';
import { interactiveConnectionOwner } from '../connection-policy';
import { fail } from '../security';
import { startMcpAuthorization, finishMcpAuthorization } from './mcp-auth';
import { activateMcpConnection, connectMcpConnection } from './mcp-connection';

function principal(c: Context<Env>) {
  interactiveConnectionOwner(c);
  return c.get('principal')!;
}
function clientMetadata(c: Context<Env>) {
  const { env: bindings } = c;
  let origin: string;
  try { origin = new URL(bindings.APP_URL!).origin; } catch { return fail(503, 'connector_unconfigured', 'Set the canonical application URL.'); }
  if (!origin.startsWith('https://')) fail(503, 'connector_unconfigured', 'OAuth client metadata requires HTTPS.');
  return { client_id: `${origin}/api/connectors/mcp/client-metadata`, client_name: 'Design Studio AI',
    redirect_uris: [`${origin}/api/connectors/mcp/callback`], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none' };
}
/** Human-only setup endpoints. Mount with the connector rollout gate and shared CSRF middleware. */
export const mcpAuthRoutes = new Hono<Env>();
mcpAuthRoutes.get('/client-metadata', c => c.json(clientMetadata(c)));
mcpAuthRoutes.post('/connect', async c => {
  const actor = principal(c), { env: bindings } = c;
  const body = mcpConnectionSetupSchema.parse(await c.req.json());
  return c.json(await connectMcpConnection(bindings, actor, body.connectionId, body.expectedRevision, body.accessToken));
});
mcpAuthRoutes.post('/authorize', async c => {
  const actor = principal(c), { env: bindings } = c;
  const body = mcpAuthorizationStartSchema.parse(await c.req.json());
  const options = { ...body.options };
  if (options.profile === 'modern' && !options.client && !options.clientMetadataUrl) options.clientMetadataUrl = clientMetadata(c).client_id;
  return c.json(await startMcpAuthorization(bindings, actor, body.connectionId, body.expectedRevision, options));
});
mcpAuthRoutes.get('/callback', async c => {
  const actor = principal(c), { env: bindings } = c;
  // The saved one-use state owns destination, issuer, resource and session; no return URL is accepted.
  const proof = await finishMcpAuthorization(bindings, actor, {
    state: c.req.query('state') ?? '', code: c.req.query('code'), issuer: c.req.query('iss'), denial: c.req.query('error'),
  });
  return c.json(await activateMcpConnection(bindings, actor, proof.connectionId, proof.expectedRevision, proof.credentialVersion, proof.scopes));
});
