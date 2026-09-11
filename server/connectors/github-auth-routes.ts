import { listGithubRepositories,resolveGithubRef } from './github-selection';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { connectorIdSchema,connectorRevisionSchema } from '../../src/shared/connector-values';
import { interactiveConnectionOwner } from '../connection-policy';
import { startGithubAuthorization,finishGithubAuthorization } from './github-auth';
export const githubAuthRoutes=new Hono<Env>();
githubAuthRoutes.post('/authorize',async c=>{
  interactiveConnectionOwner(c);const body=z.strictObject({connectionId:connectorIdSchema,expectedRevision:connectorRevisionSchema,installationId:z.string().regex(/^[1-9][0-9]{0,15}$/)}).parse(await c.req.json());
  return c.json(await startGithubAuthorization(c.env,c.get('principal')!,body.connectionId,body.expectedRevision,body.installationId));
});
githubAuthRoutes.get('/callback',async c=>{
  interactiveConnectionOwner(c);const browser=c.req.header('Accept')?.includes('text/html');
  try{const connection=await finishGithubAuthorization(c.env,c.get('principal')!,{state:c.req.query('state')??'',code:c.req.query('code'),error:c.req.query('error')});return browser?c.redirect('/?settings=connections&connectorResult=connected',303):c.json({connection});}
  catch(error){if(!browser)throw error;return c.redirect('/?settings=connections&connectorResult=failed',303);}
});

githubAuthRoutes.get('/repositories',async c=>{
  interactiveConnectionOwner(c);return c.json(await listGithubRepositories(c.env,c.get('principal')!,connectorIdSchema.parse(c.req.query('connectionId')),z.coerce.number().int().min(1).max(10).default(1).parse(c.req.query('page'))));
});
githubAuthRoutes.post('/resolve',async c=>{
  interactiveConnectionOwner(c);const body=z.strictObject({connectionId:connectorIdSchema,repositoryId:z.string().regex(/^[1-9][0-9]{0,15}$/),ref:z.string().min(1).max(200)}).parse(await c.req.json());
  return c.json(await resolveGithubRef(c.env,c.get('principal')!,body.connectionId,body.repositoryId,body.ref));
});
