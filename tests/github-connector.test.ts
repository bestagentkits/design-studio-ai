import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {setup} from './fixtures/connector-operation-context';
import {createConnection} from '../server/connection-store';
import {startGithubAuthorization,finishGithubAuthorization} from '../server/connectors/github-auth';
import {importGithubSource,githubSourcePath} from '../server/connectors/github';

test('GitHub App validates user installation and scopes signed tokens to a selected immutable repository source',async t=>{
  const f=await setup(t),keys=generateKeyPairSync('rsa',{modulusLength:2048}),calls:string[]=[];
  Object.assign(f.env,{GITHUB_CONNECTOR_CLIENT_ID:'test-client',GITHUB_CONNECTOR_CLIENT_SECRET:'test-secret',GITHUB_CONNECTOR_APP_ID:'42',GITHUB_CONNECTOR_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString()});
  const state={symlink:false,denyRepository:false,changeBinding:false};
  const content=Buffer.from('Selected README content'),sha=createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  const server=createServer(async(req,res)=>{
    calls.push(req.url!);const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks).toString();
    let result:unknown;
    if(req.url==='/login/oauth/access_token'){const form=new URLSearchParams(raw);assert.equal(form.get('code_verifier')?.length,43);result={access_token:'github-user-token',token_type:'bearer',expires_in:28800};}
    else if(req.url==='/user')result={id:99};
    else if(req.url?.startsWith('/user/installations?'))result={installations:[{id:7,app_id:42,suspended_at:null}]};
    else if(req.url?.startsWith('/user/installations/7/repositories'))result={repositories:state.denyRepository?[]:[{id:11,full_name:'example/selected',default_branch:'main',permissions:{push:false}}]};
    else if(req.url==='/app/installations/7/access_tokens'){
      const jwt=req.headers.authorization!.slice(7),parts=jwt.split('.');assert.ok(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),keys.publicKey,Buffer.from(parts[2],'base64url')));
      assert.deepEqual(JSON.parse(raw),{repository_ids:[11],permissions:{contents:'read'}});if(state.changeBinding)await f.db.prepare("UPDATE project_connection_bindings SET policy_revision=policy_revision+1 WHERE id='github-source'").run();result={token:'scoped-installation-token',expires_at:new Date(Date.now()+3600000).toISOString(),permissions:{contents:'read'}};
    }else if(req.url?.includes('/git/commits/'))result={sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)}};
    else if(req.url?.includes('/git/trees/'))result={truncated:false,tree:[{path:'README.md',mode:state.symlink?'120000':'100644',type:'blob',sha}]};
    else{assert.match(req.url!,/^\/repos\/example\/selected\/contents\/README.md\?ref=a{40}$/);assert.equal(req.headers.authorization,'Bearer scoped-installation-token');result={type:'file',path:'README.md',sha,encoding:'base64',content:content.toString('base64'),size:content.length};}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  f.env.CONNECTOR_FETCH=async(input,init)=>{const request=new Request(input,init);assert.equal(request.redirect,'manual');const url=new URL(request.url);assert.ok(['github.com','api.github.com'].includes(url.hostname));return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${url.pathname}${url.search}`,{method:request.method,headers:request.headers,body:request.body,duplex:'half'} as RequestInit);};
  const connection=await createConnection(f.env,'alice',{displayName:'Selected GitHub App',config:{adapter:'github',authMode:'oauth'}});
  const started=await startGithubAuthorization(f.env,f.session,connection.id,connection.revision,'7'),url=new URL(started.authorizationUrl);assert.equal(url.searchParams.get('scope'),null);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const connected=await finishGithubAuthorization(f.env,f.session,{state:url.searchParams.get('state')!,code:'test-code'});assert.equal(connected.remoteIdentity,'github:99:7');
  await f.insert('project_connection_bindings',{id:'github-source',user_id:'alice',project_id:'alice-project',connection_id:connection.id,role:'source',selection_json:JSON.stringify({adapter:'github',repositoryId:'11',commit:'a'.repeat(40),paths:['README.md']}),created_at:f.timestamp,updated_at:f.timestamp});
  const source=await importGithubSource(f.env,f.session,'alice-project','github-source','README.md');assert.equal(source.remoteVersion,`${'a'.repeat(40)}:${sha}`);assert.equal(source.bytes,content.length);
  const count=calls.length;await assert.rejects(()=>importGithubSource(f.env,f.api,'alice-project','github-source','README.md'));assert.equal(calls.length,count);
  state.symlink=true;await assert.rejects(()=>importGithubSource(f.env,f.session,'alice-project','github-source','README.md'),(error:any)=>error.code==='unsupported_content');state.symlink=false;
  state.denyRepository=true;const beforeDenied=calls.length;await assert.rejects(()=>importGithubSource(f.env,f.session,'alice-project','github-source','README.md'),(error:any)=>error.code==='missing_grant');assert.ok(!calls.slice(beforeDenied).some(path=>path.startsWith('/repos/')));state.denyRepository=false;
  state.changeBinding=true;const beforeChanged=calls.length;await assert.rejects(()=>importGithubSource(f.env,f.session,'alice-project','github-source','README.md'),(error:any)=>error.code==='revision_conflict');assert.ok(!calls.slice(beforeChanged).some(path=>path.startsWith('/repos/')));
  for(const path of ['../secret','.env','.env.local','dir/.ssh/id_rsa','key.pem','.npmrc','id_ed25519'])assert.throws(()=>githubSourcePath(path));
});
