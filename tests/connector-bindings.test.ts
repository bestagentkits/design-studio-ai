import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { authenticate, hash, ApiError } from '../server/security';
import { createConnection } from '../server/connection-store';
import { createProjectConnectionBinding, grantConnectionAccess, revokeConnectionAccess, removeProjectConnectionBinding } from '../server/connection-bindings';
import type { Env, Bindings } from '../server/types';

async function fixture(t: TestContext) {
  const db = new SqliteDatabase(':memory:'); t.after(() => db.close());
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const timestamp = new Date().toISOString();
  for (const user of ['alice','bob']) {
    await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').bind(user, `${user}@example.com`, user, 'unused', timestamp).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(user), user, Date.now()+3600000).run();
    await db.prepare('INSERT INTO api_tokens(id,user_id,name,hash,created_at) VALUES(?,?,?,?,?)').bind(`${user}-token`,user,'Isolated',await hash(`${user}-bearer`),timestamp).run();
    await db.prepare('INSERT INTO projects(id,user_id,name,kind,document,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(`${user}-project`,user,'Isolated','web','{}',timestamp,timestamp).run();
  }
  const directory = await mkdtemp(join(tmpdir(), 'studio-bindings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(directory), APP_URL: 'https://studio.example' };
  const connection = await createConnection(env,'alice',{displayName:'Tools',config:{adapter:'mcp',endpoint:'https://vendor.net/mcp',authMode:'anonymous'}});
  await db.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(connection.id).run();
  const app = new Hono<Env>();
  app.use('*',async(c,next)=>{ await authenticate(c); await next(); });
  app.onError((error,c)=> c.json({code:error instanceof ApiError ? error.code : 'unexpected'}, error instanceof ApiError ? error.status as 400 : 500));
  app.post('/projects/:project/bindings',async c=>c.json(await createProjectConnectionBinding(c,c.req.param('project'),await c.req.json())));
  app.post('/bindings/:binding/grants',async c=>c.json(await grantConnectionAccess(c,c.req.param('binding'),await c.req.json())));
  app.delete('/bindings/:binding/grants/:grant',async c=>{await revokeConnectionAccess(c,c.req.param('binding'),c.req.param('grant'));return c.json({ok:true});});
  app.delete('/bindings/:binding',async c=>{await removeProjectConnectionBinding(c,c.req.param('binding'),Number(c.req.query('revision')));return c.json({ok:true});});
  const request = (path:string, method='POST', body?:unknown, headers:Record<string,string>={}) => app.request(`https://studio.example${path}`,{method,headers:{Cookie:'studio_session=alice','Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
  const selection = {adapter:'mcp',tools:['read','write'],resources:['source']};
  const create = await request('/projects/alice-project/bindings','POST',{connectionId:connection.id,role:'tool',selection});
  assert.equal(create.status,200); const binding = await create.json() as {id:string;policyRevision:number};
  const grant = {recipient:{kind:'api',tokenId:'alice-token'},expectedPolicyRevision:1,capabilities:['execute_read'],selection:{adapter:'mcp',tools:['read'],resources:[]},expiresAt:new Date(Date.now()+3600000).toISOString()};
  return {db,request,binding,grant,selection,connection};
}
test('human grants are bounded by binding selection, role, owner and current policy',async t=>{
  const {db,request,binding,grant,connection,selection}=await fixture(t);
  assert.equal((await request('/projects/bob-project/bindings','POST',{connectionId:connection.id,role:'tool',selection})).status,409);
  const path=`/bindings/${binding.id}/grants`;
  for (const invalid of [
    {...grant,recipient:{kind:'api',tokenId:'bob-token'}},
    {...grant,expectedPolicyRevision:2},
    {...grant,selection:{adapter:'mcp',tools:['disabled'],resources:[]}},
    {...grant,capabilities:['read_source']},
    {...grant,expiresAt:new Date(0).toISOString()},
  ]) assert.ok((await request(path,'POST',invalid)).status>=400);
  for (const headers of [{Authorization:'Bearer alice-bearer'},{'X-Studio-Client':'webmcp'}] as Record<string,string>[]) assert.equal((await request(path,'POST',grant,headers)).status,403);
  const result=await request(path,'POST',grant);assert.equal(result.status,200);
  const created=await result.json() as {id:string;principal:{tokenId:string}};assert.equal(created.principal.tokenId,'alice-token');
  assert.equal((await request(`${path}/${created.id}`,'DELETE')).status,200);
  assert.ok((await db.prepare('SELECT revoked_at FROM connection_agent_grants WHERE id=?').bind(created.id).first<{revoked_at:string}>())?.revoked_at);
});
test('WebMCP grant IDs are server-issued and binding removal retains a disabled tombstone',async t=>{
  const {db,request,binding,grant}=await fixture(t);
  const result=await request(`/bindings/${binding.id}/grants`,'POST',{...grant,recipient:{kind:'webmcp'}});assert.equal(result.status,200);
  const created=await result.json() as {id:string;principal:{grantId:string}};assert.equal(created.principal.grantId,created.id);
  assert.equal((await request(`/bindings/${binding.id}?revision=1`,'DELETE')).status,200);
  const row=await db.prepare('SELECT disabled_at,policy_revision FROM project_connection_bindings WHERE id=?').bind(binding.id).first<{disabled_at:string;policy_revision:number}>();
  assert.ok(row?.disabled_at);assert.equal(row.policy_revision,2);
  assert.equal((await request(`/bindings/${binding.id}?revision=1`,'DELETE')).status,404);
  assert.equal((await request(`/bindings/${binding.id}/grants`,'POST',grant)).status,404);
  assert.ok((await db.prepare('SELECT revoked_at FROM connection_agent_grants WHERE id=?').bind(created.id).first<{revoked_at:string}>())?.revoked_at);
});
