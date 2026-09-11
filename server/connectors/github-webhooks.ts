import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { limitedBytes } from '../providers';
import { disconnectConnection,type ConnectionRow } from '../connection-store';
import { ApiError,fail } from '../security';
export const githubWebhookRoutes=new Hono<Env>();
githubWebhookRoutes.post('/',async c=>{
  if(!c.env.GITHUB_CONNECTOR_WEBHOOK_SECRET)fail(503,'connector_unconfigured','GitHub webhook is not configured.');
  const signature=c.req.header('X-Hub-Signature-256')??'',delivery=c.req.header('X-GitHub-Delivery')??'',event=c.req.header('X-GitHub-Event')??'';
  if(!/^sha256=[a-f0-9]{64}$/.test(signature)||! /^[a-zA-Z0-9-]{1,100}$/.test(delivery))fail(401,'invalid_signature','Invalid GitHub delivery.');
  const bytes=new Uint8Array(await limitedBytes(new Response(c.req.raw.body),1048576));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.env.GITHUB_CONNECTOR_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,Buffer.from(signature.slice(7),'hex'),bytes))fail(401,'invalid_signature','Invalid GitHub signature.');
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const payload=z.object({action:z.string().optional(),installation:z.object({id:z.number().int().positive().safe()}).optional(),sender:z.object({id:z.number().int().positive().safe()}).optional()}).parse(JSON.parse(new TextDecoder().decode(bytes)));
  const installationRevoked=event==='installation'&&['deleted','suspend','new_permissions_accepted'].includes(payload.action??'')||event==='installation_repositories'&&payload.action==='removed';
  const userRevoked=event==='github_app_authorization'&&payload.action==='revoked';
  if(installationRevoked&&!payload.installation||userRevoked&&!payload.sender)fail(400,'invalid_delivery','Revocation identity is missing.');
  await c.env.DB.prepare('INSERT INTO github_webhook_deliveries(delivery_id,payload_hash,received_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(delivery,hash,Date.now()).run();
  const receipt=await c.env.DB.prepare('SELECT payload_hash,processed_at FROM github_webhook_deliveries WHERE delivery_id=?').bind(delivery).first<{payload_hash:string;processed_at:number|null}>();
  if(receipt?.payload_hash!==hash)fail(409,'delivery_conflict','Delivery identity was already used for a different payload.');
  if(receipt.processed_at)return c.json({received:true});
  // Repeat deliveries can finish interrupted invalidation; the receipt is complete only after all affected connections are closed.
  if(installationRevoked||userRevoked){
    const identity=installationRevoked?`github:%:${payload.installation!.id}`:`github:${payload.sender!.id}:%`;
    for(let batch=0;batch<100;batch++){
      const {results}=await c.env.DB.prepare("SELECT * FROM connections WHERE adapter='github' AND remote_identity LIKE ? AND status<>'disconnected' LIMIT 100").bind(identity).all<ConnectionRow>();
      if(!results.length)break;
      for(const row of results){try{await disconnectConnection(c.env,row.user_id,row.id,row.revision);}catch(error){if(!(error instanceof ApiError&&error.code==='revision_conflict'))throw error;}}
      if(batch===99)fail(503,'retry_delivery','Revocation is still processing; retry this delivery.');
    }
  }
  await c.env.DB.prepare('UPDATE github_webhook_deliveries SET processed_at=? WHERE delivery_id=? AND payload_hash=?').bind(Date.now(),delivery,hash).run();
  return c.json({received:true});
});
