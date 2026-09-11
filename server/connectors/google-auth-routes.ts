import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { connectorIdSchema,connectorRevisionSchema } from '../../src/shared/connector-values';
import { interactiveConnectionOwner,assertActiveConnectorPrincipal } from '../connection-policy';
import { startGoogleAuthorization,finishGoogleAuthorization,googleCredential,googleDriveScope } from './google-auth';
import { fail } from '../security';
export const googleAuthRoutes=new Hono<Env>();
googleAuthRoutes.post('/authorize',async c=>{
  interactiveConnectionOwner(c);
  const body=z.strictObject({connectionId:connectorIdSchema,expectedRevision:connectorRevisionSchema}).parse(await c.req.json());
  return c.json(await startGoogleAuthorization(c.env,c.get('principal')!,body.connectionId,body.expectedRevision));
});
googleAuthRoutes.get('/callback',async c=>{
  interactiveConnectionOwner(c);const browser=c.req.header('Accept')?.includes('text/html');
  try{
    const connection=await finishGoogleAuthorization(c.env,c.get('principal')!,{state:c.req.query('state')??'',code:c.req.query('code'),error:c.req.query('error')});
    return browser?c.redirect('/?settings=connections&connectorResult=connected',303):c.json({connection});
  }catch(error){if(!browser)throw error;return c.redirect('/?settings=connections&connectorResult=failed',303);}
});
googleAuthRoutes.post('/picker',async c=>{
  const userId=interactiveConnectionOwner(c),principal=c.get('principal')!;
  const body=z.strictObject({connectionId:connectorIdSchema}).parse(await c.req.json());
  if(!c.env.GOOGLE_PICKER_API_KEY||!c.env.GOOGLE_PICKER_APP_ID)fail(503,'connector_unconfigured','Configure Google Picker for the connector OAuth project.');
  const stored=await googleCredential(c.env,userId,body.connectionId);
  if(!JSON.parse(stored.connection.scopes_json).includes(googleDriveScope))fail(403,'missing_scope','Selected-file access is required.');
  await assertActiveConnectorPrincipal(c.env,principal);
  if(!await c.env.DB.prepare(`SELECT 1 FROM connection_credentials cr JOIN connections c ON c.id=cr.connection_id AND c.user_id=cr.user_id WHERE cr.connection_id=? AND cr.user_id=? AND cr.credential_version=? AND cr.refresh_lease_id IS NULL AND cr.expires_at>? AND c.revision=? AND c.status='connected'`)
    .bind(body.connectionId,userId,stored.row.credential_version,Date.now(),stored.connection.revision).first())fail(409,'revision_conflict','Google authorization changed.');
  c.header('Cache-Control','no-store');c.header('Pragma','no-cache');
  return c.json({accessToken:stored.credential.accessToken,expiresAt:stored.row.expires_at,accountId:stored.connection.remote_identity,apiKey:c.env.GOOGLE_PICKER_API_KEY,appId:c.env.GOOGLE_PICKER_APP_ID,scope:googleDriveScope});
});
