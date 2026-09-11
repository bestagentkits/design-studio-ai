import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { hash, secret } from '../server/security';
import type { Bindings } from '../server/types';

// Exercise the actual mounted routes with authentication, CSRF and rollout configuration.
const origin = 'https://connections.studio.example';
const createBody = { displayName: 'Private connector', config: { adapter: 'mcp', endpoint: 'https://peer.vendor.net/mcp', authMode: 'oauth' } };
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-connections-')), db = new SqliteDatabase(':memory:');
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const insert = async (table: string, values: Record<string, unknown>) => { const keys = Object.keys(values); await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run(); };
  const timestamp = new Date().toISOString(), future = Date.now() + 3600000;
  for (const owner of ['alice','bob']) {
    await insert('users',{id:owner,email:`${owner}@example.com`,name:owner,password:'unused-test-password',created_at:timestamp});
    await insert('sessions',{hash:await hash(`${owner}-session`),user_id:owner,expires_at:future});
    await insert('api_tokens',{id:`${owner}-api-id`,hash:await hash(`${owner}-api`),user_id:owner,name:'Isolated API token',created_at:timestamp});
    await insert('projects',{id:`${owner}-project`,user_id:owner,name:'Isolated project',kind:'web',document:'{}',created_at:timestamp,updated_at:timestamp});
    // Connected anonymous transport fixture only; no remote provider authorization is claimed.
    await insert('connections',{id:`${owner}-connection`,user_id:owner,adapter:'mcp',display_name:'Isolated connection',endpoint:'https://peer.vendor.net/mcp',auth_mode:'anonymous',status:'connected',created_at:timestamp,updated_at:timestamp});
    await insert('project_connection_bindings',{id:`${owner}-binding`,user_id:owner,project_id:`${owner}-project`,connection_id:`${owner}-connection`,role:'tool',selection_json:JSON.stringify({adapter:'mcp',tools:['read'],resources:[]}),created_at:timestamp,updated_at:timestamp});
  }
  await insert('oauth_clients',{id:'client',name:'Isolated OAuth client',redirect_uris:'[]',created_at:timestamp});
  await insert('oauth_tokens',{hash:await hash('alice-oauth'),user_id:'alice',client_id:'client',family:'family',resource:`${origin}/mcp`,kind:'access',expires_at:future});
  const env: Bindings = { DB:db,ASSETS_BUCKET:new FileBucket(join(directory,'assets')),APP_URL:origin,ENCRYPTION_KEY:secret(),CONNECTORS_ENABLED:'true' };
  const request = (path='', credential='alice-session', method='GET', body?: unknown, headers: Record<string,string>={}) => app.request(`${origin}/api/connections${path}`,{
    method, headers:{Origin:origin,'Content-Type':'application/json',...(credential.endsWith('-session')?{Cookie:`studio_session=${credential}`}:{Authorization:`Bearer ${credential}`}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),
  },env);
  const grant = async (kind: 'api'|'oauth'|'webmcp', capabilities=['discover']) => {
    const id=`${kind}-grant`;
    await insert('connection_agent_grants',{id,user_id:'alice',project_id:'alice-project',connection_id:'alice-connection',principal_kind:kind,principal_id:kind==='api'?'alice-api-id':kind==='oauth'?'family':id,principal_client_id:kind==='oauth'?'client':null,capabilities_json:JSON.stringify(capabilities),selection_json:JSON.stringify({adapter:'mcp',tools:['read'],resources:[]}),created_at:timestamp,expires_at:future});
    return id;
  };
  return { db, env, request, grant };
}
async function failure(response: Response, status: number, expected: string) { assert.equal(response.status,status); assert.equal((await response.json() as {error:{code:string}}).error.code,expected); }

test('human creation returns pending metadata only and rejects secret-bearing request fields',async t=>{
  const {request,db}=await setup(t),response=await request('','alice-session','POST',createBody);
  assert.equal(response.status,201); const {connection}=await response.json() as {connection:Record<string,unknown>};
  assert.equal(connection.status,'pending'); assert.equal(connection.revision,1); assert.equal(connection.remoteIdentity,null);
  assert.deepEqual(Object.keys(connection).sort(),['id','displayName','config','revision','status','remoteIdentity','scopes','capabilityFingerprint','updatedAt'].sort());
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM connection_credentials').first<{count:number}>())!.count,0);
  assert.equal((await request(`/${connection.id}`)).status,200);
  const rejected=await request('','alice-session','POST',{...createBody,accessToken:'isolated-secret'}); assert.equal(rejected.status,400);
  assert.equal(JSON.stringify(await rejected.json()).includes('isolated-secret'),false);
});

test('real app middleware rejects invalid/missing origins and explicit invalid bearer cannot inherit a cookie',async t=>{
  const {request}=await setup(t);
  for(const Origin of ['https://attacker.example','']) await failure(await request('','alice-session','POST',createBody,{Origin}),403,'invalid_origin');
  await failure(await request('/alice-connection/disconnect','alice-session','POST',{expectedRevision:1},{Origin:'https://attacker.example'}),403,'invalid_origin');
  for(const Authorization of ['Bearer invalid','Basic invalid','']) await failure(await request('','alice-session','POST',createBody,{Authorization}),401,'unauthorized');
});

test('API OAuth and WebMCP grants cannot enable human creation or disconnect',async t=>{
  const {request,grant}=await setup(t); await grant('api'); await grant('oauth'); const web=await grant('webmcp');
  for(const [credential,headers] of [['alice-api',{}],['alice-oauth',{}],['alice-session',{'X-Studio-Client':'webmcp','X-Studio-Connector-Grant':web}]] as const){
    await failure(await request('',credential,'POST',createBody,headers),403,'human_action_required');
    await failure(await request('/alice-connection/disconnect',credential,'POST',{expectedRevision:1},headers),403,'human_action_required');
  }
});

test('foreign connection metadata and disconnect remain owner-scoped',async t=>{
  const {request,grant}=await setup(t); await grant('api');
  await failure(await request('/bob-connection'),404,'connection_not_found');
  await failure(await request('/bob-connection?projectId=alice-project','alice-api'),404,'connection_not_found');
  await failure(await request('/bob-connection/disconnect','alice-session','POST',{expectedRevision:1}),404,'connection_not_found');
  const response=await request(''); assert.equal(response.status,200); const data=await response.json() as {connections:{id:string}[]};
  assert.deepEqual(data.connections.map(c=>c.id),['alice-connection']);
});

test('legacy API keys require explicit project discovery grants and stale grants expose no metadata',async t=>{
  const {request,grant,db}=await setup(t);
  await failure(await request('','alice-api'),403,'missing_grant');
  await failure(await request('/alice-connection','alice-api'),403,'missing_grant');
  await failure(await request('/alice-connection?projectId=alice-project','alice-api'),403,'missing_grant');
  assert.deepEqual(await (await request('?projectId=alice-project','alice-api')).json(),{connections:[]});
  await grant('api',['execute_read']); await failure(await request('/alice-connection?projectId=alice-project','alice-api'),403,'missing_grant');
  await db.prepare("UPDATE connection_agent_grants SET capabilities_json='[\"discover\"]' WHERE id='api-grant'").run();
  assert.equal((await request('/alice-connection?projectId=alice-project','alice-api')).status,200);
  for(const sql of ["UPDATE connection_agent_grants SET policy_revision=2 WHERE id='api-grant'","UPDATE connection_agent_grants SET policy_revision=1,expires_at=0 WHERE id='api-grant'","UPDATE connection_agent_grants SET expires_at=9999999999999,revoked_at='revoked' WHERE id='api-grant'"]){
    await db.prepare(sql).run(); await failure(await request('/alice-connection?projectId=alice-project','alice-api'),403,'missing_grant');
  }
});

test('OAuth and WebMCP metadata requires their own explicit project grants',async t=>{
  const {request,grant,db}=await setup(t);
  await failure(await request('/alice-connection?projectId=alice-project','alice-oauth'),403,'missing_grant');
  await grant('oauth'); assert.equal((await request('/alice-connection?projectId=alice-project','alice-oauth')).status,200);
  await failure(await request('/alice-connection','alice-oauth'),403,'missing_grant');
  await failure(await request('/alice-connection?projectId=alice-project','alice-session','GET',undefined,{'X-Studio-Client':'webmcp'}),403,'missing_grant');
  const web=await grant('webmcp'),headers={'X-Studio-Client':'webmcp','X-Studio-Connector-Grant':web};
  assert.equal((await request('/alice-connection?projectId=alice-project','alice-session','GET',undefined,headers)).status,200);
  await failure(await request('/alice-connection','alice-session','GET',undefined,headers),403,'missing_grant');
  await failure(await request('/alice-connection?projectId=bob-project','alice-session','GET',undefined,headers),403,'missing_grant');
  await db.prepare("UPDATE connection_agent_grants SET revoked_at='revoked' WHERE id='webmcp-grant'").run();
  await failure(await request('/alice-connection?projectId=alice-project','alice-session','GET',undefined,headers),403,'missing_grant');
});

test('concurrent disconnect has one winner and stale retries do not repeat policy invalidation',async t=>{
  const {request,db,grant}=await setup(t); await grant('api');
  const outcomes=await Promise.all([request('/alice-connection/disconnect','alice-session','POST',{expectedRevision:1}),request('/alice-connection/disconnect','alice-session','POST',{expectedRevision:1})]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  await failure(await request('/alice-connection/disconnect','alice-session','POST',{expectedRevision:1}),409,'revision_conflict');
  assert.equal((await db.prepare("SELECT policy_revision FROM project_connection_bindings WHERE id='alice-binding'").first<{policy_revision:number}>())!.policy_revision,2);
  await failure(await request('/alice-connection?projectId=alice-project','alice-api'),403,'missing_grant');
  const metadata=await (await request('/alice-connection')).json() as {connection:{status:string;revision:number}}; assert.equal(metadata.connection.status,'disconnected'); assert.equal(metadata.connection.revision,2);
});
