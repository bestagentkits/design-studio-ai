import { app } from '../server/index';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { ApiError, secret, hash, encrypt } from '../server/security';
import { createConnection, disconnectConnection } from '../server/connection-store';
import { startMcpAuthorization, finishMcpAuthorization, refreshMcpAuthorization } from '../server/connectors/mcp-auth';
import { readConnectorCredential } from '../server/connector-credentials';
import { createServer } from 'node:http';
// @ts-expect-error Isolated protocol peer is a JavaScript test artifact.
import { createOAuthPeer } from './fixtures/mcp-oauth-peer.mjs';
import type { Bindings } from '../server/types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';

type Session = Extract<ConnectorPrincipal, { kind: 'session' }>;
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const setup = (adapter = 'mcp') => ({ issuer: 'https://auth.vendor.net', resource: 'https://api.vendor.net/mcp', callback: `https://studio.vendor.net/api/connectors/${adapter}/callback`, verifier: secret() });
async function fixture(run: (env: Bindings, sessions: Session[]) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-auth-states-')), db = new SqliteDatabase(':memory:');
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ENCRYPTION_KEY: secret(), APP_URL: 'https://studio.vendor.net' };
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    for (const owner of ['alice', 'bob']) await db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').bind(owner, `${owner}@example.com`, owner, 'unused-test-password', new Date().toISOString()).run();
    const sessions: Session[] = [];
    for (const userId of ['alice', 'alice', 'bob']) {
      const sessionId = await hash(secret());
      await db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(sessionId, userId, Date.now() + 3600000).run();
      sessions.push({ kind: 'session', userId, sessionId });
    }
    await run(env, sessions);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
const unusedConnection = (env: Bindings, userId = 'alice', adapter: 'mcp' | 'github' | 'google-drive' = 'mcp') => createConnection(env, userId, { displayName: 'Isolated authorization', config: adapter === 'mcp' ? { adapter, endpoint: 'https://api.vendor.net/mcp', authMode: 'oauth' } : { adapter, authMode: 'oauth' } });

const origin='https://api.vendor.net';
async function peerFixture(run:(env:Bindings,session:Session,peer:any)=>Promise<void>, omitFirstRefresh=false) {
  await fixture(async(env,[session])=>{
    const peer=createOAuthPeer(origin); let issuedRefresh:string|undefined, refreshRequests=0;
    const server=createServer(async(req,res)=>{
      try { const chunks:Buffer[]=[]; for await(const chunk of req) chunks.push(chunk);
        const body=Buffer.concat(chunks), request=new Request(origin+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:body.length?body:undefined});
        const params=new URLSearchParams(body.toString()), refreshing=params.get('grant_type')==='refresh_token';
        if(refreshing) refreshRequests++;
        let response:Response;
        if(omitFirstRefresh && refreshing && refreshRequests===1) {
          assert.equal(params.get('refresh_token'),issuedRefresh);assert.equal(params.get('resource'),origin+'/mcp/good');
          response=Response.json({access_token:secret(),token_type:'Bearer',expires_in:3600});
        } else response=await peer.fetch(request);
        if(req.url?.startsWith('/token/') && response.ok && !refreshing) issuedRefresh=(await response.clone().json()).refresh_token;
        peer.refreshRequests=refreshRequests;
        if(req.url?.startsWith('/.well-known/oauth-authorization-server/')) { const metadata=await response.json(); response=Response.json({...metadata,registration_endpoint:origin+'/register',client_id_metadata_document_supported:true}); }
        if(req.url==='/register') response=Response.json({client_id:'probe-client',token_endpoint_auth_method:'none',redirect_uris:['https://studio.vendor.net/api/connectors/mcp/callback']});
        res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      }catch {res.writeHead(500);res.end();}
    });
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(18847,'127.0.0.1',resolve);});
    env.CONNECTOR_FETCH=async(input,init)=>{const request=new Request(input,init), url=new URL(request.url);
      assert.equal(url.origin,origin); return fetch('http://127.0.0.1:18847'+url.pathname+url.search,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',signal:request.signal});};
    try {await run(env,session,peer);} finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await peer.close();}
  });
}
const make=(env:Bindings)=>createConnection(env,'alice',{displayName:'Isolated MCP OAuth',config:{adapter:'mcp',authMode:'oauth',endpoint:origin+'/mcp/good'}});
const options={profile:'modern' as const,client:{clientId:'probe-client',authMethod:'none' as const}};
async function authorize(env:Bindings,session:Session,id:string,revision:number,legacy=false) {
  const start=await startMcpAuthorization(env,session,id,revision,legacy?{profile:'legacy'}:options);
  const response=await env.CONNECTOR_FETCH!(start.authorizationUrl,{redirect:'manual'});
  assert.equal(response.status,302);const callback=new URL(response.headers.get('location')!);
  return {start,input:{state:callback.searchParams.get('state')!,code:callback.searchParams.get('code')!,issuer:callback.searchParams.get('iss')!}};
}
test('real HTTP PKCE exchange, encrypted context, replay rejection and one refresh lease',async()=>peerFixture(async(env,session,peer)=>{
  const c=await make(env), {start,input}=await authorize(env,session,c.id,1);
  assert.equal(start.revision,2);
  const proof=await finishMcpAuthorization(env,session,input);assert.equal(proof.authorizationVerified,true);assert.equal(proof.remoteIdentity,null);
  assert.equal(peer.counts.pkce,1);await assert.rejects(finishMcpAuthorization(env,session,input),errorCode('invalid_state'));
  const first=await readConnectorCredential(env,'alice',c.id);
  const context=await env.DB.prepare('SELECT * FROM connection_mcp_oauth_clients').first();assert.equal(JSON.stringify(context).includes(first.credential.accessToken),false);
  await env.DB.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(c.id).run();
  const outcomes=await Promise.allSettled([refreshMcpAuthorization(env,'alice',c.id,2),refreshMcpAuthorization(env,'alice',c.id,2)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(peer.counts.refresh,1);
  const next=await readConnectorCredential(env,'alice',c.id);assert.equal(next.row.credential_version,2);assert.notEqual(next.credential.accessToken,first.credential.accessToken);
  await disconnectConnection(env,'alice',c.id,2);assert.equal(await env.DB.prepare('SELECT * FROM connection_mcp_oauth_clients').first(),null);
}));
test('legacy DCR stores registration privately and redeems PKCE',async()=>peerFixture(async(env,session,peer)=>{
  const c=await make(env),{input}=await authorize(env,session,c.id,1,true);await finishMcpAuthorization(env,session,input);assert.equal(peer.counts.pkce,1);
}));
test('wrong issuer, denial, revoked session and disconnect reject before token exchange',async()=>peerFixture(async(env,session,peer)=>{
  const c=await make(env);let flow=await authorize(env,session,c.id,1);
  await assert.rejects(finishMcpAuthorization(env,session,{...flow.input,issuer:origin+'/wrong'}),errorCode('invalid_callback'));
  await assert.rejects(finishMcpAuthorization(env,session,flow.input),errorCode('invalid_state'));
  flow=await authorize(env,session,c.id,2);await assert.rejects(finishMcpAuthorization(env,session,{...flow.input,denial:'access_denied'}),errorCode('authorization_denied'));
  flow=await authorize(env,session,c.id,3);await disconnectConnection(env,'alice',c.id,4);await assert.rejects(finishMcpAuthorization(env,session,flow.input),errorCode('invalid_state'));
  flow=await authorize(env,session,c.id,5);await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(session.sessionId).run();await assert.rejects(finishMcpAuthorization(env,session,flow.input));assert.equal(peer.counts.pkce,0);
}));
test('human authority required and modern DCR is not silently selected',async()=>peerFixture(async(env,session)=>{
 const c=await make(env);await assert.rejects(startMcpAuthorization(env,{kind:'api',userId:'alice',tokenId:'unused'},c.id,1,options),errorCode('human_action_required'));
 await assert.rejects(startMcpAuthorization(env,session,c.id,1,{profile:'modern'}),errorCode('client_registration_required'));
 const start=await startMcpAuthorization(env,session,c.id,1,{profile:'modern',clientMetadataUrl:'https://studio.vendor.net/oauth/client.json'});
 assert.equal(new URL(start.authorizationUrl).searchParams.get('client_id'),'https://studio.vendor.net/oauth/client.json');
}));
test('late exchange after disconnect cannot restore credentials',async()=>peerFixture(async(env,session)=>{
 const c=await make(env),flow=await authorize(env,session,c.id,1),transport=env.CONNECTOR_FETCH!;
 env.CONNECTOR_FETCH=async(input,init)=>{const tokenRequest=(input instanceof Request?input.url:String(input)).includes('/token/');const response=await transport(input,init);if(tokenRequest)await disconnectConnection(env,'alice',c.id,2);return response;};
 await assert.rejects(finishMcpAuthorization(env,session,flow.input),errorCode('revision_conflict'));
 assert.equal(await env.DB.prepare('SELECT * FROM connection_credentials').first(),null);
 assert.equal(await env.DB.prepare('SELECT * FROM connection_mcp_oauth_clients').first(),null);
}));
test('revocation during exchange prevents committing authority',async()=>peerFixture(async(env,session)=>{
 const c=await make(env),flow=await authorize(env,session,c.id,1),transport=env.CONNECTOR_FETCH!;
 env.CONNECTOR_FETCH=async(input,init)=>{const tokenRequest=(input instanceof Request?input.url:String(input)).includes('/token/');const response=await transport(input,init);if(tokenRequest)await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(session.sessionId).run();return response;};
 await assert.rejects(finishMcpAuthorization(env,session,flow.input),errorCode('revision_conflict'));
 assert.equal(await env.DB.prepare('SELECT * FROM connection_credentials').first(),null);
}));
test('discovery redirect fails without following another host or resetting connection',async()=>peerFixture(async(env,session)=>{
 const c=await make(env),transport=env.CONNECTOR_FETCH!;let calls=0;
 env.CONNECTOR_FETCH=async(input,init)=>{calls++;const response=await transport(input,init);await response.body?.cancel();return new Response(null,{status:302,headers:{location:'https://other.vendor.net/metadata'}});};
 await assert.rejects(startMcpAuthorization(env,session,c.id,1,options),errorCode('unsafe_destination'));assert.equal(calls,1);
 assert.equal((await env.DB.prepare('SELECT revision FROM connections WHERE id=?').bind(c.id).first<{revision:number}>())?.revision,1);
}));
test('swapped encrypted setup is rejected without exchanging a code',async()=>peerFixture(async(env,session,peer)=>{
 const a=await make(env), b=await make(env),one=await authorize(env,session,a.id,1),two=await authorize(env,session,b.id,1);
 const cipher=await env.DB.prepare('SELECT encrypted_context FROM connection_mcp_oauth_setups WHERE state_hash=?').bind(await hash(two.input.state)).first<{encrypted_context:string}>();
 await env.DB.prepare('UPDATE connection_mcp_oauth_setups SET encrypted_context=? WHERE state_hash=?').bind(cipher!.encrypted_context,await hash(one.input.state)).run();
 await assert.rejects(finishMcpAuthorization(env,session,one.input),errorCode('needs_reauthorization'));assert.equal(peer.counts.pkce,0);
}));
test('HTTP refresh omission preserves the old token for the next rotating refresh',async()=>peerFixture(async(env,session,peer)=>{
 const c=await make(env),flow=await authorize(env,session,c.id,1);await finishMcpAuthorization(env,session,flow.input);
 await env.DB.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(c.id).run();
 const initial=await readConnectorCredential(env,'alice',c.id);
 await refreshMcpAuthorization(env,'alice',c.id,2);
 const renewed=await readConnectorCredential(env,'alice',c.id);
 assert.equal(renewed.credential.refreshToken,initial.credential.refreshToken);assert.notEqual(renewed.credential.accessToken,initial.credential.accessToken);
 await refreshMcpAuthorization(env,'alice',c.id,2);
 const rotated=await readConnectorCredential(env,'alice',c.id);
 assert.notEqual(rotated.credential.refreshToken,renewed.credential.refreshToken);assert.equal(rotated.row.credential_version,3);assert.equal(peer.refreshRequests,2);
},true));
test('expired refresh lease rejects late HTTP completion without saving rotated credentials',async()=>peerFixture(async(env,session,peer)=>{
 const c=await make(env),flow=await authorize(env,session,c.id,1);await finishMcpAuthorization(env,session,flow.input);
 await env.DB.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(c.id).run();
 const before=await readConnectorCredential(env,'alice',c.id),transport=env.CONNECTOR_FETCH!;
 env.CONNECTOR_FETCH=async(input,init)=>{const response=await transport(input,init);await env.DB.prepare('UPDATE connection_credentials SET refresh_lease_expires_at=0 WHERE connection_id=?').bind(c.id).run();return response;};
 await assert.rejects(refreshMcpAuthorization(env,'alice',c.id,2),errorCode('revision_conflict'));
 const after=await readConnectorCredential(env,'alice',c.id);assert.equal(after.credential.refreshToken,before.credential.refreshToken);assert.equal(after.row.credential_version,before.row.credential_version);assert.equal(after.connection.status,'needs_reauthorization');assert.equal(peer.refreshRequests,1);
}));
test('disconnect during refresh rejects late HTTP completion without resurrecting credentials',async()=>peerFixture(async(env,session,peer)=>{
 const c=await make(env),flow=await authorize(env,session,c.id,1);await finishMcpAuthorization(env,session,flow.input);
 await env.DB.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(c.id).run();
 const transport=env.CONNECTOR_FETCH!;
 env.CONNECTOR_FETCH=async(input,init)=>{const response=await transport(input,init);await disconnectConnection(env,'alice',c.id,2);return response;};
 await assert.rejects(refreshMcpAuthorization(env,'alice',c.id,2),errorCode('revision_conflict'));
 assert.equal(await env.DB.prepare('SELECT * FROM connection_credentials WHERE connection_id=?').bind(c.id).first(),null);assert.equal(peer.refreshRequests,1);
}));

test('stored noncanonical endpoint completes authorization and refresh with canonical resource pins',async()=>peerFixture(async(env,session,peer)=>{
 const c=await createConnection(env,'alice',{displayName:'Canonical OAuth endpoint',config:{adapter:'mcp',authMode:'oauth',endpoint:'https://API.vendor.net:443/mcp/good'}});
 const flow=await authorize(env,session,c.id,1);await finishMcpAuthorization(env,session,flow.input);
 await env.DB.prepare("UPDATE connections SET status='connected' WHERE id=?").bind(c.id).run();
 await refreshMcpAuthorization(env,'alice',c.id,2);
 const next=await readConnectorCredential(env,'alice',c.id);assert.equal(next.row.credential_version,2);assert.equal(next.credential.resource,origin+'/mcp/good');assert.equal(peer.refreshRequests,1);
 await env.DB.prepare('UPDATE connections SET endpoint=? WHERE id=?').bind(origin+'/mcp/other',c.id).run();
 await assert.rejects(refreshMcpAuthorization(env,'alice',c.id,2),errorCode('needs_reauthorization'));assert.equal(peer.refreshRequests,1);
}));


test('mounted OAuth routes publish canonical CIMD and complete session-bound authorization', async()=>peerFixture(async(env,session,peer)=>{
  env.CONNECTORS_ENABLED='true';
  const sessionHash=await hash('isolated-route-session');
  await env.DB.prepare('UPDATE sessions SET hash=? WHERE hash=?').bind(sessionHash,session.sessionId).run();
  session.sessionId=sessionHash;
  const metadata=await app.request('https://studio.vendor.net/api/connectors/mcp/client-metadata',{},env);
  assert.equal(metadata.status,200);const client=await metadata.json() as any;
  assert.deepEqual(client.redirect_uris,['https://studio.vendor.net/api/connectors/mcp/callback']);
  assert.equal(client.client_id,'https://studio.vendor.net/api/connectors/mcp/client-metadata');
  const c=await make(env), headers={Cookie:'studio_session=isolated-route-session',Origin:'https://studio.vendor.net','Content-Type':'application/json'};
  const response=await app.request('https://studio.vendor.net/api/connectors/mcp/authorize',{method:'POST',headers,body:JSON.stringify({connectionId:c.id,expectedRevision:1,options})},env);
  assert.equal(response.status,200);const start=await response.json() as any;
  const consent=await env.CONNECTOR_FETCH!(start.authorizationUrl,{redirect:'manual'});
  const callback=consent.headers.get('location')!;
  const result=await app.request(callback,{headers:{Cookie:headers.Cookie}},env);
  assert.equal(result.status,200);const activated=await result.json() as any;
  assert.equal(activated.connection.status,'connected');assert.equal(activated.connection.revision,3);
  assert.equal(activated.connection.remoteIdentity,null);assert.equal(peer.counts.pkce,1);
  assert.equal((await app.request(callback,{headers:{Cookie:headers.Cookie}},env)).status,400);
  assert.equal(JSON.stringify(activated).includes('accessToken'),false);
}));
